// Package notification gerencia a caixa de entrada de notificações por familiar
// com RLS estrito por destinatário (ADR 0009).
package notification

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"financas-familia/backend/internal/notification/notificationdb"
	"financas-familia/backend/internal/platform/authctx"
	"financas-familia/backend/internal/platform/db"
	"financas-familia/backend/internal/platform/httpx"
	"financas-familia/backend/internal/workspace"
)

// Erros de domínio.
var ErrNotFound = errors.New("notificação não encontrada")

// Kind identifica a categoria da notificação.
type Kind string

const (
	KindSettlementPending   Kind = "settlement_pending"
	KindSettlementConfirmed Kind = "settlement_confirmed"
	KindSettlementRejected  Kind = "settlement_rejected"
	KindCollectiveExpense   Kind = "collective_expense_added"
	KindRecurringDueSoon    Kind = "recurring_due_soon"
)

// Notification representa uma mensagem na caixa de entrada de um familiar.
type Notification struct {
	ID              uuid.UUID  `json:"id"`
	HouseholdID     uuid.UUID  `json:"household_id"`
	RecipientUserID uuid.UUID  `json:"recipient_user_id"`
	Kind            Kind       `json:"kind"`
	Title           string     `json:"title"`
	Body            string     `json:"body"`
	EntityType      *string    `json:"entity_type,omitempty"`
	EntityID        *uuid.UUID `json:"entity_id,omitempty"`
	IsRead          bool       `json:"is_read"`
	ReadAt          *time.Time `json:"read_at,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
}

// ListResult reúne as notificações do usuário e o total de não lidas.
type ListResult struct {
	Items       []Notification `json:"items"`
	UnreadCount int64          `json:"unread_count"`
}

// SendParams define os parâmetros para gravar uma notificação dentro de uma transação.
type SendParams struct {
	HouseholdID     uuid.UUID
	RecipientUserID uuid.UUID
	Kind            Kind
	Title           string
	Body            string
	EntityType      string
	EntityID        uuid.UUID
	DedupKey        string
}

// SendTx insere uma notificação usando a transação informada (idempotente se DedupKey != "").
func SendTx(ctx context.Context, tx notificationdb.DBTX, p SendParams) error {
	var entType *string
	if p.EntityType != "" {
		entType = &p.EntityType
	}
	var entID *uuid.UUID
	if p.EntityID != uuid.Nil {
		id := p.EntityID
		entID = &id
	}
	q := notificationdb.New(tx)
	if p.DedupKey == "" {
		return q.InsertNotification(ctx, notificationdb.InsertNotificationParams{
			HouseholdID:     p.HouseholdID,
			RecipientUserID: p.RecipientUserID,
			Kind:            string(p.Kind),
			Title:           p.Title,
			Body:            p.Body,
			EntityType:      entType,
			EntityID:        entID,
		})
	}
	dk := p.DedupKey
	return q.InsertDedupNotification(ctx, notificationdb.InsertDedupNotificationParams{
		HouseholdID:     p.HouseholdID,
		RecipientUserID: p.RecipientUserID,
		Kind:            string(p.Kind),
		Title:           p.Title,
		Body:            p.Body,
		EntityType:      entType,
		EntityID:        entID,
		DedupKey:        &dk,
	})
}

// Service consulta e atualiza as notificações do usuário autenticado sob RLS.
type Service struct {
	db db.TxBeginner
}

// NewService cria o serviço.
func NewService(b db.TxBeginner) *Service { return &Service{db: b} }

// List devolve as notificações do usuário autenticado e a contagem de não lidas.
func (s *Service) List(ctx context.Context, v workspace.Viewer, unreadOnly bool) (ListResult, error) {
	var res ListResult
	err := db.WithUserTx(ctx, s.db, v.UserID, func(tx pgx.Tx) error {
		q := notificationdb.New(tx)
		rows, err := q.ListMyNotifications(ctx, notificationdb.ListMyNotificationsParams{
			HouseholdID:     v.HouseholdID,
			RecipientUserID: v.UserID,
			UnreadOnly:      unreadOnly,
		})
		if err != nil {
			return err
		}
		unread, err := q.CountMyUnreadNotifications(ctx, notificationdb.CountMyUnreadNotificationsParams{
			HouseholdID:     v.HouseholdID,
			RecipientUserID: v.UserID,
		})
		if err != nil {
			return err
		}
		res.Items = make([]Notification, 0, len(rows))
		for _, r := range rows {
			res.Items = append(res.Items, fromRow(r))
		}
		res.UnreadCount = unread
		return nil
	})
	return res, err
}

// MarkRead marca uma notificação do próprio usuário como lida (404 se pertencer a outro membro).
func (s *Service) MarkRead(ctx context.Context, v workspace.Viewer, id uuid.UUID) (Notification, error) {
	var out Notification
	err := db.WithUserTx(ctx, s.db, v.UserID, func(tx pgx.Tx) error {
		r, err := notificationdb.New(tx).MarkNotificationRead(ctx, notificationdb.MarkNotificationReadParams{
			ID:              id,
			HouseholdID:     v.HouseholdID,
			RecipientUserID: v.UserID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		out = fromRow(r)
		return nil
	})
	return out, err
}

// MarkAllRead marca todas as notificações não lidas do próprio usuário como lidas.
func (s *Service) MarkAllRead(ctx context.Context, v workspace.Viewer) (int64, error) {
	var updated int64
	err := db.WithUserTx(ctx, s.db, v.UserID, func(tx pgx.Tx) error {
		var err error
		updated, err = notificationdb.New(tx).MarkAllNotificationsRead(ctx, notificationdb.MarkAllNotificationsReadParams{
			HouseholdID:     v.HouseholdID,
			RecipientUserID: v.UserID,
		})
		return err
	})
	return updated, err
}

func fromRow(r notificationdb.Notification) Notification {
	return Notification{
		ID:              r.ID,
		HouseholdID:     r.HouseholdID,
		RecipientUserID: r.RecipientUserID,
		Kind:            Kind(r.Kind),
		Title:           r.Title,
		Body:            r.Body,
		EntityType:      r.EntityType,
		EntityID:        r.EntityID,
		IsRead:          r.IsRead,
		ReadAt:          r.ReadAt,
		CreatedAt:       r.CreatedAt,
	}
}

// Handler expõe as rotas REST de notificações.
type Handler struct {
	svc *Service
}

// NewHandler cria o handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Register registra as rotas da Etapa 6 no mux.
func (h *Handler) Register(mux *http.ServeMux, requireUser func(http.Handler) http.Handler) {
	mux.Handle("GET /api/v1/notifications", requireUser(http.HandlerFunc(h.list)))
	mux.Handle("POST /api/v1/notifications/{id}/read", requireUser(http.HandlerFunc(h.markRead)))
	mux.Handle("POST /api/v1/notifications/read-all", requireUser(http.HandlerFunc(h.markAllRead)))
}

func viewerFrom(r *http.Request) (workspace.Viewer, bool) {
	p, ok := authctx.From(r.Context())
	return workspace.Viewer{UserID: p.UserID, HouseholdID: p.HouseholdID}, ok
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	v, ok := viewerFrom(r)
	if !ok {
		httpx.Unauthorized(w)
		return
	}
	unreadOnly := r.URL.Query().Get("unread_only") == "true"
	res, err := h.svc.List(r.Context(), v, unreadOnly)
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, res)
}

func (h *Handler) markRead(w http.ResponseWriter, r *http.Request) {
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
	n, err := h.svc.MarkRead(r.Context(), v, id)
	if errors.Is(err, ErrNotFound) {
		httpx.NotFound(w)
		return
	}
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, n)
}

func (h *Handler) markAllRead(w http.ResponseWriter, r *http.Request) {
	v, ok := viewerFrom(r)
	if !ok {
		httpx.Unauthorized(w)
		return
	}
	count, err := h.svc.MarkAllRead(r.Context(), v)
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]int64{"marked_read_count": count})
}
