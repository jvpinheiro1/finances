// Package report gera relatórios financeiros em centavos por período, categoria,
// meio de pagamento e membro, além de exportações CSV (anti-injection) e PDF.
package report

import (
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"financas-familia/backend/internal/expense"
	"financas-familia/backend/internal/household"
	"financas-familia/backend/internal/platform/authctx"
	"financas-familia/backend/internal/platform/httpx"
	"financas-familia/backend/internal/workspace"
)

// Erros de domínio.
var (
	ErrInvalidPeriod = errors.New("período inválido: a data inicial não pode ser posterior à final e o intervalo máximo é de 366 dias")
)

// MaxReportDays limita o intervalo de um relatório a 1 ano bissexto (366 dias).
const MaxReportDays = 366

// CategoryRow resume o gasto líquido de uma categoria no período.
type CategoryRow struct {
	CategoryID    uuid.UUID `json:"category_id"`
	CategoryName  string    `json:"category_name"`
	ExpenseCount  int       `json:"expense_count"`
	TotalNetCents int64     `json:"total_net_cents"`
	ShareBps      int64     `json:"share_bps"` // 10000 = 100,00%
}

// PaymentMethodRow resume o gasto líquido por meio de pagamento no período.
type PaymentMethodRow struct {
	Label         string `json:"label"`
	ExpenseCount  int    `json:"expense_count"`
	TotalNetCents int64  `json:"total_net_cents"`
	ShareBps      int64  `json:"share_bps"`
}

// MemberRow resume quanto cada membro desembolsou (pagou) vs quanto consumiu
// nas divisões de despesas coletivas do período.
type MemberRow struct {
	UserID           uuid.UUID `json:"user_id"`
	UserName         string    `json:"user_name"`
	PaidNetCents     int64     `json:"paid_net_cents"`
	ConsumedNetCents int64     `json:"consumed_net_cents"`
	DeltaCents       int64     `json:"delta_cents"` // PaidNetCents - ConsumedNetCents
}

// Summary é o relatório consolidado de um ambiente em um período.
type Summary struct {
	WorkspaceID        uuid.UUID          `json:"workspace_id"`
	WorkspaceKind      workspace.Kind     `json:"workspace_kind"`
	FromDate           string             `json:"from_date"`
	ToDate             string             `json:"to_date"`
	ExpenseCount       int                `json:"expense_count"`
	TotalGrossCents    int64              `json:"total_gross_cents"`
	TotalRefundedCents int64              `json:"total_refunded_cents"`
	TotalNetCents      int64              `json:"total_net_cents"`
	ByCategory         []CategoryRow      `json:"by_category"`
	ByPaymentMethod    []PaymentMethodRow `json:"by_payment_method"`
	ByMember           []MemberRow        `json:"by_member"`
	Items              []expense.Expense  `json:"items"`
}

// Service gera relatórios consumindo os serviços públicos de workspace, expense e household.
type Service struct {
	wsSvc  *workspace.Service
	expSvc *expense.Service
	hhSvc  *household.Service
}

// NewService cria o serviço de relatórios.
func NewService(wsSvc *workspace.Service, expSvc *expense.Service, hhSvc *household.Service) *Service {
	return &Service{wsSvc: wsSvc, expSvc: expSvc, hhSvc: hhSvc}
}

// ResolvePeriod valida fromStr e toStr (ou aplica o mês atual como padrão).
func ResolvePeriod(fromStr, toStr string, now time.Time) (string, string, error) {
	u := now.UTC()
	if strings.TrimSpace(fromStr) == "" && strings.TrimSpace(toStr) == "" {
		first := time.Date(u.Year(), u.Month(), 1, 0, 0, 0, 0, time.UTC)
		last := expense.AddMonthsClamped(first, 1).AddDate(0, 0, -1)
		return first.Format("2006-01-02"), last.Format("2006-01-02"), nil
	}
	from, err := expense.ParseDate(fromStr)
	if err != nil {
		return "", "", expense.ErrInvalidDate
	}
	to, err := expense.ParseDate(toStr)
	if err != nil {
		return "", "", expense.ErrInvalidDate
	}
	if to.Before(from) {
		return "", "", ErrInvalidPeriod
	}
	days := int(to.Sub(from).Hours()/24) + 1
	if days > MaxReportDays {
		return "", "", ErrInvalidPeriod
	}
	return from.Format("2006-01-02"), to.Format("2006-01-02"), nil
}

// BuildSummary gera o relatório completo do ambiente no período informado.
func (s *Service) BuildSummary(ctx context.Context, v workspace.Viewer, wsID uuid.UUID, fromStr, toStr string) (Summary, error) {
	fromDate, toDate, err := ResolvePeriod(fromStr, toStr, time.Now())
	if err != nil {
		return Summary{}, err
	}
	ws, err := s.wsSvc.Get(ctx, v, wsID)
	if err != nil {
		return Summary{}, err
	}
	listRes, err := s.expSvc.ListByWorkspace(ctx, v, wsID, expense.ExpenseFilter{
		FromDate: &fromDate,
		ToDate:   &toDate,
	})
	if err != nil {
		return Summary{}, err
	}

	var members []household.Member
	if ws.Kind == workspace.KindHousehold {
		hh, err := s.hhSvc.Get(ctx, v.HouseholdID)
		if err != nil {
			return Summary{}, err
		}
		members = hh.Members
	}

	return ComputeSummary(ws, fromDate, toDate, listRes.Items, members), nil
}

// ComputeSummary agrega em memória (usando apenas int64 em centavos) os dados do relatório.
func ComputeSummary(ws workspace.Workspace, fromDate, toDate string, items []expense.Expense, members []household.Member) Summary {
	sum := Summary{
		WorkspaceID:     ws.ID,
		WorkspaceKind:   ws.Kind,
		FromDate:        fromDate,
		ToDate:          toDate,
		ExpenseCount:    len(items),
		ByCategory:      []CategoryRow{},
		ByPaymentMethod: []PaymentMethodRow{},
		ByMember:        []MemberRow{},
		Items:           items,
	}

	catMap := make(map[uuid.UUID]*CategoryRow)
	pmMap := make(map[string]*PaymentMethodRow)
	memberMap := make(map[uuid.UUID]*MemberRow)

	for _, m := range members {
		memberMap[m.ID] = &MemberRow{UserID: m.ID, UserName: m.Name}
	}

	for _, exp := range items {
		sum.TotalGrossCents += exp.AmountCents
		sum.TotalRefundedCents += exp.RefundedCents
		sum.TotalNetCents += exp.NetAmountCents

		cr, ok := catMap[exp.CategoryID]
		if !ok {
			cr = &CategoryRow{CategoryID: exp.CategoryID, CategoryName: exp.CategoryName}
			catMap[exp.CategoryID] = cr
		}
		cr.ExpenseCount++
		cr.TotalNetCents += exp.NetAmountCents

		pmLabel := "Não informado"
		if exp.PaymentMethodName != nil && *exp.PaymentMethodName != "" {
			pmLabel = *exp.PaymentMethodName
			if exp.PaymentMethodLast != nil && *exp.PaymentMethodLast != "" {
				pmLabel += " (•••• " + *exp.PaymentMethodLast + ")"
			}
		}
		pr, ok := pmMap[pmLabel]
		if !ok {
			pr = &PaymentMethodRow{Label: pmLabel}
			pmMap[pmLabel] = pr
		}
		pr.ExpenseCount++
		pr.TotalNetCents += exp.NetAmountCents

		if ws.Kind == workspace.KindHousehold {
			mr, ok := memberMap[exp.PaidByUserID]
			if !ok {
				mr = &MemberRow{UserID: exp.PaidByUserID, UserName: exp.PaidByName}
				memberMap[exp.PaidByUserID] = mr
			}
			mr.PaidNetCents += exp.NetAmountCents

			if exp.NetAmountCents > 0 && len(exp.Splits) > 0 {
				netSplits := exp.Splits
				if exp.RefundedCents > 0 {
					if calc, err := expense.ComputeRefundSplits(exp.NetAmountCents, exp.PaidByUserID, exp.Splits); err == nil {
						netSplits = calc
					}
				}
				for _, sp := range netSplits {
					smr, ok := memberMap[sp.UserID]
					if !ok {
						name := sp.UserName
						if name == "" {
							name = "Membro"
						}
						smr = &MemberRow{UserID: sp.UserID, UserName: name}
						memberMap[sp.UserID] = smr
					}
					smr.ConsumedNetCents += sp.ShareCents
				}
			}
		}
	}

	for _, cr := range catMap {
		if sum.TotalNetCents > 0 {
			cr.ShareBps = (cr.TotalNetCents * 10000) / sum.TotalNetCents
		}
		sum.ByCategory = append(sum.ByCategory, *cr)
	}
	slices.SortFunc(sum.ByCategory, func(a, b CategoryRow) int {
		if a.TotalNetCents != b.TotalNetCents {
			if a.TotalNetCents > b.TotalNetCents {
				return -1
			}
			return 1
		}
		return strings.Compare(a.CategoryName, b.CategoryName)
	})

	for _, pr := range pmMap {
		if sum.TotalNetCents > 0 {
			pr.ShareBps = (pr.TotalNetCents * 10000) / sum.TotalNetCents
		}
		sum.ByPaymentMethod = append(sum.ByPaymentMethod, *pr)
	}
	slices.SortFunc(sum.ByPaymentMethod, func(a, b PaymentMethodRow) int {
		if a.TotalNetCents != b.TotalNetCents {
			if a.TotalNetCents > b.TotalNetCents {
				return -1
			}
			return 1
		}
		return strings.Compare(a.Label, b.Label)
	})

	if ws.Kind == workspace.KindHousehold {
		for _, mr := range memberMap {
			mr.DeltaCents = mr.PaidNetCents - mr.ConsumedNetCents
			sum.ByMember = append(sum.ByMember, *mr)
		}
		slices.SortFunc(sum.ByMember, func(a, b MemberRow) int {
			return strings.Compare(a.UserName, b.UserName)
		})
	}
	return sum
}

// SanitizeCSVCell protege contra CSV Formula Injection (OWASP) prefixando "'"
// quando o texto começa com '=', '+', '-', '@', '\t' ou '\r'.
func SanitizeCSVCell(s string) string {
	if s == "" {
		return ""
	}
	switch s[0] {
	case '=', '+', '-', '@', '\t', '\r':
		return "'" + s
	default:
		return s
	}
}

// FormatCentsBRLPlain formata centavos inteiros como "123,45" (sem float).
func FormatCentsBRLPlain(cents int64) string {
	neg := cents < 0
	if neg {
		cents = -cents
	}
	reais := cents / 100
	rem := cents % 100
	prefix := ""
	if neg {
		prefix = "-"
	}
	return fmt.Sprintf("%s%d,%02d", prefix, reais, rem)
}

// FormatCSV gera o CSV do relatório em UTF-8 com BOM e separador ';' (E7-D1).
func FormatCSV(sum Summary) ([]byte, error) {
	var buf bytes.Buffer
	// UTF-8 BOM para Excel em pt-BR reconhecer acentuação automaticamente.
	buf.WriteString("\xEF\xBB\xBF")

	w := csv.NewWriter(&buf)
	w.Comma = ';'

	header := []string{
		"data",
		"descricao",
		"categoria",
		"meio_pagamento",
		"pago_por",
		"parcela",
		"valor_bruto_centavos",
		"valor_estornado_centavos",
		"valor_liquido_centavos",
		"valor_liquido_brl",
		"observacoes",
	}
	if err := w.Write(header); err != nil {
		return nil, err
	}

	for _, exp := range sum.Items {
		pm := ""
		if exp.PaymentMethodName != nil {
			pm = *exp.PaymentMethodName
			if exp.PaymentMethodLast != nil && *exp.PaymentMethodLast != "" {
				pm += " (final " + *exp.PaymentMethodLast + ")"
			}
		}
		inst := ""
		if exp.InstallmentNumber != nil && exp.TotalInstallments != nil {
			inst = fmt.Sprintf("%d/%d", *exp.InstallmentNumber, *exp.TotalInstallments)
		}
		row := []string{
			exp.IncurredOn,
			SanitizeCSVCell(exp.Description),
			SanitizeCSVCell(exp.CategoryName),
			SanitizeCSVCell(pm),
			SanitizeCSVCell(exp.PaidByName),
			inst,
			strconv.FormatInt(exp.AmountCents, 10),
			strconv.FormatInt(exp.RefundedCents, 10),
			strconv.FormatInt(exp.NetAmountCents, 10),
			FormatCentsBRLPlain(exp.NetAmountCents),
			SanitizeCSVCell(exp.Notes),
		}
		if err := w.Write(row); err != nil {
			return nil, err
		}
	}
	w.Flush()
	if err := w.Error(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// Handler expõe as rotas REST de relatórios e exportação CSV / PDF.
type Handler struct {
	svc *Service
}

// NewHandler cria o handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Register registra as rotas da Etapa 7 no mux.
func (h *Handler) Register(mux *http.ServeMux, requireUser func(http.Handler) http.Handler) {
	mux.Handle("GET /api/v1/workspaces/{wsId}/reports/summary", requireUser(http.HandlerFunc(h.summary)))
	mux.Handle("GET /api/v1/workspaces/{wsId}/reports/export.csv", requireUser(http.HandlerFunc(h.exportCSV)))
	mux.Handle("GET /api/v1/workspaces/{wsId}/reports/export.pdf", requireUser(http.HandlerFunc(h.exportPDF)))
}

func viewerFrom(r *http.Request) (workspace.Viewer, bool) {
	p, ok := authctx.From(r.Context())
	return workspace.Viewer{UserID: p.UserID, HouseholdID: p.HouseholdID}, ok
}

func (h *Handler) buildFromRequest(w http.ResponseWriter, r *http.Request) (Summary, bool) {
	v, ok := viewerFrom(r)
	if !ok {
		httpx.Unauthorized(w)
		return Summary{}, false
	}
	wsID, err := uuid.Parse(r.PathValue("wsId"))
	if err != nil {
		httpx.NotFound(w)
		return Summary{}, false
	}
	q := r.URL.Query()
	sum, err := h.svc.BuildSummary(r.Context(), v, wsID, q.Get("from"), q.Get("to"))
	switch {
	case err == nil:
		return sum, true
	case errors.Is(err, workspace.ErrNotFound), errors.Is(err, expense.ErrNotFound):
		httpx.NotFound(w)
	case errors.Is(err, expense.ErrInvalidDate), errors.Is(err, ErrInvalidPeriod):
		httpx.WriteError(w, http.StatusUnprocessableEntity, "validation_error", err.Error())
	default:
		httpx.InternalError(w, r, err)
	}
	return Summary{}, false
}

func (h *Handler) summary(w http.ResponseWriter, r *http.Request) {
	sum, ok := h.buildFromRequest(w, r)
	if !ok {
		return
	}
	httpx.WriteJSON(w, http.StatusOK, sum)
}

func (h *Handler) exportCSV(w http.ResponseWriter, r *http.Request) {
	sum, ok := h.buildFromRequest(w, r)
	if !ok {
		return
	}
	data, err := FormatCSV(sum)
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	filename := fmt.Sprintf("relatorio-%s-%s-a-%s.csv", sum.WorkspaceKind, sum.FromDate, sum.ToDate)
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func (h *Handler) exportPDF(w http.ResponseWriter, r *http.Request) {
	sum, ok := h.buildFromRequest(w, r)
	if !ok {
		return
	}
	data := FormatPDF(sum)
	filename := fmt.Sprintf("relatorio-%s-%s-a-%s.pdf", sum.WorkspaceKind, sum.FromDate, sum.ToDate)
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}
