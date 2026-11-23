// Package bankimport implementa a autenticação de dispositivos Android,
// o parser versionado de notificações bancárias brasileiras (ADR 0011 / E8-D1..D3)
// e a fila privada de revisão e importação protegida por RLS.
package bankimport

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"regexp"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Erros de domínio.
var (
	ErrNotFound          = errors.New("registro não encontrado")
	ErrInvalidDevice     = errors.New("nome do dispositivo deve ter entre 1 e 80 caracteres")
	ErrInvalidToken      = errors.New("token de dispositivo inválido ou revogado")
	ErrNotPending        = errors.New("este item já foi aprovado ou descartado")
	ErrAmountRequired    = errors.New("informe o valor em centavos para aprovar uma notificação pendente de revisão")
	ErrEmptyNotification = errors.New("notificação vazia")
)

// Códigos dos bancos suportados (E8-D1).
const (
	BankNubank    = "nubank"
	BankItau      = "itau"
	BankBradesco  = "bradesco"
	BankBB        = "bb"
	BankInter     = "inter"
	BankSantander = "santander"
	BankC6        = "c6"
	BankGeneric   = "generic"
)

// DetectBankCode identifica o banco pelo packageName do app Android ou pelo título.
func DetectBankCode(packageName, title string) string {
	pkg := strings.ToLower(strings.TrimSpace(packageName))
	t := strings.ToLower(strings.TrimSpace(title))
	switch {
	case strings.Contains(pkg, "com.nu.") || strings.Contains(pkg, "nubank") || strings.Contains(t, "nubank"):
		return BankNubank
	case strings.Contains(pkg, "itau") || strings.Contains(t, "itaú") || strings.Contains(t, "itau"):
		return BankItau
	case strings.Contains(pkg, "bradesco") || strings.Contains(t, "bradesco"):
		return BankBradesco
	case strings.Contains(pkg, "br.com.bb") || strings.Contains(t, "banco do brasil"):
		return BankBB
	case strings.Contains(pkg, "intermedium") || strings.Contains(pkg, "bancointer") || strings.Contains(t, "inter"):
		return BankInter
	case strings.Contains(pkg, "santander") || strings.Contains(t, "santander"):
		return BankSantander
	case strings.Contains(pkg, "c6bank") || strings.Contains(t, "c6 bank") || strings.Contains(t, "c6bank"):
		return BankC6
	default:
		return BankGeneric
	}
}

var (
	// Captura valores em BRL como "R$ 1.234,56" ou "R$45,90".
	reBRLAmount = regexp.MustCompile(`(?i)R\$\s*(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})\b`)
	// Captura os 4 últimos dígitos do cartão: "final 1234", "cartão 1234", "•••• 1234" ou "**** 1234".
	reCardLast4 = regexp.MustCompile(`(?i)(?:final|cart[aã]o|[•*]{2,4})\s*(\d{4})\b`)
	// Captura parcelamento: "em 3x", "3x de", "parcelado em 10x".
	reInstallments = regexp.MustCompile(`(?i)\b(?:em\s+)?(\d{1,2})x\b`)
	// Captura sequências de 12 a 19 dígitos (mesmo separadas por espaço ou hífen) para mascaramento anti-PAN.
	reCardPAN = regexp.MustCompile(`\b(?:\d[ -]*?){12,19}\b`)
	// Extrai o estabelecimento após " em " ou " para " ou " no ".
	reMerchant = regexp.MustCompile(`(?i)\b(?:em|para|no|na)\s+([A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9 .&*/_-]{1,60})`)
)

// MaskCardPAN substitui qualquer sequência de 12 a 19 dígitos por "[CARTAO-MASCARADO]"
// para impedir que um PAN completo seja gravado no banco.
func MaskCardPAN(s string) string {
	return reCardPAN.ReplaceAllStringFunc(s, func(match string) string {
		digits := 0
		for _, r := range match {
			if unicode.IsDigit(r) {
				digits++
			}
		}
		if digits >= 12 {
			return "[CARTAO-MASCARADO]"
		}
		return match
	})
}

// ParsedNotification é o resultado estruturado da análise de uma notificação bancária.
type ParsedNotification struct {
	BankCode           string
	ParseStatus        string // "parsed" ou "needs_review" (E8-D3)
	ParsedAmountCents  *int64
	MerchantOrTitle    string
	CardLast4          *string
	PaymentKind        string // "pix" | "credit_card" | "debit" | "transfer" | "other"
	ParsedInstallments int32
}

// ParseNotification analisa o pacote, título e texto de uma notificação bancária.
// Nunca "chuta" valores (E8-D3): se não encontrar um valor inequívoco em BRL,
// marca ParseStatus = "needs_review" e ParsedAmountCents = nil.
func ParseNotification(packageName, title, text string) ParsedNotification {
	safeTitle := strings.TrimSpace(MaskCardPAN(title))
	safeText := strings.TrimSpace(MaskCardPAN(text))
	combined := strings.TrimSpace(safeTitle + " - " + safeText)
	lower := strings.ToLower(combined)

	out := ParsedNotification{
		BankCode:           DetectBankCode(packageName, safeTitle),
		ParseStatus:        "needs_review",
		PaymentKind:        detectPaymentKind(lower),
		ParsedInstallments: 1,
	}

	// 1. Extração de valor em centavos (só marca "parsed" se houver exatamente 1 valor principal ou se o 1º match for válido).
	if m := reBRLAmount.FindStringSubmatch(combined); len(m) == 3 {
		reaisStr := strings.ReplaceAll(m[1], ".", "")
		reais, err1 := strconv.ParseInt(reaisStr, 10, 64)
		centavos, err2 := strconv.ParseInt(m[2], 10, 64)
		if err1 == nil && err2 == nil {
			total := reais*100 + centavos
			if total > 0 {
				out.ParsedAmountCents = &total
				out.ParseStatus = "parsed"
			}
		}
	}

	// 2. Extração opcional dos 4 últimos dígitos do cartão.
	if m := reCardLast4.FindStringSubmatch(combined); len(m) == 2 {
		l4 := m[1]
		out.CardLast4 = &l4
		if out.PaymentKind == "other" {
			out.PaymentKind = "credit_card"
		}
	}

	// 3. Extração opcional de parcelas (1..48).
	if m := reInstallments.FindStringSubmatch(combined); len(m) == 2 {
		if n, err := strconv.Atoi(m[1]); err == nil && n >= 2 && n <= 48 {
			out.ParsedInstallments = int32(n)
			out.PaymentKind = "credit_card"
		}
	}

	// 4. Estabelecimento ou resumo mascarado (máx 160 caracteres).
	merchant := extractMerchant(safeText)
	if merchant == "" {
		merchant = strings.Trim(combined, " -")
	}
	if merchant == "" {
		merchant = "Notificação bancária"
	}
	out.MerchantOrTitle = truncateRunes(merchant, 160)
	return out
}

func detectPaymentKind(lower string) string {
	switch {
	case strings.Contains(lower, "pix"):
		return "pix"
	case strings.Contains(lower, "débito") || strings.Contains(lower, "debito"):
		return "debit"
	case strings.Contains(lower, "crédito") || strings.Contains(lower, "credito") ||
		strings.Contains(lower, "fatura") || strings.Contains(lower, "cartão") || strings.Contains(lower, "cartao"):
		return "credit_card"
	case strings.Contains(lower, "transferência") || strings.Contains(lower, "transferencia") || strings.Contains(lower, "ted"):
		return "transfer"
	default:
		return "other"
	}
}

func extractMerchant(safeText string) string {
	m := reMerchant.FindStringSubmatch(safeText)
	if len(m) != 2 {
		return ""
	}
	candidate := strings.TrimSpace(m[1])
	for _, stop := range []string{" no valor", " valor ", " final ", " cartão", " cartao", " em ", ". ", " - "} {
		if idx := strings.Index(strings.ToLower(candidate), stop); idx > 0 {
			candidate = strings.TrimSpace(candidate[:idx])
		}
	}
	candidate = strings.Trim(candidate, ".,;:- ")
	if utf8.RuneCountInString(candidate) < 2 {
		return ""
	}
	return candidate
}

func truncateRunes(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max])
}

// GenerateDeviceToken gera um token opaco de 256 bits prefixado com "ff_dev_".
func GenerateDeviceToken() (plain string, hash []byte, err error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", nil, err
	}
	plain = "ff_dev_" + base64.RawURLEncoding.EncodeToString(b)
	h := sha256.Sum256([]byte(plain))
	return plain, h[:], nil
}

// HashDeviceToken calcula o SHA-256 de um token de dispositivo.
func HashDeviceToken(plain string) ([]byte, bool) {
	plain = strings.TrimSpace(plain)
	if !strings.HasPrefix(plain, "ff_dev_") || len(plain) != 7+43 {
		return nil, false
	}
	h := sha256.Sum256([]byte(plain))
	return h[:], true
}

// ComputeDedupHash gera um hash SHA-256 determinístico para deduplicação da notificação.
func ComputeDedupHash(bankCode, occurredOn, title, text, externalID string) string {
	h := sha256.New()
	h.Write([]byte(bankCode))
	h.Write([]byte("|"))
	h.Write([]byte(occurredOn))
	h.Write([]byte("|"))
	h.Write([]byte(strings.TrimSpace(title)))
	h.Write([]byte("|"))
	h.Write([]byte(strings.TrimSpace(text)))
	h.Write([]byte("|"))
	h.Write([]byte(strings.TrimSpace(externalID)))
	return hex.EncodeToString(h.Sum(nil))
}
