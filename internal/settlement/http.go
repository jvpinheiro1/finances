package settlement

import (
	"errors"
	"net/http"

	"github.com/google/uuid"

	"financas-familia/backend/internal/expense"
	"financas-familia/backend/internal/platform/authctx"
	"financas-familia/backend/internal/platform/httpx"
	"financas-familia/backend/internal/workspace"
)

// Handler expõe as rotas REST de saldos e reembolsos.
type Handler struct {
	svc *Service
}

// NewHandler cria o handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Register registra as rotas da Etapa 3 no mux.
func (h *Handler) Register(mux *http.ServeMux, requireUser func(http.Handler) http.Handler) {
	mux.Handle("GET /api/v1/balances", requireUser(http.HandlerFunc(h.getBalances)))
	mux.Handle("GET /api/v1/settlements", requireUser(http.HandlerFunc(h.listSettlements)))
	mux.Handle("POST /api/v1/settlements", requireUser(http.HandlerFunc(h.createSettlement)))
	mux.Handle("POST /api/v1/settlements/{id}/confirm", requireUser(http.HandlerFunc(h.confirmSettlement)))
	mux.Handle("POST /api/v1/settlements/{id}/reject", requireUser(http.HandlerFunc(h.rejectSettlement)))
}

func viewerFrom(r *http.Request) (workspace.Viewer, bool) {
	p, ok := authctx.From(r.Context())
	return workspace.Viewer{UserID: p.UserID, HouseholdID: p.HouseholdID}, ok
}

func (h *Handler) getBalances(w http.ResponseWriter, r *http.Request) {
	v, ok := viewerFrom(r)
	if !ok {
		httpx.Unauthorized(w)
		return
	}
	res, err := h.svc.GetBalances(r.Context(), v)
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, res)
}

func (h *Handler) listSettlements(w http.ResponseWriter, r *http.Request) {
	v, ok := viewerFrom(r)
	if !ok {
		httpx.Unauthorized(w)
		return
	}
	st := r.URL.Query().Get("status")
	items, err := h.svc.List(r.Context(), v, st)
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
}

type createReq struct {
	FromUserID  uuid.UUID `json:"from_user_id"`
	ToUserID    uuid.UUID `json:"to_user_id"`
	AmountCents int64     `json:"amount_cents"`
	PaidOn      string    `json:"paid_on"`
	Notes       string    `json:"notes"`
}

func (h *Handler) createSettlement(w http.ResponseWriter, r *http.Request) {
	v, ok := viewerFrom(r)
	if !ok {
		httpx.Unauthorized(w)
		return
	}
	var req createReq
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.BadRequest(w, err.Error())
		return
	}
	st, err := h.svc.Create(r.Context(), v, CreateInput{
		FromUserID:  req.FromUserID,
		ToUserID:    req.ToUserID,
		AmountCents: req.AmountCents,
		PaidOn:      req.PaidOn,
		Notes:       req.Notes,
	})
	writeResult(w, r, http.StatusCreated, st, err)
}

func (h *Handler) confirmSettlement(w http.ResponseWriter, r *http.Request) {
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
	st, err := h.svc.Confirm(r.Context(), v, id)
	writeResult(w, r, http.StatusOK, st, err)
}

func (h *Handler) rejectSettlement(w http.ResponseWriter, r *http.Request) {
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
	st, err := h.svc.Reject(r.Context(), v, id)
	writeResult(w, r, http.StatusOK, st, err)
}

func writeResult(w http.ResponseWriter, r *http.Request, okStatus int, st Settlement, err error) {
	switch {
	case err == nil:
		httpx.WriteJSON(w, okStatus, st)
	case errors.Is(err, ErrNotFound):
		httpx.NotFound(w)
	case errors.Is(err, ErrForbiddenCreator), errors.Is(err, ErrOnlyCreditor), errors.Is(err, ErrForbiddenReject):
		httpx.WriteError(w, http.StatusForbidden, "forbidden", err.Error())
	case errors.Is(err, ErrNotPending):
		httpx.WriteError(w, http.StatusConflict, "not_pending", err.Error())
	case errors.Is(err, ErrInvalidAmount),
		errors.Is(err, ErrSameMember),
		errors.Is(err, ErrInvalidMember),
		errors.Is(err, ErrInvalidNotes),
		errors.Is(err, expense.ErrInvalidDate),
		errors.Is(err, expense.ErrCardPANDetected):
		httpx.WriteError(w, http.StatusUnprocessableEntity, "validation_error", err.Error())
	default:
		httpx.InternalError(w, r, err)
	}
}
