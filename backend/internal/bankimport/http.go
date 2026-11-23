package bankimport

import (
	"errors"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"financas-familia/backend/internal/expense"
	"financas-familia/backend/internal/platform/authctx"
	"financas-familia/backend/internal/platform/httpx"
	"financas-familia/backend/internal/workspace"
)

// Handler expõe as rotas REST de dispositivos Android, ingestão e fila de revisão.
type Handler struct {
	svc *Service
}

// NewHandler cria o handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Register registra as rotas da Etapa 8 no mux.
func (h *Handler) Register(mux *http.ServeMux, requireUser func(http.Handler) http.Handler) {
	mux.Handle("GET /api/v1/devices", requireUser(http.HandlerFunc(h.listDevices)))
	mux.Handle("POST /api/v1/devices", requireUser(http.HandlerFunc(h.createDevice)))
	mux.Handle("DELETE /api/v1/devices/{id}", requireUser(http.HandlerFunc(h.revokeDevice)))

	// Rota do App Android autenticada por Bearer device_token.
	mux.HandleFunc("POST /api/v1/ingest/bank-notification", h.ingestBankNotification)

	mux.Handle("GET /api/v1/imports", requireUser(http.HandlerFunc(h.listImports)))
	mux.Handle("POST /api/v1/imports/{id}/approve", requireUser(http.HandlerFunc(h.approveImport)))
	mux.Handle("POST /api/v1/imports/{id}/discard", requireUser(http.HandlerFunc(h.discardImport)))
}

func viewerFrom(r *http.Request) (workspace.Viewer, bool) {
	p, ok := authctx.From(r.Context())
	return workspace.Viewer{UserID: p.UserID, HouseholdID: p.HouseholdID}, ok
}

func (h *Handler) listDevices(w http.ResponseWriter, r *http.Request) {
	v, ok := viewerFrom(r)
	if !ok {
		httpx.Unauthorized(w)
		return
	}
	items, err := h.svc.ListDevices(r.Context(), v)
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
}

type createDeviceReq struct {
	DeviceName string `json:"device_name"`
}

func (h *Handler) createDevice(w http.ResponseWriter, r *http.Request) {
	v, ok := viewerFrom(r)
	if !ok {
		httpx.Unauthorized(w)
		return
	}
	var req createDeviceReq
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.BadRequest(w, err.Error())
		return
	}
	res, err := h.svc.CreateDevice(r.Context(), v, req.DeviceName)
	if errors.Is(err, ErrInvalidDevice) {
		httpx.WriteError(w, http.StatusUnprocessableEntity, "validation_error", err.Error())
		return
	}
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, res)
}

func (h *Handler) revokeDevice(w http.ResponseWriter, r *http.Request) {
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
	dev, err := h.svc.RevokeDevice(r.Context(), v, id)
	if errors.Is(err, ErrNotFound) {
		httpx.NotFound(w)
		return
	}
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, dev)
}

type ingestReq struct {
	PackageName string `json:"package_name"`
	Title       string `json:"title"`
	Text        string `json:"text"`
	OccurredOn  string `json:"occurred_on"`
	ExternalID  string `json:"external_id"`
}

func (h *Handler) ingestBankNotification(w http.ResponseWriter, r *http.Request) {
	authHeader := strings.TrimSpace(r.Header.Get("Authorization"))
	if !strings.HasPrefix(authHeader, "Bearer ") {
		httpx.Unauthorized(w)
		return
	}
	plainToken := strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
	dp, err := h.svc.AuthenticateDevice(r.Context(), plainToken)
	if errors.Is(err, ErrInvalidToken) {
		httpx.Unauthorized(w)
		return
	}
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}

	var req ingestReq
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.BadRequest(w, err.Error())
		return
	}
	item, err := h.svc.Ingest(r.Context(), dp, IngestInput{
		PackageName: req.PackageName,
		Title:       req.Title,
		Text:        req.Text,
		OccurredOn:  req.OccurredOn,
		ExternalID:  req.ExternalID,
	})
	switch {
	case err == nil:
		httpx.WriteJSON(w, http.StatusCreated, item)
	case errors.Is(err, ErrEmptyNotification), errors.Is(err, expense.ErrInvalidDate):
		httpx.WriteError(w, http.StatusUnprocessableEntity, "validation_error", err.Error())
	default:
		httpx.InternalError(w, r, err)
	}
}

func (h *Handler) listImports(w http.ResponseWriter, r *http.Request) {
	v, ok := viewerFrom(r)
	if !ok {
		httpx.Unauthorized(w)
		return
	}
	st := r.URL.Query().Get("status")
	items, err := h.svc.ListImports(r.Context(), v, st)
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
}

type approveReq struct {
	WorkspaceID       uuid.UUID  `json:"workspace_id"`
	CategoryID        uuid.UUID  `json:"category_id"`
	PaymentMethodID   *uuid.UUID `json:"payment_method_id"`
	AmountCents       *int64     `json:"amount_cents"`
	Description       string     `json:"description"`
	IncurredOn        string     `json:"incurred_on"`
	TotalInstallments int        `json:"total_installments"`
	Notes             string     `json:"notes"`
}

func (h *Handler) approveImport(w http.ResponseWriter, r *http.Request) {
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
	var req approveReq
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.BadRequest(w, err.Error())
		return
	}
	exp, err := h.svc.Approve(r.Context(), v, id, ApproveInput{
		WorkspaceID:       req.WorkspaceID,
		CategoryID:        req.CategoryID,
		PaymentMethodID:   req.PaymentMethodID,
		AmountCents:       req.AmountCents,
		Description:       req.Description,
		IncurredOn:        req.IncurredOn,
		TotalInstallments: req.TotalInstallments,
		Notes:             req.Notes,
	})
	switch {
	case err == nil:
		httpx.WriteJSON(w, http.StatusCreated, exp)
	case errors.Is(err, ErrNotFound), errors.Is(err, expense.ErrNotFound):
		httpx.NotFound(w)
	case errors.Is(err, ErrNotPending):
		httpx.WriteError(w, http.StatusConflict, "not_pending", err.Error())
	case errors.Is(err, ErrAmountRequired),
		errors.Is(err, expense.ErrInvalidAmount),
		errors.Is(err, expense.ErrInvalidDesc),
		errors.Is(err, expense.ErrInvalidDate),
		errors.Is(err, expense.ErrCardPANDetected),
		errors.Is(err, expense.ErrInvalidInstallments):
		httpx.WriteError(w, http.StatusUnprocessableEntity, "validation_error", err.Error())
	default:
		httpx.InternalError(w, r, err)
	}
}

func (h *Handler) discardImport(w http.ResponseWriter, r *http.Request) {
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
	item, err := h.svc.Discard(r.Context(), v, id)
	switch {
	case err == nil:
		httpx.WriteJSON(w, http.StatusOK, item)
	case errors.Is(err, ErrNotFound):
		httpx.NotFound(w)
	case errors.Is(err, ErrNotPending):
		httpx.WriteError(w, http.StatusConflict, "not_pending", err.Error())
	default:
		httpx.InternalError(w, r, err)
	}
}
