package bankimport

import (
	"strings"
	"testing"
)

func TestParseNotificationSupportedBanks(t *testing.T) {
	// 1. Nubank compra no crédito parcelada com final do cartão
	p1 := ParseNotification(
		"com.nu.production",
		"Compra no crédito aprovada",
		"Compra de R$ 1.250,90 APROVADA em Supermercado Extra em 3x para o cartão com final 4321",
	)
	if p1.BankCode != BankNubank || p1.ParseStatus != "parsed" {
		t.Fatalf("Nubank falhou: %+v", p1)
	}
	if p1.ParsedAmountCents == nil || *p1.ParsedAmountCents != 125090 {
		t.Fatalf("valor Nubank incorreto: %v", p1.ParsedAmountCents)
	}
	if p1.CardLast4 == nil || *p1.CardLast4 != "4321" || p1.ParsedInstallments != 3 || p1.PaymentKind != "credit_card" {
		t.Fatalf("metadados Nubank incorretos: %+v", p1)
	}

	// 2. Itaú PIX enviado
	p2 := ParseNotification(
		"com.itau",
		"Itaú: Pix enviado",
		"Você enviou um Pix de R$ 85,00 para Padaria Central.",
	)
	if p2.BankCode != BankItau || p2.ParseStatus != "parsed" || p2.PaymentKind != "pix" {
		t.Fatalf("Itaú Pix falhou: %+v", p2)
	}
	if p2.ParsedAmountCents == nil || *p2.ParsedAmountCents != 8500 {
		t.Fatalf("valor Itaú Pix incorreto: %v", p2.ParsedAmountCents)
	}

	// 3. E8-D3: Notificação com formato alterado sem valor claro -> needs_review, sem chute!
	p3 := ParseNotification(
		"br.com.intermedium",
		"Banco Inter",
		"Você realizou uma compra no seu cartão virtual. Confira no aplicativo.",
	)
	if p3.BankCode != BankInter || p3.ParseStatus != "needs_review" || p3.ParsedAmountCents != nil {
		t.Fatalf("E8-D3 falhou (deveria ser needs_review sem valor chutado): %+v", p3)
	}

	// 4. Mascaramento anti-PAN em texto de notificação
	p4 := ParseNotification(
		"com.bradesco",
		"Bradesco Cartões",
		"Compra no cartão 4532 1122 3344 5566 de R$ 40,00 em Farmacia",
	)
	if strings.Contains(p4.MerchantOrTitle, "4532 1122 3344 5566") {
		t.Fatalf("PAN não foi mascarado: %s", p4.MerchantOrTitle)
	}
}
