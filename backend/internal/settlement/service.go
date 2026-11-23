package settlement

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"financas-familia/backend/internal/audit"
	"financas-familia/backend/internal/household/householddb"
	"financas-familia/backend/internal/notification"
	"financas-familia/backend/internal/platform/db"
	"financas-familia/backend/internal/settlement/settlementdb"
	"financas-familia/backend/internal/workspace"
)

// Service calcula os saldos da residência e gerencia o ciclo de vida dos reembolsos
// dentro de transações protegidas por RLS.
type Service struct {
	db db.TxBeginner
}

// NewService cria o serviço.
func NewService(b db.TxBeginner) *Service { return &Service{db: b} }

// GetBalances devolve o resumo de saldos líquidos por membro e dívidas bilaterais da residência.
func (s *Service) GetBalances(ctx context.Context, v workspace.Viewer) (BalanceSummary, error) {
	var out BalanceSummary
	err := db.WithUserTx(ctx, s.db, v.UserID, func(tx pgx.Tx) error {
		memberRows, err := householddb.New(tx).ListActiveMembers(ctx, v.HouseholdID)
		if err != nil {
			return err
		}
		members := make([]MemberRef, 0, len(memberRows))
		for _, m := range memberRows {
			members = append(members, MemberRef{ID: m.ID, Name: m.Name})
		}

		q := settlementdb.New(tx)
		splitRows, err := q.ListCollectiveSplitDebts(ctx, v.HouseholdID)
		if err != nil {
			return err
		}
		splits := make([]DirectedTotal, 0, len(splitRows))
		for _, r := range splitRows {
			splits = append(splits, DirectedTotal{
				DebtorID: r.DebtorID, CreditorID: r.CreditorID, TotalCents: r.TotalCents,
			})
		}

		settleRows, err := q.ListConfirmedSettlementTotals(ctx, v.HouseholdID)
		if err != nil {
			return err
		}
		confirmed := make([]DirectedTotal, 0, len(settleRows))
		for _, r := range settleRows {
			confirmed = append(confirmed, DirectedTotal{
				DebtorID: r.DebtorID, CreditorID: r.CreditorID, TotalCents: r.TotalCents,
			})
		}

		// Créditos de estornos em despesas coletivas abatem a dívida do participante com quem pagou (ADR 0007).
		refundRows, err := q.ListCollectiveRefundSplitCredits(ctx, v.HouseholdID)
		if err != nil {
			return err
		}
		for _, r := range refundRows {
			confirmed = append(confirmed, DirectedTotal{
				DebtorID: r.DebtorID, CreditorID: r.CreditorID, TotalCents: r.TotalCents,
			})
		}

		out = ComputeBalances(members, splits, confirmed)
		return nil
	})
	return out, err
}

// List lista os reembolsos da residência (opcionalmente filtrando por status).
func (s *Service) List(ctx context.Context, v workspace.Viewer, statusFilter string) ([]Settlement, error) {
	var out []Settlement
	err := db.WithUserTx(ctx, s.db, v.UserID, func(tx pgx.Tx) error {
		rows, err := settlementdb.New(tx).ListSettlements(ctx, settlementdb.ListSettlementsParams{
			HouseholdID:  v.HouseholdID,
			FilterStatus: statusFilter != "",
			Status:       statusFilter,
		})
		if err != nil {
			return err
		}
		out = make([]Settlement, 0, len(rows))
		for _, r := range rows {
			out = append(out, fromListRow(r))
		}
		return nil
	})
	return out, err
}

// Create registra um reembolso aplicando a regra E3-D2:
//   - se criado pelo credor (v.UserID == ToUserID): nasce confirmed;
//   - se criado pelo devedor (v.UserID == FromUserID): nasce pending (aguardando o credor confirmar).
func (s *Service) Create(ctx context.Context, v workspace.Viewer, in CreateInput) (Settlement, error) {
	paidOn, err := in.Validate()
	if err != nil {
		return Settlement{}, err
	}
	if v.UserID != in.FromUserID && v.UserID != in.ToUserID {
		return Settlement{}, ErrForbiddenCreator
	}

	var out Settlement
	err = db.WithUserTx(ctx, s.db, v.UserID, func(tx pgx.Tx) error {
		memberRows, err := householddb.New(tx).ListActiveMembers(ctx, v.HouseholdID)
		if err != nil {
			return err
		}
		activeSet := make(map[uuid.UUID]bool, len(memberRows))
		for _, m := range memberRows {
			activeSet[m.ID] = true
		}
		if !activeSet[in.FromUserID] || !activeSet[in.ToUserID] {
			return ErrInvalidMember
		}

		st := StatusPending
		var decidedBy *uuid.UUID
		var decidedAt *time.Time
		if v.UserID == in.ToUserID {
			st = StatusConfirmed
			decidedBy = &v.UserID
			now := time.Now().UTC()
			decidedAt = &now
		}

		q := settlementdb.New(tx)
		created, err := q.CreateSettlement(ctx, settlementdb.CreateSettlementParams{
			HouseholdID:     v.HouseholdID,
			FromUserID:      in.FromUserID,
			ToUserID:        in.ToUserID,
			AmountCents:     in.AmountCents,
			Status:          string(st),
			PaidOn:          paidOn,
			Notes:           in.Notes,
			CreatedByUserID: v.UserID,
			DecidedByUserID: decidedBy,
			DecidedAt:       decidedAt,
		})
		if err != nil {
			return err
		}
		row, err := q.GetSettlement(ctx, settlementdb.GetSettlementParams{
			ID: created.ID, HouseholdID: v.HouseholdID,
		})
		if err != nil {
			return err
		}
		out = fromGetRow(row)
		if st == StatusPending {
			if err := notification.SendTx(ctx, tx, notification.SendParams{
				HouseholdID:     v.HouseholdID,
				RecipientUserID: out.ToUserID,
				Kind:            notification.KindSettlementPending,
				Title:           "Reembolso aguardando confirmação",
				Body:            out.FromUserName + " informou um pagamento para você. Confirme o recebimento na aba coletiva.",
				EntityType:      "settlement",
				EntityID:        out.ID,
			}); err != nil {
				return err
			}
		} else {
			if err := notification.SendTx(ctx, tx, notification.SendParams{
				HouseholdID:     v.HouseholdID,
				RecipientUserID: out.FromUserID,
				Kind:            notification.KindSettlementConfirmed,
				Title:           "Reembolso registrado e confirmado",
				Body:            out.ToUserName + " registrou o recebimento de um reembolso seu.",
				EntityType:      "settlement",
				EntityID:        out.ID,
			}); err != nil {
				return err
			}
		}
		return audit.Record(ctx, tx, audit.Entry{
			HouseholdID: audit.Ptr(v.HouseholdID), ActorID: audit.Ptr(v.UserID),
			Action: audit.ActionSettlementCreated, EntityType: "settlement", EntityID: audit.Ptr(created.ID),
			Meta: map[string]any{"initial_status": string(st)},
		})
	})
	return out, err
}

// Confirm permite que o credor (ToUserID) confirme um reembolso pendente (E3-D2).
func (s *Service) Confirm(ctx context.Context, v workspace.Viewer, id uuid.UUID) (Settlement, error) {
	var out Settlement
	err := db.WithUserTx(ctx, s.db, v.UserID, func(tx pgx.Tx) error {
		q := settlementdb.New(tx)
		cur, err := q.GetSettlement(ctx, settlementdb.GetSettlementParams{ID: id, HouseholdID: v.HouseholdID})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if Status(cur.Status) != StatusPending {
			return ErrNotPending
		}
		if cur.ToUserID != v.UserID {
			return ErrOnlyCreditor
		}
		if _, err := q.DecideSettlement(ctx, settlementdb.DecideSettlementParams{
			ID: id, HouseholdID: v.HouseholdID, Status: string(StatusConfirmed), DecidedByUserID: &v.UserID,
		}); err != nil {
			return err
		}
		row, err := q.GetSettlement(ctx, settlementdb.GetSettlementParams{ID: id, HouseholdID: v.HouseholdID})
		if err != nil {
			return err
		}
		out = fromGetRow(row)
		if err := notification.SendTx(ctx, tx, notification.SendParams{
			HouseholdID:     v.HouseholdID,
			RecipientUserID: out.FromUserID,
			Kind:            notification.KindSettlementConfirmed,
			Title:           "Reembolso confirmado",
			Body:            out.ToUserName + " confirmou o recebimento do seu reembolso.",
			EntityType:      "settlement",
			EntityID:        out.ID,
		}); err != nil {
			return err
		}
		return audit.Record(ctx, tx, audit.Entry{
			HouseholdID: audit.Ptr(v.HouseholdID), ActorID: audit.Ptr(v.UserID),
			Action: audit.ActionSettlementConfirm, EntityType: "settlement", EntityID: audit.Ptr(id),
		})
	})
	return out, err
}

// Reject permite que o credor (ToUserID) ou o próprio autor (FromUserID) recuse/cancele um reembolso pendente.
func (s *Service) Reject(ctx context.Context, v workspace.Viewer, id uuid.UUID) (Settlement, error) {
	var out Settlement
	err := db.WithUserTx(ctx, s.db, v.UserID, func(tx pgx.Tx) error {
		q := settlementdb.New(tx)
		cur, err := q.GetSettlement(ctx, settlementdb.GetSettlementParams{ID: id, HouseholdID: v.HouseholdID})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if Status(cur.Status) != StatusPending {
			return ErrNotPending
		}
		if cur.ToUserID != v.UserID && cur.FromUserID != v.UserID {
			return ErrForbiddenReject
		}
		if _, err := q.DecideSettlement(ctx, settlementdb.DecideSettlementParams{
			ID: id, HouseholdID: v.HouseholdID, Status: string(StatusRejected), DecidedByUserID: &v.UserID,
		}); err != nil {
			return err
		}
		row, err := q.GetSettlement(ctx, settlementdb.GetSettlementParams{ID: id, HouseholdID: v.HouseholdID})
		if err != nil {
			return err
		}
		out = fromGetRow(row)
		if v.UserID == out.ToUserID {
			if err := notification.SendTx(ctx, tx, notification.SendParams{
				HouseholdID:     v.HouseholdID,
				RecipientUserID: out.FromUserID,
				Kind:            notification.KindSettlementRejected,
				Title:           "Reembolso recusado",
				Body:            out.ToUserName + " recusou o reembolso que estava pendente.",
				EntityType:      "settlement",
				EntityID:        out.ID,
			}); err != nil {
				return err
			}
		}
		return audit.Record(ctx, tx, audit.Entry{
			HouseholdID: audit.Ptr(v.HouseholdID), ActorID: audit.Ptr(v.UserID),
			Action: audit.ActionSettlementRejected, EntityType: "settlement", EntityID: audit.Ptr(id),
		})
	})
	return out, err
}

func fromGetRow(r settlementdb.GetSettlementRow) Settlement {
	return Settlement{
		ID:              r.ID,
		HouseholdID:     r.HouseholdID,
		FromUserID:      r.FromUserID,
		FromUserName:    r.FromUserName,
		ToUserID:        r.ToUserID,
		ToUserName:      r.ToUserName,
		AmountCents:     r.AmountCents,
		Status:          Status(r.Status),
		PaidOn:          r.PaidOn.UTC().Format("2006-01-02"),
		Notes:           r.Notes,
		CreatedByUserID: r.CreatedByUserID,
		DecidedByUserID: r.DecidedByUserID,
		DecidedAt:       r.DecidedAt,
		CreatedAt:       r.CreatedAt,
	}
}

func fromListRow(r settlementdb.ListSettlementsRow) Settlement {
	return fromGetRow(settlementdb.GetSettlementRow(r))
}
