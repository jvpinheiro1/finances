package report

import (
	"bytes"
	"strings"
	"testing"

	"github.com/google/uuid"

	"financas-familia/backend/internal/expense"
	"financas-familia/backend/internal/household"
	"financas-familia/backend/internal/workspace"
)

func TestSanitizeCSVCell(t *testing.T) {
	cases := map[string]string{
		"=CMD|' /C calc'!A0": "'=CMD|' /C calc'!A0",
		"+1+1":               "'+1+1",
		"-2+3":               "'-2+3",
		"@SUM(A1:A2)":        "'@SUM(A1:A2)",
		"Supermercado":       "Supermercado",
		"":                   "",
	}
	for in, want := range cases {
		if got := SanitizeCSVCell(in); got != want {
			t.Fatalf("SanitizeCSVCell(%q) = %q, queria %q", in, got, want)
		}
	}
}

func TestComputeSummaryAndExports(t *testing.T) {
	ws := workspace.Workspace{ID: uuid.New(), HouseholdID: uuid.New(), Kind: workspace.KindHousehold}
	ana := household.Member{ID: uuid.MustParse("10000000-0000-0000-0000-000000000001"), Name: "Ana"}
	bruno := household.Member{ID: uuid.MustParse("20000000-0000-0000-0000-000000000002"), Name: "Bruno"}
	catID := uuid.New()

	// Despesa coletiva de 10000 centavos com estorno de 2000 -> líquido 8000 (4000 para cada um).
	items := []expense.Expense{
		{
			ID:             uuid.New(),
			WorkspaceID:    ws.ID,
			CategoryID:     catID,
			CategoryName:   "Alimentação",
			PaidByUserID:   ana.ID,
			PaidByName:     ana.Name,
			AmountCents:    10000,
			RefundedCents:  2000,
			NetAmountCents: 8000,
			Description:    "=Supermercado com fórmula",
			IncurredOn:     "2026-11-20",
			Splits: []expense.SplitShare{
				{UserID: ana.ID, UserName: ana.Name, ShareCents: 5000},
				{UserID: bruno.ID, UserName: bruno.Name, ShareCents: 5000},
			},
		},
	}

	sum := ComputeSummary(ws, "2026-11-01", "2026-11-30", items, []household.Member{ana, bruno})
	if sum.TotalGrossCents != 10000 || sum.TotalRefundedCents != 2000 || sum.TotalNetCents != 8000 {
		t.Fatalf("totais incorretos: %+v", sum)
	}
	if len(sum.ByMember) != 2 {
		t.Fatalf("esperava 2 membros, obteve %d", len(sum.ByMember))
	}
	for _, m := range sum.ByMember {
		if m.ConsumedNetCents != 4000 {
			t.Fatalf("consumo líquido de %s = %d, queria 4000", m.UserName, m.ConsumedNetCents)
		}
	}

	csvBytes, err := FormatCSV(sum)
	if err != nil {
		t.Fatalf("FormatCSV: %v", err)
	}
	if !bytes.HasPrefix(csvBytes, []byte("\xEF\xBB\xBF")) {
		t.Fatal("CSV deveria começar com UTF-8 BOM")
	}
	if !strings.Contains(string(csvBytes), "';'=Supermercado com fórmula;") &&
		!strings.Contains(string(csvBytes), ";'=Supermercado com fórmula;") {
		t.Fatalf("CSV deveria escapar célula iniciada com '=': %s", string(csvBytes))
	}

	pdfBytes := FormatPDF(sum)
	if !bytes.HasPrefix(pdfBytes, []byte("%PDF-1.4\n")) || !bytes.HasSuffix(pdfBytes, []byte("%%EOF\n")) {
		t.Fatal("PDF inválido")
	}
}
