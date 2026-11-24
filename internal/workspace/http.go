package workspace

import (
	"errors"
	"net/http"

	"github.com/google/uuid"

	"financas-familia/backend/internal/platform/authctx"
	"financas-familia/backend/internal/platform/httpx"
)

// Handler expõe as rotas de ambientes.
type Handler struct {
	svc *Service
}

// NewHandler cria o handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Register registra as rotas; requireUser deve exigir usuário autenticado.
func (h *Handler) Register(mux *http.ServeMux, requireUser func(http.Handler) http.Handler) {
	mux.Handle("GET /api/v1/workspaces", requireUser(http.HandlerFunc(h.list)))
	mux.Handle("GET /api/v1/workspaces/{id}", requireUser(http.HandlerFunc(h.get)))
}

type workspaceDTO struct {
	ID     uuid.UUID `json:"id"`
	Kind   Kind      `json:"kind"`
	IsMine bool      `json:"is_mine"` // true no ambiente individual do próprio usuário
}

type listResponse struct {
	Items []workspaceDTO `json:"items"`
}

func viewerFrom(r *http.Request) (Viewer, bool) {
	p, ok := authctx.From(r.Context())
	return Viewer{UserID: p.UserID, HouseholdID: p.HouseholdID}, ok
}

func toDTO(v Viewer, w Workspace) workspaceDTO {
	return workspaceDTO{ID: w.ID, Kind: w.Kind, IsMine: w.Kind == KindPersonal && w.OwnerUserID != nil && *w.OwnerUserID == v.UserID}
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	v, ok := viewerFrom(r)
	if !ok {
		httpx.Unauthorized(w)
		return
	}
	items, err := h.svc.List(r.Context(), v)
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	resp := listResponse{Items: make([]workspaceDTO, 0, len(items))}
	for _, it := range items {
		resp.Items = append(resp.Items, toDTO(v, it))
	}
	httpx.WriteJSON(w, http.StatusOK, resp)
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	v, ok := viewerFrom(r)
	if !ok {
		httpx.Unauthorized(w)
		return
	}
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.NotFound(w) // id malformado também é 404: não diferencia casos
		return
	}
	ws, err := h.svc.Get(r.Context(), v, id)
	if errors.Is(err, ErrNotFound) {
		httpx.NotFound(w)
		return
	}
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toDTO(v, ws))
}
