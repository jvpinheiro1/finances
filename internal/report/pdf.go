package report

import (
	"bytes"
	"fmt"
	"strings"

	"financas-familia/backend/internal/workspace"
)

// FormatPDF gera um documento PDF 1.4 nativo em Go puro (sem bibliotecas externas,
// sem Chromium/wkhtmltopdf) com fonte Helvetica (/WinAnsiEncoding para acentos pt-BR)
// e paginação automática (ADR 0010 / E7-D2).
func FormatPDF(sum Summary) []byte {
	var lines []string
	wsTitle := "Espaço Individual (Privado)"
	if sum.WorkspaceKind == workspace.KindHousehold {
		wsTitle = "Espaço da Família (Coletivo)"
	}

	lines = append(lines,
		"FINANCAS FAMILIA - RELATORIO FINANCEIRO",
		fmt.Sprintf("Ambiente: %s", wsTitle),
		fmt.Sprintf("Periodo: %s a %s", sum.FromDate, sum.ToDate),
		fmt.Sprintf("Lancamentos: %d  |  Bruto: R$ %s  |  Estornado: R$ %s  |  Liquido: R$ %s",
			sum.ExpenseCount,
			FormatCentsBRLPlain(sum.TotalGrossCents),
			FormatCentsBRLPlain(sum.TotalRefundedCents),
			FormatCentsBRLPlain(sum.TotalNetCents),
		),
		strings.Repeat("-", 88),
		"RESUMO POR CATEGORIA",
	)

	if len(sum.ByCategory) == 0 {
		lines = append(lines, "  (Sem lancamentos no periodo)")
	} else {
		for _, c := range sum.ByCategory {
			pct := fmt.Sprintf("%d,%02d%%", c.ShareBps/100, c.ShareBps%100)
			lines = append(lines, fmt.Sprintf("  %-28s  %3d lanc.   R$ %12s   (%s)",
				truncateStr(c.CategoryName, 28), c.ExpenseCount, FormatCentsBRLPlain(c.TotalNetCents), pct))
		}
	}

	if sum.WorkspaceKind == workspace.KindHousehold && len(sum.ByMember) > 0 {
		lines = append(lines,
			strings.Repeat("-", 88),
			"RESUMO POR MEMBRO (DESEMBOLSADO VS CONSUMIDO NA DIVISAO)",
		)
		for _, m := range sum.ByMember {
			lines = append(lines, fmt.Sprintf("  %-22s  Pagou: R$ %10s  |  Consumiu: R$ %10s  |  Saldo: R$ %10s",
				truncateStr(m.UserName, 22),
				FormatCentsBRLPlain(m.PaidNetCents),
				FormatCentsBRLPlain(m.ConsumedNetCents),
				FormatCentsBRLPlain(m.DeltaCents),
			))
		}
	}

	lines = append(lines,
		strings.Repeat("-", 88),
		"DETALHAMENTO DOS LANCAMENTOS",
		"  DATA        CATEGORIA         PAGO POR        VALOR LIQUIDO    DESCRICAO",
	)
	for _, exp := range sum.Items {
		desc := exp.Description
		if exp.InstallmentNumber != nil && exp.TotalInstallments != nil {
			desc = fmt.Sprintf("%s (%d/%d)", desc, *exp.InstallmentNumber, *exp.TotalInstallments)
		}
		lines = append(lines, fmt.Sprintf("  %-10s  %-16s  %-14s  R$ %12s  %s",
			exp.IncurredOn,
			truncateStr(exp.CategoryName, 16),
			truncateStr(exp.PaidByName, 14),
			FormatCentsBRLPlain(exp.NetAmountCents),
			truncateStr(desc, 34),
		))
	}

	return buildSimplePDF(lines)
}

func truncateStr(s string, maxRunes int) string {
	r := []rune(s)
	if len(r) <= maxRunes {
		return s
	}
	return string(r[:maxRunes-1]) + "."
}

// toWinAnsi converte UTF-8 para bytes compatíveis com WinAnsiEncoding (ISO-8859-1)
// e escapa parênteses e barras invertidas da sintaxe de strings literais do PDF.
func toWinAnsi(s string) []byte {
	var out bytes.Buffer
	for _, r := range s {
		switch r {
		case '(', ')', '\\':
			out.WriteByte('\\')
			out.WriteByte(byte(r))
		case '•':
			out.WriteByte('*')
		default:
			if r >= 0x20 && r <= 0xFF {
				out.WriteByte(byte(r))
			} else {
				out.WriteByte('?')
			}
		}
	}
	return out.Bytes()
}

// buildSimplePDF monta um arquivo PDF 1.4 multipágina válido usando Courier
// (monoespaçada para alinhamento de tabelas) com WinAnsiEncoding.
func buildSimplePDF(lines []string) []byte {
	const linesPerPage = 48
	var pages [][]string
	if len(lines) == 0 {
		pages = [][]string{{""}}
	} else {
		for i := 0; i < len(lines); i += linesPerPage {
			end := min(i+linesPerPage, len(lines))
			pages = append(pages, lines[i:end])
		}
	}

	// Objetos PDF:
	// 1: Catalog
	// 2: Pages
	// 3: Font (Courier com WinAnsiEncoding)
	// Para cada página p (0..P-1):
	//   4 + 2*p: Page object
	//   5 + 2*p: Content stream
	totalObjs := 3 + 2*len(pages)
	offsets := make([]int, totalObjs+1)

	var buf bytes.Buffer
	buf.WriteString("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")

	writeObj := func(id int, body []byte) {
		offsets[id] = buf.Len()
		fmt.Fprintf(&buf, "%d 0 obj\n", id)
		buf.Write(body)
		buf.WriteString("\nendobj\n")
	}

	writeObj(1, []byte("<< /Type /Catalog /Pages 2 0 R >>"))

	var kids strings.Builder
	kids.WriteString("[")
	for p := range pages {
		if p > 0 {
			kids.WriteByte(' ')
		}
		fmt.Fprintf(&kids, "%d 0 R", 4+2*p)
	}
	kids.WriteString("]")
	writeObj(2, []byte(fmt.Sprintf("<< /Type /Pages /Kids %s /Count %d >>", kids.String(), len(pages))))

	writeObj(3, []byte("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>"))

	for p, pageLines := range pages {
		pageObjID := 4 + 2*p
		contentObjID := 5 + 2*p

		var stream bytes.Buffer
		stream.WriteString("BT\n/F1 9 Tf\n14 TL\n36 790 Td\n")
		for i, line := range pageLines {
			if i > 0 {
				stream.WriteString("T*\n")
			}
			stream.WriteByte('(')
			stream.Write(toWinAnsi(line))
			stream.WriteString(") Tj\n")
		}
		stream.WriteString("ET")
		streamBytes := stream.Bytes()

		pageBody := fmt.Sprintf(
			"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents %d 0 R >>",
			contentObjID,
		)
		writeObj(pageObjID, []byte(pageBody))

		var contentObj bytes.Buffer
		fmt.Fprintf(&contentObj, "<< /Length %d >>\nstream\n", len(streamBytes))
		contentObj.Write(streamBytes)
		contentObj.WriteString("\nendstream")
		writeObj(contentObjID, contentObj.Bytes())
	}

	xrefOffset := buf.Len()
	fmt.Fprintf(&buf, "xref\n0 %d\n", totalObjs+1)
	buf.WriteString("0000000000 65535 f \n")
	for id := 1; id <= totalObjs; id++ {
		fmt.Fprintf(&buf, "%010d 00000 n \n", offsets[id])
	}
	fmt.Fprintf(&buf, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", totalObjs+1, xrefOffset)
	return buf.Bytes()
}
