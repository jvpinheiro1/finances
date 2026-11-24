// Package expense implementa categorias, meios de pagamento, despesas
// (individuais e coletivas), divisões determinísticas (ADR 0006), parcelamentos
// e estornos proporcionais em centavos (ADR 0007).
package expense

import (
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
)

// Erros de domínio (mensagens seguras para o cliente HTTP).
var (
	ErrNotFound            = errors.New("recurso não encontrado")
	ErrDuplicateCategory   = errors.New("já existe uma categoria com este nome")
	ErrInvalidName         = errors.New("o nome deve ter entre 1 e 60 caracteres")
	ErrInvalidKind         = errors.New("tipo de meio de pagamento inválido")
	ErrInvalidLast4        = errors.New("informe exatamente os 4 últimos dígitos numéricos (apenas para cartão)")
	ErrInvalidBillingDay   = errors.New("dia de fechamento/vencimento deve estar entre 1 e 31 (apenas para cartão de crédito)")
	ErrInvalidAmount       = errors.New("o valor em centavos deve ser um inteiro positivo")
	ErrInvalidDesc         = errors.New("a descrição deve ter entre 1 e 160 caracteres")
	ErrInvalidNotes        = errors.New("as observações devem ter no máximo 500 caracteres")
	ErrInvalidDate         = errors.New("data inválida (use o formato AAAA-MM-DD)")
	ErrCardPANDetected     = errors.New("nunca informe números completos de cartão; use apenas os 4 últimos dígitos")
	ErrAlreadyShared       = errors.New("esta despesa já está no ambiente coletivo da família")
	ErrInvalidPaidBy       = errors.New("membro pagador inválido para este ambiente")
	ErrInvalidSplit        = errors.New("divisão da despesa inválida: verifique os participantes e se a soma confere com o total")
	ErrInvalidInstallments = errors.New("o número de parcelas deve estar entre 1 e 48 e o valor total deve ser de pelo menos 1 centavo por parcela")
	ErrInvalidRefundAmount = errors.New("o valor do estorno deve ser positivo e não pode ultrapassar o saldo restante da despesa")
	ErrInvalidRefundReason = errors.New("o motivo do estorno deve ter no máximo 300 caracteres")
	ErrInvalidFrequency    = errors.New("a periodicidade deve ser monthly (mensal), weekly (semanal) ou yearly (anual)")
	ErrInvalidEndDate      = errors.New("a data final da recorrência não pode ser anterior à data inicial")
)

// PaymentKind identifica o tipo de meio de pagamento.
type PaymentKind string

const (
	KindPIX        PaymentKind = "pix"
	KindDebit      PaymentKind = "debit"
	KindCreditCard PaymentKind = "credit_card"
	KindCash       PaymentKind = "cash"
	KindTransfer   PaymentKind = "transfer"
	KindOther      PaymentKind = "other"
)

// Valid confere se o tipo de meio de pagamento é suportado.
func (k PaymentKind) Valid() bool {
	switch k {
	case KindPIX, KindDebit, KindCreditCard, KindCash, KindTransfer, KindOther:
		return true
	default:
		return false
	}
}

// SplitStrategy define como uma despesa coletiva é dividida entre membros.
type SplitStrategy string

const (
	SplitEqual      SplitStrategy = "equal"      // partes iguais entre os participantes selecionados
	SplitExact      SplitStrategy = "exact"      // valor exato em centavos por participante
	SplitPercentage SplitStrategy = "percentage" // pontos-base (soma = 10000 = 100,00%)
	SplitShares     SplitStrategy = "shares"     // cotas inteiras positivas (ex.: 2 e 1)
)

// Valid confere se a estratégia de divisão é suportada.
func (s SplitStrategy) Valid() bool {
	switch s {
	case SplitEqual, SplitExact, SplitPercentage, SplitShares:
		return true
	default:
		return false
	}
}

// SplitShare representa a cota de um membro numa despesa coletiva.
type SplitShare struct {
	UserID     uuid.UUID `json:"user_id"`
	UserName   string    `json:"user_name,omitempty"`
	WeightBps  *int32    `json:"weight_bps,omitempty"`
	ShareCents int64     `json:"share_cents"`
}

// SplitInput é a entrada de um participante na divisão.
type SplitInput struct {
	UserID     uuid.UUID `json:"user_id"`
	WeightBps  int32     `json:"weight_bps"`
	ShareCents int64     `json:"share_cents"`
}

// Category classifica despesas da residência.
type Category struct {
	ID          uuid.UUID `json:"id"`
	HouseholdID uuid.UUID `json:"household_id"`
	Name        string    `json:"name"`
	IsArchived  bool      `json:"is_archived"`
}

// PaymentMethod representa um meio de pagamento (coletivo ou individual).
type PaymentMethod struct {
	ID          uuid.UUID   `json:"id"`
	HouseholdID uuid.UUID   `json:"household_id"`
	OwnerUserID *uuid.UUID  `json:"owner_user_id,omitempty"`
	IsPersonal  bool        `json:"is_personal"`
	Name        string      `json:"name"`
	Kind        PaymentKind `json:"kind"`
	Last4       *string     `json:"last4,omitempty"`
	ClosingDay  *int32      `json:"closing_day,omitempty"`
	DueDay      *int32      `json:"due_day,omitempty"`
	IsArchived  bool        `json:"is_archived"`
}

// Expense representa uma despesa em centavos (int64, nunca float).
type Expense struct {
	ID                uuid.UUID     `json:"id"`
	HouseholdID       uuid.UUID     `json:"household_id"`
	WorkspaceID       uuid.UUID     `json:"workspace_id"`
	CategoryID        uuid.UUID     `json:"category_id"`
	CategoryName      string        `json:"category_name"`
	PaymentMethodID   *uuid.UUID    `json:"payment_method_id,omitempty"`
	PaymentMethodName *string       `json:"payment_method_name,omitempty"`
	PaymentMethodKind *string       `json:"payment_method_kind,omitempty"`
	PaymentMethodLast *string       `json:"payment_method_last4,omitempty"`
	PaidByUserID      uuid.UUID     `json:"paid_by_user_id"`
	PaidByName        string        `json:"paid_by_name"`
	CreatedByUserID   uuid.UUID     `json:"created_by_user_id"`
	AmountCents       int64         `json:"amount_cents"`
	RefundedCents     int64         `json:"refunded_cents"`
	NetAmountCents    int64         `json:"net_amount_cents"`
	Description       string        `json:"description"`
	IncurredOn        string        `json:"incurred_on"` // AAAA-MM-DD
	Notes             string        `json:"notes"`
	SplitStrategy     SplitStrategy `json:"split_strategy"`
	Splits            []SplitShare  `json:"splits"`
	InstallmentPlanID *uuid.UUID    `json:"installment_plan_id,omitempty"`
	InstallmentNumber *int32        `json:"installment_number,omitempty"`
	TotalInstallments *int32        `json:"total_installments,omitempty"`
	RecurringRuleID   *uuid.UUID    `json:"recurring_rule_id,omitempty"`
	RecurringPeriod   *string       `json:"recurring_period,omitempty"`
	SharedAt          *time.Time    `json:"shared_at,omitempty"`
	CreatedAt         time.Time     `json:"created_at"`
	UpdatedAt         time.Time     `json:"updated_at"`
}

// Refund representa um estorno parcial ou total registrado numa despesa.
type Refund struct {
	ID              uuid.UUID `json:"id"`
	ExpenseID       uuid.UUID `json:"expense_id"`
	HouseholdID     uuid.UUID `json:"household_id"`
	AmountCents     int64     `json:"amount_cents"`
	RefundedOn      string    `json:"refunded_on"` // AAAA-MM-DD
	Reason          string    `json:"reason"`
	CreatedByUserID uuid.UUID `json:"created_by_user_id"`
	CreatedByName   string    `json:"created_by_name"`
	CreatedAt       time.Time `json:"created_at"`
}

// MaxAmountCents limita um lançamento único a R$ 10.000.000,00 (evita overflow em somas).
const MaxAmountCents int64 = 1_000_000_000

// MaxInstallments é o limite de parcelas de uma compra parcelada.
const MaxInstallments = 48

// ValidateName valida o nome de categoria ou meio de pagamento.
func ValidateName(s string) (string, error) {
	s = strings.TrimSpace(s)
	n := utf8.RuneCountInString(s)
	if n < 1 || n > 60 {
		return "", ErrInvalidName
	}
	if LooksLikeCardPAN(s) {
		return "", ErrCardPANDetected
	}
	return s, nil
}

// ValidateLast4 valida os 4 últimos dígitos opcionais do cartão.
func ValidateLast4(kind PaymentKind, last4 *string) (*string, error) {
	if last4 == nil {
		return nil, nil
	}
	v := strings.TrimSpace(*last4)
	if v == "" {
		return nil, nil
	}
	if kind != KindCreditCard && kind != KindDebit {
		return nil, ErrInvalidLast4
	}
	if len(v) != 4 {
		return nil, ErrInvalidLast4
	}
	for _, r := range v {
		if r < '0' || r > '9' {
			return nil, ErrInvalidLast4
		}
	}
	return &v, nil
}

// ValidateBillingDays valida os dias opcionais de fechamento e vencimento do cartão (E4-D1).
func ValidateBillingDays(kind PaymentKind, closingDay, dueDay *int32) (*int32, *int32, error) {
	if closingDay == nil && dueDay == nil {
		return nil, nil, nil
	}
	if kind != KindCreditCard {
		return nil, nil, ErrInvalidBillingDay
	}
	if closingDay != nil && (*closingDay < 1 || *closingDay > 31) {
		return nil, nil, ErrInvalidBillingDay
	}
	if dueDay != nil && (*dueDay < 1 || *dueDay > 31) {
		return nil, nil, ErrInvalidBillingDay
	}
	return closingDay, dueDay, nil
}

// ExpenseInput reúne os dados de criação/edição de uma despesa (à vista ou parcelada).
type ExpenseInput struct {
	CategoryID        uuid.UUID
	PaymentMethodID   *uuid.UUID
	PaidByUserID      uuid.UUID // se uuid.Nil, assume o próprio usuário autenticado
	AmountCents       int64
	Description       string
	IncurredOn        string // AAAA-MM-DD
	Notes             string
	SplitStrategy     SplitStrategy
	Splits            []SplitInput
	TotalInstallments int // 1 (padrão) a 48
}

// RefundInput reúne os dados de criação de um estorno parcial ou total.
type RefundInput struct {
	AmountCents int64
	RefundedOn  string // AAAA-MM-DD
	Reason      string
}

// Validate sanitiza e valida os campos do estorno.
func (in *RefundInput) Validate() (time.Time, error) {
	if in.AmountCents <= 0 || in.AmountCents > MaxAmountCents {
		return time.Time{}, ErrInvalidRefundAmount
	}
	in.Reason = strings.TrimSpace(in.Reason)
	if utf8.RuneCountInString(in.Reason) > 300 {
		return time.Time{}, ErrInvalidRefundReason
	}
	if LooksLikeCardPAN(in.Reason) {
		return time.Time{}, ErrCardPANDetected
	}
	return ParseDate(in.RefundedOn)
}

// ParseDate converte AAAA-MM-DD em time.Time UTC.
func ParseDate(s string) (time.Time, error) {
	s = strings.TrimSpace(s)
	if len(s) != 10 {
		return time.Time{}, ErrInvalidDate
	}
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return time.Time{}, ErrInvalidDate
	}
	return t.UTC(), nil
}

// Validate sanitiza e valida os campos da despesa.
func (in *ExpenseInput) Validate() (time.Time, error) {
	if in.TotalInstallments == 0 {
		in.TotalInstallments = 1
	}
	if in.TotalInstallments < 1 || in.TotalInstallments > MaxInstallments {
		return time.Time{}, ErrInvalidInstallments
	}
	if in.AmountCents <= 0 || in.AmountCents > MaxAmountCents {
		return time.Time{}, ErrInvalidAmount
	}
	if in.AmountCents < int64(in.TotalInstallments) {
		return time.Time{}, ErrInvalidInstallments
	}
	in.Description = strings.TrimSpace(in.Description)
	dn := utf8.RuneCountInString(in.Description)
	if dn < 1 || dn > 160 {
		return time.Time{}, ErrInvalidDesc
	}
	in.Notes = strings.TrimSpace(in.Notes)
	if utf8.RuneCountInString(in.Notes) > 500 {
		return time.Time{}, ErrInvalidNotes
	}
	if LooksLikeCardPAN(in.Description) || LooksLikeCardPAN(in.Notes) {
		return time.Time{}, ErrCardPANDetected
	}
	if in.CategoryID == uuid.Nil {
		return time.Time{}, fmt.Errorf("categoria é obrigatória")
	}
	if in.SplitStrategy == "" {
		in.SplitStrategy = SplitEqual
	}
	if !in.SplitStrategy.Valid() {
		return time.Time{}, ErrInvalidSplit
	}
	return ParseDate(in.IncurredOn)
}

// InstallmentSlice descreve uma parcela individual calculada pelo cronograma.
type InstallmentSlice struct {
	Number      int32
	Total       int32
	AmountCents int64
	IncurredOn  time.Time
}

// AddMonthsClamped avança `months` meses preservando o dia do mês ou ajustando
// para o último dia válido quando o mês de destino é mais curto (ex.: fevereiro).
func AddMonthsClamped(base time.Time, months int) time.Time {
	y, m, d := base.UTC().Date()
	totalMonths := int(m) - 1 + months
	targetYear := y + totalMonths/12
	targetMonth := time.Month(totalMonths%12 + 1)
	if totalMonths < 0 && totalMonths%12 != 0 {
		targetYear--
		targetMonth += 12
	}
	// Último dia do mês de destino = dia 0 do mês seguinte.
	lastDay := time.Date(targetYear, targetMonth+1, 0, 0, 0, 0, 0, time.UTC).Day()
	if d > lastDay {
		d = lastDay
	}
	return time.Date(targetYear, targetMonth, d, 0, 0, 0, 0, time.UTC)
}

// ComputeInstallmentSchedule gera as N parcelas em centavos (resto na 1ª parcela)
// e calcula a data de cada parcela respeitando o dia de fechamento opcional do cartão (E4-D1).
func ComputeInstallmentSchedule(totalCents int64, totalInstallments int, purchaseDate time.Time, closingDay *int32) ([]InstallmentSlice, error) {
	if totalInstallments < 1 || totalInstallments > MaxInstallments || totalCents < int64(totalInstallments) {
		return nil, ErrInvalidInstallments
	}
	firstDate := purchaseDate.UTC()
	if closingDay != nil && *closingDay >= 1 && *closingDay <= 31 && firstDate.Day() >= int(*closingDay) {
		firstDate = AddMonthsClamped(firstDate, 1)
	}

	base := totalCents / int64(totalInstallments)
	rem := totalCents % int64(totalInstallments)

	out := make([]InstallmentSlice, totalInstallments)
	for i := 0; i < totalInstallments; i++ {
		amt := base
		if i == 0 {
			amt += rem
		}
		out[i] = InstallmentSlice{
			Number:      int32(i + 1),
			Total:       int32(totalInstallments),
			AmountCents: amt,
			IncurredOn:  AddMonthsClamped(firstDate, i),
		}
	}
	return out, nil
}

// ComputeSplits calcula de forma determinística as cotas em centavos para cada
// participante (ADR 0006 / E3-D1), garantindo sum(ShareCents) == totalCents.
func ComputeSplits(totalCents int64, paidBy uuid.UUID, strategy SplitStrategy, inputs []SplitInput) ([]SplitShare, error) {
	if totalCents <= 0 || len(inputs) == 0 {
		return nil, ErrInvalidSplit
	}

	seen := make(map[uuid.UUID]bool, len(inputs))
	items := make([]SplitInput, len(inputs))
	copy(items, inputs)
	for _, it := range items {
		if it.UserID == uuid.Nil || seen[it.UserID] {
			return nil, ErrInvalidSplit
		}
		seen[it.UserID] = true
	}

	// Ordena deterministicamente: paidBy primeiro, depois UserID crescente (E3-D1).
	slices.SortFunc(items, func(a, b SplitInput) int {
		if a.UserID == paidBy && b.UserID != paidBy {
			return -1
		}
		if b.UserID == paidBy && a.UserID != paidBy {
			return 1
		}
		return strings.Compare(a.UserID.String(), b.UserID.String())
	})

	if strategy == SplitExact {
		var sum int64
		out := make([]SplitShare, 0, len(items))
		for _, it := range items {
			if it.ShareCents <= 0 {
				return nil, ErrInvalidSplit
			}
			sum += it.ShareCents
			out = append(out, SplitShare{UserID: it.UserID, ShareCents: it.ShareCents})
		}
		if sum != totalCents {
			return nil, ErrInvalidSplit
		}
		return out, nil
	}

	weights := make([]int64, len(items))
	var totalWeight int64
	for i, it := range items {
		var w int64
		switch strategy {
		case SplitEqual:
			w = 1
		case SplitPercentage, SplitShares:
			if it.WeightBps <= 0 || it.WeightBps > 10000 {
				return nil, ErrInvalidSplit
			}
			w = int64(it.WeightBps)
		default:
			return nil, ErrInvalidSplit
		}
		weights[i] = w
		totalWeight += w
	}
	if strategy == SplitPercentage && totalWeight != 10000 {
		return nil, ErrInvalidSplit
	}
	if totalWeight <= 0 {
		return nil, ErrInvalidSplit
	}

	out := make([]SplitShare, len(items))
	var allocated int64
	for i, it := range items {
		share := (totalCents * weights[i]) / totalWeight
		allocated += share
		var wPtr *int32
		if strategy == SplitPercentage || strategy == SplitShares {
			wb := it.WeightBps
			wPtr = &wb
		}
		out[i] = SplitShare{
			UserID:     it.UserID,
			WeightBps:  wPtr,
			ShareCents: share,
		}
	}

	rem := totalCents - allocated
	for i := int64(0); i < rem; i++ {
		out[i].ShareCents++
	}
	return out, nil
}

// ComputeRefundSplits distribui o valor estornado proporcionalmente às cotas
// originais da despesa coletiva usando a mesma ordem determinística do ADR 0006.
func ComputeRefundSplits(refundCents int64, paidBy uuid.UUID, originalSplits []SplitShare) ([]SplitShare, error) {
	if refundCents <= 0 || len(originalSplits) == 0 {
		return nil, ErrInvalidRefundAmount
	}
	items := make([]SplitShare, len(originalSplits))
	copy(items, originalSplits)
	slices.SortFunc(items, func(a, b SplitShare) int {
		if a.UserID == paidBy && b.UserID != paidBy {
			return -1
		}
		if b.UserID == paidBy && a.UserID != paidBy {
			return 1
		}
		return strings.Compare(a.UserID.String(), b.UserID.String())
	})

	var totalOriginal int64
	for _, it := range items {
		totalOriginal += it.ShareCents
	}
	if totalOriginal <= 0 {
		return nil, ErrInvalidRefundAmount
	}

	out := make([]SplitShare, len(items))
	var allocated int64
	for i, it := range items {
		share := (refundCents * it.ShareCents) / totalOriginal
		allocated += share
		out[i] = SplitShare{UserID: it.UserID, ShareCents: share}
	}
	rem := refundCents - allocated
	for i := int64(0); i < rem; i++ {
		out[i].ShareCents++
	}
	return out, nil
}

// LooksLikeCardPAN detecta sequências de 12 a 19 dígitos (mesmo separados por
// espaços ou hífens) para impedir armazenamento acidental de número completo de cartão.
func LooksLikeCardPAN(s string) bool {
	digits := 0
	for _, r := range s {
		switch {
		case unicode.IsDigit(r):
			digits++
			if digits >= 12 {
				return true
			}
		case r == ' ' || r == '-':
			// separador comum em número de cartão; mantém contagem se já começou
		default:
			digits = 0
		}
	}
	return false
}
