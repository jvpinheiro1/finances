package expense

import (
	"errors"
	"net/http"

	"github.com/google/uuid"

	"financas-familia/backend/internal/platform/authctx"
	"financas-familia/backend/internal/platform/httpx"
	"financas-familia/backend/internal/workspace"
)

// Handler expõe as rotas REST de categorias, meios de pagamento, despesas,
// parcelamentos, estornos e despesas/assinaturas recorrentes.
type Handler struct {
	svc *Service
}

// NewHandler cria o handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Register registra as rotas das Etapas 2, 3, 4 e 5 no mux.
func (h *Handler) Register(mux *http.ServeMux, requireUser func(http.Handler) http.Handler) {
	mux.Handle("GET /api/v1/categories", requireUser(http.HandlerFunc(h.listCategories)))
	mux.Handle("POST /api/v1/categories", requireUser(http.HandlerFunc(h.createCategory)))
	mux.Handle("PATCH /api/v1/categories/{id}", requireUser(http.HandlerFunc(h.updateCategory)))

	mux.Handle("GET /api/v1/payment-methods", requireUser(http.HandlerFunc(h.listPaymentMethods)))
	mux.Handle("POST /api/v1/payment-methods", requireUser(http.HandlerFunc(h.createPaymentMethod)))
	mux.Handle("PATCH /api/v1/payment-methods/{id}", requireUser(http.HandlerFunc(h.updatePaymentMethod)))

	mux.Handle("GET /api/v1/workspaces/{wsId}/expenses", requireUser(http.HandlerFunc(h.listExpenses)))
	mux.Handle("POST /api/v1/workspaces/{wsId}/expenses", requireUser(http.HandlerFunc(h.createExpense)))

	mux.Handle("GET /api/v1/expenses/{id}", requireUser(http.HandlerFunc(h.getExpense)))
	mux.Handle("PATCH /api/v1/expenses/{id}", requireUser(http.HandlerFunc(h.updateExpense)))
	mux.Handle("DELETE /api/v1/expenses/{id}", requireUser(http.HandlerFunc(h.deleteExpense)))
	mux.Handle("POST /api/v1/expenses/{id}/share-with-household", requireUser(http.HandlerFunc(h.shareExpense)))

	mux.Handle("GET /api/v1/expenses/{id}/refunds", requireUser(http.HandlerFunc(h.listRefunds)))
	mux.Handle("POST /api/v1/expenses/{id}/refunds", requireUser(http.HandlerFunc(h.createRefund)))

	mux.Handle("DELETE /api/v1/installment-plans/{planId}", requireUser(http.HandlerFunc(h.deleteInstallmentPlan)))

	mux.Handle("GET /api/v1/workspaces/{wsId}/recurring-rules", requireUser(http.HandlerFunc(h.listRecurringRules)))
	mux.Handle("POST /api/v1/workspaces/{wsId}/recurring-rules", requireUser(http.HandlerFunc(h.createRecurringRule)))
	mux.Handle("POST /api/v1/workspaces/{wsId}/recurring-rules/generate", requireUser(http.HandlerFunc(h.generateRecurringRules)))
	mux.Handle("PATCH /api/v1/recurring-rules/{id}", requireUser(http.HandlerFunc(h.updateRecurringRule)))
	mux.Handle("DELETE /api/v1/recurring-rules/{id}", requireUser(http.HandlerFunc(h.deleteRecurringRule)))
}

func viewerFrom(r *http.Request) (workspace.Viewer, bool) {
	p, ok := authctx.From(r.Context())
	return workspace.Viewer{UserID: p.UserID, HouseholdID: p.HouseholdID}, ok
}

// === Categorias ===

func (h *Handler) listCategories(w http.ResponseWriter, r *http.Request) {
	v, ok := viewerFrom(r)
	if !ok {
		httpx.Unauthorized(w)
		return
	}
	inc := r.URL.Query().Get("include_archived") == "true"
	items, err := h.svc.ListCategories(r.Context(), v, inc)
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
}

type categoryReq struct {
	Name       string `json:"name"`
	IsArchived bool   `json:"is_archived"`
}

func (h *Handler) createCategory(w http.ResponseWriter, r *http.Request) {
	v, ok := viewerFrom(r)
	if !ok {
		httpx.Unauthorized(w)
		return
	}
	var req categoryReq
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.BadRequest(w, err.Error())
		return
	}
	cat, err := h.svc.CreateCategory(r.Context(), v, req.Name)
	switch {
	case errors.Is(err, ErrDuplicateCategory):
		httpx.WriteError(w, http.StatusConflict, "duplicate_category", err.Error())
	case errors.Is(err, ErrInvalidName), errors.Is(err, ErrCardPANDetected):
		httpx.WriteError(w, http.StatusUnprocessableEntity, "validation_error", err.Error())
	case err != nil:
		httpx.InternalError(w, r, err)
	default:
		httpx.WriteJSON(w, http.StatusCreated, cat)
	}
}

func (h *Handler) updateCategory(w http.ResponseWriter, r *http.Request) {
	v, ok := viewerFrom(r)
	if !ok {
		httpx.Unauthorized(w)
		return
	}
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.NotFound(w)
		return
	}
	var req categoryReq
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.BadRequest(w, err.Error())
		return
	}
	cat, err := h.svc.UpdateCategory(r.Context(), v, id, req.Name, req.IsArchived)
	switch {
	case errors.Is(err, ErrNotFound):
		httpx.NotFound(w)
	case errors.Is(err, ErrDuplicateCategory):
		httpx.WriteError(w, http.StatusConflict, "duplicate_category", err.Error())
	case errors.Is(err, ErrInvalidName), errors.Is(err, ErrCardPANDetected):
		httpx.WriteError(w, http.StatusUnprocessableEntity, "validation_error", err.Error())
	case err != nil:
		httpx.InternalError(w, r, err)
	default:
		httpx.WriteJSON(w, http.StatusOK, cat)
	}
}

// === Meios de pagamento ===

func (h *Handler) listPaymentMethods(w http.ResponseWriter, r *http.Request) {
	v, ok := viewerFrom(r)
	if !ok {
		httpx.Unauthorized(w)
		return
	}
	inc := r.URL.Query().Get("include_archived") == "true"
	items, err := h.svc.ListPaymentMethods(r.Context(), v, inc)
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
}

type createPMReq struct {
	Name       string      `json:"name"`
	Kind       PaymentKind `json:"kind"`
	Last4      *string     `json:"last4"`
	ClosingDay *int32      `json:"closing_day"`
	DueDay     *int32      `json:"due_day"`
	IsPersonal bool        `json:"is_personal"`
}

func (h *Handler) createPaymentMethod(w http.ResponseWriter, r *http.Request) {
	v, ok := viewerFrom(r)
	if !ok {
		httpx.Unauthorized(w)
		return
	}
	var req createPMReq
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.BadRequest(w, err.Error())
		return
	}
	pm, err := h.svc.CreatePaymentMethod(r.Context(), v, CreatePaymentMethodInput{
		Name: req.Name, Kind: req.Kind, Last4: req.Last4,
		ClosingDay: req.ClosingDay, DueDay: req.DueDay, IsPersonal: req.IsPersonal,
	})
	switch {
	case errors.Is(err, ErrInvalidName),
		errors.Is(err, ErrInvalidKind),
		errors.Is(err, ErrInvalidLast4),
		errors.Is(err, ErrInvalidBillingDay),
		errors.Is(err, ErrCardPANDetected):
		httpx.WriteError(w, http.StatusUnprocessableEntity, "validation_error", err.Error())
	case err != nil:
		httpx.InternalError(w, r, err)
	default:
		httpx.WriteJSON(w, http.StatusCreated, pm)
	}
}

type updatePMReq struct {
	Name       string `json:"name"`
	ClosingDay *int32 `json:"closing_day"`
	DueDay     *int32 `json:"due_day"`
	IsArchived bool   `json:"is_archived"`
}

func (h *Handler) updatePaymentMethod(w http.ResponseWriter, r *http.Request) {
	v, ok := viewerFrom(r)
	if !ok {
		httpx.Unauthorized(w)
		return
	}
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.NotFound(w)
		return
	}
	var req updatePMReq
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.BadRequest(w, err.Error())
		return
	}
	pm, err := h.svc.UpdatePaymentMethod(r.Context(), v, id, req.Name, req.ClosingDay, req.DueDay, req.IsArchived)
	switch {
	case errors.Is(err, ErrNotFound):
		httpx.NotFound(w)
	case errors.Is(err, ErrInvalidName), errors.Is(err, ErrInvalidBillingDay), errors.Is(err, ErrCardPANDetected):
		httpx.WriteError(w, http.StatusUnprocessableEntity, "validation_error", err.Error())
	case err != nil:
		httpx.InternalError(w, r, err)
	default:
		httpx.WriteJSON(w, http.StatusOK, pm)
	}
}

// === Despesas, Parcelamentos e Estornos ===

func (h *Handler) listExpenses(w http.ResponseWriter, r *http.Request) {
	v, ok := viewerFrom(r)
	if !ok {
		httpx.Unauthorized(w)
		return
	}
	wsID, err := uuid.Parse(r.PathValue("wsId"))
	if err != nil {
		httpx.NotFound(w)
		return
	}
	q := r.URL.Query()
	var f ExpenseFilter
	if from := q.Get("from"); from != "" {
		f.FromDate = &from
	}
	if to := q.Get("to"); to != "" {
		f.ToDate = &to
	}
	if catStr := q.Get("category_id"); catStr != "" {
		catID, err := uuid.Parse(catStr)
		if err != nil {
			httpx.BadRequest(w, "category_id inválido")
			return
		}
		f.CategoryID = &catID
	}
	res, err := h.svc.ListByWorkspace(r.Context(), v, wsID, f)
	switch {
	case errors.Is(err, ErrNotFound):
		httpx.NotFound(w)
	case errors.Is(err, ErrInvalidDate):
		httpx.WriteError(w, http.StatusUnprocessableEntity, "validation_error", err.Error())
	case err != nil:
		httpx.InternalError(w, r, err)
	default:
		httpx.WriteJSON(w, http.StatusOK, res)
	}
}

type expenseReq struct {
	CategoryID        uuid.UUID    `json:"category_id"`
	PaymentMethodID   *uuid.UUID   `json:"payment_method_id"`
	PaidByUserID      *uuid.UUID   `json:"paid_by_user_id"`
	AmountCents       int64        `json:"amount_cents"`
	Description       string       `json:"description"`
	IncurredOn        string       `json:"incurred_on"`
	Notes             string       `json:"notes"`
	SplitStrategy     string       `json:"split_strategy"`
	Splits            []SplitInput `json:"splits"`
	TotalInstallments int          `json:"total_installments"`
}

func (req expenseReq) toInput() ExpenseInput {
	var paidBy uuid.UUID
	if req.PaidByUserID != nil {
		paidBy = *req.PaidByUserID
	}
	return ExpenseInput{
		CategoryID:        req.CategoryID,
		PaymentMethodID:   req.PaymentMethodID,
		PaidByUserID:      paidBy,
		AmountCents:       req.AmountCents,
		Description:       req.Description,
		IncurredOn:        req.IncurredOn,
		Notes:             req.Notes,
		SplitStrategy:     SplitStrategy(req.SplitStrategy),
		Splits:            req.Splits,
		TotalInstallments: req.TotalInstallments,
	}
}

func (h *Handler) createExpense(w http.ResponseWriter, r *http.Request) {
	v, ok := viewerFrom(r)
	if !ok {
		httpx.Unauthorized(w)
		return
	}
	wsID, err := uuid.Parse(r.PathValue("wsId"))
	if err != nil {
		httpx.NotFound(w)
		return
	}
	var req expenseReq
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.BadRequest(w, err.Error())
		return
	}
	exp, err := h.svc.Create(r.Context(), v, wsID, req.toInput())
	writeExpenseResult(w, r, http.StatusCreated, exp, err)
}

func (h *Handler) getExpense(w http.ResponseWriter, r *http.Request) {
	v, ok := viewerFrom(r)
	if !ok {
		httpx.Unauthorized(w)
		return
	}
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.NotFound(w)
		return
	}
	exp, err := h.svc.Get(r.Context(), v, id)
	writeExpenseResult(w, r, http.StatusOK, exp, err)
}

func (h *Handler) updateExpense(w http.ResponseWriter, r *http.Request) {
	v, ok := viewerFrom(r)
	if !ok {
		httpx.Unauthorized(w)
		return
	}
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.NotFound(w)
		return
	}
	var req expenseReq
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.BadRequest(w, err.Error())
		return
	}
	exp, err := h.svc.Update(r.Context(), v, id, req.toInput())
	writeExpenseResult(w, r, http.StatusOK, exp, err)
}

func (h *Handler) deleteExpense(w http.ResponseWriter, r *http.Request) {
	v, ok := viewerFrom(r)
	if !ok {
		httpx.Unauthorized(w)
		return
	}
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.NotFound(w)
		return
	}
	err = h.svc.Delete(r.Context(), v, id)
	if errors.Is(err, ErrNotFound) {
		httpx.NotFound(w)
		return
	}
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) deleteInstallmentPlan(w http.ResponseWriter, r *http.Request) {
	v, ok := viewerFrom(r)
	if !ok {
		httpx.Unauthorized(w)
		return
	}
	planID, err := uuid.Parse(r.PathValue("planId"))
	if err != nil {
		httpx.NotFound(w)
		return
	}
	err = h.svc.DeleteInstallmentPlan(r.Context(), v, planID)
	if errors.Is(err, ErrNotFound) {
		httpx.NotFound(w)
		return
	}
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) shareExpense(w http.ResponseWriter, r *http.Request) {
	v, ok := viewerFrom(r)
	if !ok {
		httpx.Unauthorized(w)
		return
	}
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.NotFound(w)
		return
	}
	exp, err := h.svc.ShareWithHousehold(r.Context(), v, id)
	writeExpenseResult(w, r, http.StatusOK, exp, err)
}

type refundReq struct {
	AmountCents int64  `json:"amount_cents"`
	RefundedOn  string `json:"refunded_on"`
	Reason      string `json:"reason"`
}

func (h *Handler) createRefund(w http.ResponseWriter, r *http.Request) {
	v, ok := viewerFrom(r)
	if !ok {
		httpx.Unauthorized(w)
		return
	}
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.NotFound(w)
		return
	}
	var req refundReq
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.BadRequest(w, err.Error())
		return
	}
	exp, err := h.svc.CreateRefund(r.Context(), v, id, RefundInput{
		AmountCents: req.AmountCents,
		RefundedOn:  req.RefundedOn,
		Reason:      req.Reason,
	})
	writeExpenseResult(w, r, http.StatusCreated, exp, err)
}

func (h *Handler) listRefunds(w http.ResponseWriter, r *http.Request) {
	v, ok := viewerFrom(r)
	if !ok {
		httpx.Unauthorized(w)
		return
	}
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.NotFound(w)
		return
	}
	items, err := h.svc.ListRefunds(r.Context(), v, id)
	if errors.Is(err, ErrNotFound) {
		httpx.NotFound(w)
		return
	}
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
}

// === Recorrências e Assinaturas ===

type recurringReq struct {
	CategoryID      uuid.UUID    `json:"category_id"`
	PaymentMethodID *uuid.UUID   `json:"payment_method_id"`
	PaidByUserID    *uuid.UUID   `json:"paid_by_user_id"`
	AmountCents     int64        `json:"amount_cents"`
	Description     string       `json:"description"`
	Notes           string       `json:"notes"`
	Frequency       string       `json:"frequency"`
	StartDate       string       `json:"start_date"`
	EndDate         *string      `json:"end_date"`
	SplitStrategy   string       `json:"split_strategy"`
	Splits          []SplitInput `json:"splits"`
	IsActive        *bool        `json:"is_active"`
}

func (req recurringReq) toInput() RecurringRuleInput {
	var paidBy uuid.UUID
	if req.PaidByUserID != nil {
		paidBy = *req.PaidByUserID
	}
	active := true
	if req.IsActive != nil {
		active = *req.IsActive
	}
	return RecurringRuleInput{
		CategoryID:      req.CategoryID,
		PaymentMethodID: req.PaymentMethodID,
		PaidByUserID:    paidBy,
		AmountCents:     req.AmountCents,
		Description:     req.Description,
		Notes:           req.Notes,
		Frequency:       RecurringFrequency(req.Frequency),
		StartDate:       req.StartDate,
		EndDate:         req.EndDate,
		SplitStrategy:   SplitStrategy(req.SplitStrategy),
		Splits:          req.Splits,
		IsActive:        active,
	}
}

func (h *Handler) listRecurringRules(w http.ResponseWriter, r *http.Request) {
	v, ok := viewerFrom(r)
	if !ok {
		httpx.Unauthorized(w)
		return
	}
	wsID, err := uuid.Parse(r.PathValue("wsId"))
	if err != nil {
		httpx.NotFound(w)
		return
	}
	items, err := h.svc.ListRecurringRules(r.Context(), v, wsID)
	if errors.Is(err, ErrNotFound) {
		httpx.NotFound(w)
		return
	}
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h *Handler) createRecurringRule(w http.ResponseWriter, r *http.Request) {
	v, ok := viewerFrom(r)
	if !ok {
		httpx.Unauthorized(w)
		return
	}
	wsID, err := uuid.Parse(r.PathValue("wsId"))
	if err != nil {
		httpx.NotFound(w)
		return
	}
	var req recurringReq
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.BadRequest(w, err.Error())
		return
	}
	rule, err := h.svc.CreateRecurringRule(r.Context(), v, wsID, req.toInput())
	writeRecurringResult(w, r, http.StatusCreated, rule, err)
}

func (h *Handler) updateRecurringRule(w http.ResponseWriter, r *http.Request) {
	v, ok := viewerFrom(r)
	if !ok {
		httpx.Unauthorized(w)
		return
	}
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.NotFound(w)
		return
	}
	var req recurringReq
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.BadRequest(w, err.Error())
		return
	}
	rule, err := h.svc.UpdateRecurringRule(r.Context(), v, id, req.toInput())
	writeRecurringResult(w, r, http.StatusOK, rule, err)
}

func (h *Handler) deleteRecurringRule(w http.ResponseWriter, r *http.Request) {
	v, ok := viewerFrom(r)
	if !ok {
		httpx.Unauthorized(w)
		return
	}
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.NotFound(w)
		return
	}
	err = h.svc.DeleteRecurringRule(r.Context(), v, id)
	if errors.Is(err, ErrNotFound) {
		httpx.NotFound(w)
		return
	}
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type generateRecurringReq struct {
	UpToDate string `json:"up_to_date"`
}

func (h *Handler) generateRecurringRules(w http.ResponseWriter, r *http.Request) {
	v, ok := viewerFrom(r)
	if !ok {
		httpx.Unauthorized(w)
		return
	}
	wsID, err := uuid.Parse(r.PathValue("wsId"))
	if err != nil {
		httpx.NotFound(w)
		return
	}
	var req generateRecurringReq
	if r.ContentLength > 0 {
		if err := httpx.DecodeJSON(w, r, &req); err != nil {
			httpx.BadRequest(w, err.Error())
			return
		}
	}
	targetStr := req.UpToDate
	if targetStr == "" {
		now := defaultTodayUTC()
		targetStr = AddMonthsClamped(defaultFirstOfMonthUTC(now), 1).AddDate(0, 0, -1).Format("2006-01-02")
	}
	targetDate, err := ParseDate(targetStr)
	if err != nil {
		httpx.WriteError(w, http.StatusUnprocessableEntity, "validation_error", err.Error())
		return
	}
	res, err := h.svc.GenerateDue(r.Context(), v, wsID, targetDate)
	if errors.Is(err, ErrNotFound) {
		httpx.NotFound(w)
		return
	}
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, res)
}

func writeRecurringResult(w http.ResponseWriter, r *http.Request, okStatus int, rule RecurringRule, err error) {
	switch {
	case err == nil:
		httpx.WriteJSON(w, okStatus, rule)
	case errors.Is(err, ErrNotFound):
		httpx.NotFound(w)
	case errors.Is(err, ErrInvalidAmount),
		errors.Is(err, ErrInvalidDesc),
		errors.Is(err, ErrInvalidNotes),
		errors.Is(err, ErrInvalidDate),
		errors.Is(err, ErrInvalidFrequency),
		errors.Is(err, ErrInvalidEndDate),
		errors.Is(err, ErrCardPANDetected),
		errors.Is(err, ErrInvalidPaidBy),
		errors.Is(err, ErrInvalidSplit):
		httpx.WriteError(w, http.StatusUnprocessableEntity, "validation_error", err.Error())
	default:
		if err.Error() == "categoria não encontrada" || err.Error() == "meio de pagamento não encontrado" {
			httpx.WriteError(w, http.StatusUnprocessableEntity, "validation_error", err.Error())
			return
		}
		httpx.InternalError(w, r, err)
	}
}

func writeExpenseResult(w http.ResponseWriter, r *http.Request, okStatus int, exp Expense, err error) {
	switch {
	case err == nil:
		httpx.WriteJSON(w, okStatus, exp)
	case errors.Is(err, ErrNotFound):
		httpx.NotFound(w)
	case errors.Is(err, ErrAlreadyShared):
		httpx.WriteError(w, http.StatusConflict, "already_shared", err.Error())
	case errors.Is(err, ErrInvalidAmount),
		errors.Is(err, ErrInvalidDesc),
		errors.Is(err, ErrInvalidNotes),
		errors.Is(err, ErrInvalidDate),
		errors.Is(err, ErrCardPANDetected),
		errors.Is(err, ErrInvalidPaidBy),
		errors.Is(err, ErrInvalidSplit),
		errors.Is(err, ErrInvalidInstallments),
		errors.Is(err, ErrInvalidRefundAmount),
		errors.Is(err, ErrInvalidRefundReason):
		httpx.WriteError(w, http.StatusUnprocessableEntity, "validation_error", err.Error())
	default:
		if err.Error() == "categoria não encontrada" || err.Error() == "meio de pagamento não encontrado" {
			httpx.WriteError(w, http.StatusUnprocessableEntity, "validation_error", err.Error())
			return
		}
		httpx.InternalError(w, r, err)
	}
}
