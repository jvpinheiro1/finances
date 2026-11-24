package settlement

import (
	"testing"

	"github.com/google/uuid"
)

func TestComputeBalances(t *testing.T) {
	ana := MemberRef{ID: uuid.MustParse("10000000-0000-0000-0000-000000000001"), Name: "Ana"}
	bruno := MemberRef{ID: uuid.MustParse("20000000-0000-0000-0000-000000000002"), Name: "Bruno"}

	// Bruno deve 5000 centavos a Ana (despesa 1), e Ana deve 2000 a Bruno (despesa 2).
	// Líquido antes de reembolso: Bruno deve 3000 a Ana.
	// Bruno paga reembolso confirmado de 1000 a Ana -> Bruno passa a dever 2000 a Ana.
	sum := ComputeBalances(
		[]MemberRef{ana, bruno},
		[]DirectedTotal{
			{DebtorID: bruno.ID, CreditorID: ana.ID, TotalCents: 5000},
			{DebtorID: ana.ID, CreditorID: bruno.ID, TotalCents: 2000},
		},
		[]DirectedTotal{
			{DebtorID: bruno.ID, CreditorID: ana.ID, TotalCents: 1000},
		},
	)

	if len(sum.Pairwise) != 1 {
		t.Fatalf("esperava 1 dívida bilateral líquida, obteve %d", len(sum.Pairwise))
	}
	p := sum.Pairwise[0]
	if p.FromUserID != bruno.ID || p.ToUserID != ana.ID || p.AmountCents != 2000 {
		t.Fatalf("esperava Bruno devendo 2000 a Ana, obteve %+v", p)
	}
}
