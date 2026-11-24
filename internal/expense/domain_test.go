package expense

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestLooksLikeCardPAN(t *testing.T) {
	if !LooksLikeCardPAN("Cartão 4532 1122 3344 5566") {
		t.Fatal("deveria detectar PAN com espaços")
	}
	if !LooksLikeCardPAN("4532-1122-3344-5566") {
		t.Fatal("deveria detectar PAN com hífens")
	}
	if !LooksLikeCardPAN("4532112233445566") {
		t.Fatal("deveria detectar PAN contínuo")
	}
	if LooksLikeCardPAN("Supermercado dia 23/11 final 4321") {
		t.Fatal("não deveria acusar falso positivo em 4 últimos dígitos")
	}
}

func TestValidateLast4(t *testing.T) {
	valid := "1234"
	if out, err := ValidateLast4(KindCreditCard, &valid); err != nil || out == nil || *out != "1234" {
		t.Fatalf("esperava 1234 válido, obteve (%v, %v)", out, err)
	}
	if _, err := ValidateLast4(KindPIX, &valid); err != ErrInvalidLast4 {
		t.Fatalf("PIX não pode aceitar last4: %v", err)
	}
	bad := "12a4"
	if _, err := ValidateLast4(KindCreditCard, &bad); err != ErrInvalidLast4 {
		t.Fatalf("last4 não numérico deveria falhar: %v", err)
	}
	long := "12345"
	if _, err := ValidateLast4(KindCreditCard, &long); err != ErrInvalidLast4 {
		t.Fatalf("last4 com 5 dígitos deveria falhar: %v", err)
	}
}

func TestExpenseInputValidate(t *testing.T) {
	in := ExpenseInput{
		CategoryID:  uuid.New(),
		AmountCents: 15990,
		Description: "Mercado semanal",
		IncurredOn:  "2026-11-23",
	}
	if _, err := in.Validate(); err != nil {
		t.Fatalf("input válido falhou: %v", err)
	}
	neg := in
	neg.AmountCents = 0
	if _, err := neg.Validate(); err != ErrInvalidAmount {
		t.Fatalf("valor zero deveria falhar com ErrInvalidAmount: %v", err)
	}
	pan := in
	pan.Notes = "pago no cartão 4532 1111 2222 3333"
	if _, err := pan.Validate(); err != ErrCardPANDetected {
		t.Fatalf("PAN nas notas deveria falhar com ErrCardPANDetected: %v", err)
	}
}

func TestComputeSplitsDeterministicRemainder(t *testing.T) {
	u1 := uuid.MustParse("10000000-0000-0000-0000-000000000001")
	u2 := uuid.MustParse("20000000-0000-0000-0000-000000000002")
	u3 := uuid.MustParse("30000000-0000-0000-0000-000000000003")

	splits, err := ComputeSplits(10000, u3, SplitEqual, []SplitInput{
		{UserID: u1}, {UserID: u2}, {UserID: u3},
	})
	if err != nil {
		t.Fatalf("ComputeSplits equal: %v", err)
	}
	if len(splits) != 3 {
		t.Fatalf("esperava 3 cotas, obteve %d", len(splits))
	}
	if splits[0].UserID != u3 || splits[0].ShareCents != 3334 {
		t.Fatalf("pagador u3 deveria ser o primeiro e receber 3334, obteve %+v", splits[0])
	}
	if splits[1].ShareCents != 3333 || splits[2].ShareCents != 3333 {
		t.Fatalf("demais participantes deveriam receber 3333: %+v", splits)
	}
	if splits[0].ShareCents+splits[1].ShareCents+splits[2].ShareCents != 10000 {
		t.Fatal("soma das cotas difere de 10000")
	}

	if _, err := ComputeSplits(10000, u1, SplitExact, []SplitInput{
		{UserID: u1, ShareCents: 5000}, {UserID: u2, ShareCents: 4999},
	}); err != ErrInvalidSplit {
		t.Fatalf("exact com soma diferente deveria falhar: %v", err)
	}

	if _, err := ComputeSplits(10000, u1, SplitPercentage, []SplitInput{
		{UserID: u1, WeightBps: 5000}, {UserID: u2, WeightBps: 4000},
	}); err != ErrInvalidSplit {
		t.Fatalf("percentage != 10000 bps deveria falhar: %v", err)
	}
}

func TestComputeInstallmentSchedule(t *testing.T) {
	purchase, _ := ParseDate("2026-01-31")
	closing := int32(25)

	// Compra em 31/01 com fechamento no dia 25 -> 1ª parcela avança para 28/02/2026,
	// 2ª em 28/03/2026, 3ª em 28/04/2026. Valores: 3334, 3333, 3333 (soma = 10000).
	sched, err := ComputeInstallmentSchedule(10000, 3, purchase, &closing)
	if err != nil {
		t.Fatalf("ComputeInstallmentSchedule: %v", err)
	}
	if len(sched) != 3 {
		t.Fatalf("esperava 3 parcelas, obteve %d", len(sched))
	}
	if sched[0].AmountCents != 3334 || sched[1].AmountCents != 3333 || sched[2].AmountCents != 3333 {
		t.Fatalf("valores inesperados: %+v", sched)
	}
	wantDates := []string{"2026-02-28", "2026-03-28", "2026-04-28"}
	for i, w := range wantDates {
		if got := sched[i].IncurredOn.Format("2006-01-02"); got != w {
			t.Fatalf("parcela %d data = %s, queria %s", i+1, got, w)
		}
	}

	// Sem closing_day: 31/01 -> 28/02 -> 31/03.
	sched2, err := ComputeInstallmentSchedule(6000, 3, time.Date(2026, 1, 31, 0, 0, 0, 0, time.UTC), nil)
	if err != nil {
		t.Fatalf("ComputeInstallmentSchedule sem closing: %v", err)
	}
	if got := sched2[1].IncurredOn.Format("2006-01-02"); got != "2026-02-28" {
		t.Fatalf("parcela 2 = %s, queria 2026-02-28", got)
	}
	if got := sched2[2].IncurredOn.Format("2006-01-02"); got != "2026-03-31" {
		t.Fatalf("parcela 3 = %s, queria 2026-03-31", got)
	}
}

func TestRecurringAdvanceAndPeriodKey(t *testing.T) {
	start, _ := ParseDate("2026-01-31")
	if k := RecurringPeriodKey(start, FreqMonthly); k != "2026-01" {
		t.Fatalf("period key mensal = %s, queria 2026-01", k)
	}
	// 31/01 -> 28/02 -> 31/03 (recupera o dia 31 a partir de startDate!)
	d2 := AdvanceRecurringDate(start, start, FreqMonthly)
	if got := d2.Format("2006-01-02"); got != "2026-02-28" {
		t.Fatalf("2º vencimento = %s, queria 2026-02-28", got)
	}
	d3 := AdvanceRecurringDate(start, d2, FreqMonthly)
	if got := d3.Format("2006-01-02"); got != "2026-03-31" {
		t.Fatalf("3º vencimento = %s, queria 2026-03-31", got)
	}
}
