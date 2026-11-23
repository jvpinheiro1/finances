// Package household trata da residência e de seus membros.
package household

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"financas-familia/backend/internal/household/householddb"
	"financas-familia/backend/internal/platform/authctx"
	"financas-familia/backend/internal/platform/httpx"
)

// ErrNotFound indica residência inexistente.
var ErrNotFound = errors.New("residência não encontrada")

// Member é a visão de um membro para os demais (sem e-mail: minimização LGPD).
type Member struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
}

// Household é a residência com seus membros ativos.
type Household struct {
	ID      uuid.UUID `json:"id"`
	Name    string    `json:"name"`
	Members []Member  `json:"members"`
}

// Service consulta a residência.
type Service struct {
	q householddb.Querier
}

// NewService cria o serviço.
func NewService(q householddb.Querier) *Service { return &Service{q: q} }

// Get devolve a residência e os membros ativos.
func (s *Service) Get(ctx context.Context, id uuid.UUID) (Household, error) {
	h, err := s.q.GetHousehold(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return Household{}, ErrNotFound
	}
	if err != nil {
		return Household{}, fmt.Errorf("buscar residência: %w", err)
	}
	rows, err := s.q.ListActiveMembers(ctx, id)
	if err != nil {
		return Household{}, fmt.Errorf("listar membros: %w", err)
	}
	out := Household{ID: h.ID, Name: h.Name, Members: make([]Member, 0, len(rows))}
	for _, r := range rows {
		out.Members = append(out.Members, Member{ID: r.ID, Name: r.Name})
	}
	return out, nil
}

// Handler expõe GET /api/v1/household.
type Handler struct{ svc *Service }

// NewHandler cria o handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Register registra as rotas.
func (h *Handler) Register(mux *http.ServeMux, requireUser func(http.Handler) http.Handler) {
	mux.Handle("GET /api/v1/household", requireUser(http.HandlerFunc(h.get)))
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	p, ok := authctx.From(r.Context())
	if !ok {
		httpx.Unauthorized(w)
		return
	}
	hh, err := h.svc.Get(r.Context(), p.HouseholdID)
	if errors.Is(err, ErrNotFound) {
		httpx.NotFound(w)
		return
	}
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, hh)
}
