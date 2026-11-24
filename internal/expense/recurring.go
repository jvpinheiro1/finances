package expense

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"financas-familia/backend/internal/audit"
	"financas-familia/backend/internal/expense/expensedb"
	"financas-familia/backend/internal/notification"
	"financas-familia/backend/internal/platform/db"
	"financas-familia/backend/internal/workspace"
)

// RecurringFrequency define a periodicidade de uma conta recorrente ou assinatura.
type RecurringFrequency string

const (
	FreqMonthly RecurringFrequency = "monthly" // mensal (assinaturas mensais, aluguel, luz, água, internet)
	FreqWeekly  RecurringFrequency = "weekly"  // semanal (feira, diarista)
	FreqYearly  RecurringFrequency = "yearly"  // anual (assinaturas anuais, IPTU, IPVA, seguro)
)

// Valid confere se a periodicidade é suportada.
func (f RecurringFrequency) Valid() bool {
	switch f {
	case FreqMonthly, FreqWeekly, FreqYearly:
		return true
	default:
		return false
	}
}

// MaxCyclesPerGenerate limita quantos ciclos uma única chamada pode gerar por regra.
const MaxCyclesPerGenerate = 12

// RecurringRule representa um modelo de despesa recorrente ou assinatura.
type RecurringRule struct {
	ID                uuid.UUID          `json:"id"`
	HouseholdID       uuid.UUID          `json:"household_id"`
	WorkspaceID       uuid.UUID          `json:"workspace_id"`
	CategoryID        uuid.UUID          `json:"category_id"`
	CategoryName      string             `json:"category_name"`
	PaymentMethodID   *uuid.UUID         `json:"payment_method_id,omitempty"`
	PaymentMethodName *string            `json:"payment_method_name,omitempty"`
	PaymentMethodKind *string            `json:"payment_method_kind,omitempty"`
	PaymentMethodLast *string            `json:"payment_method_last4,omitempty"`
	PaidByUserID      uuid.UUID          `json:"paid_by_user_id"`
	PaidByName        string             `json:"paid_by_name"`
	CreatedByUserID   uuid.UUID          `json:"created_by_user_id"`
	AmountCents       int64              `json:"amount_cents"`
	Description       string             `json:"description"`
	Notes             string             `json:"notes"`
	Frequency         RecurringFrequency `json:"frequency"`
	StartDate         string             `json:"start_date"`
	EndDate           *string            `json:"end_date,omitempty"`
	NextDueDate       string             `json:"next_due_date"`
	SplitStrategy     SplitStrategy      `json:"split_strategy"`
	Splits            []SplitShare       `json:"splits"`
	IsActive          bool               `json:"is_active"`
	CreatedAt         time.Time          `json:"created_at"`
	UpdatedAt         time.Time          `json:"updated_at"`
}

// RecurringRuleInput reúne os dados de criação/edição de uma recorrência ou assinatura.
type RecurringRuleInput struct {
	CategoryID      uuid.UUID
	PaymentMethodID *uuid.UUID
	PaidByUserID    uuid.UUID
	AmountCents     int64
	Description     string
	Notes           string
	Frequency       RecurringFrequency
	StartDate       string  // AAAA-MM-DD (na criação) ou NextDueDate (na edição)
	EndDate         *string // AAAA-MM-DD opcional
	SplitStrategy   SplitStrategy
	Splits          []SplitInput
	IsActive        bool
}

// Validate sanitiza e valida os dados da recorrência.
func (in *RecurringRuleInput) Validate() (time.Time, *time.Time, error) {
	if in.AmountCents <= 0 || in.AmountCents > MaxAmountCents {
		return time.Time{}, nil, ErrInvalidAmount
	}
	in.Description = strings.TrimSpace(in.Description)
	dn := utf8.RuneCountInString(in.Description)
	if dn < 1 || dn > 160 {
		return time.Time{}, nil, ErrInvalidDesc
	}
	in.Notes = strings.TrimSpace(in.Notes)
	if utf8.RuneCountInString(in.Notes) > 500 {
		return time.Time{}, nil, ErrInvalidNotes
	}
	if LooksLikeCardPAN(in.Description) || LooksLikeCardPAN(in.Notes) {
		return time.Time{}, nil, ErrCardPANDetected
	}
	if !in.Frequency.Valid() {
		return time.Time{}, nil, ErrInvalidFrequency
	}
	if in.CategoryID == uuid.Nil {
		return time.Time{}, nil, fmt.Errorf("categoria é obrigatória")
	}
	if in.SplitStrategy == "" {
		in.SplitStrategy = SplitEqual
	}
	if !in.SplitStrategy.Valid() {
		return time.Time{}, nil, ErrInvalidSplit
	}
	start, err := ParseDate(in.StartDate)
	if err != nil {
		return time.Time{}, nil, err
	}
	var endPtr *time.Time
	if in.EndDate != nil && strings.TrimSpace(*in.EndDate) != "" {
		end, err := ParseDate(*in.EndDate)
		if err != nil {
			return time.Time{}, nil, err
		}
		if end.Before(start) {
			return time.Time{}, nil, ErrInvalidEndDate
		}
		endPtr = &end
	}
	return start, endPtr, nil
}

// RecurringPeriodKey devolve a chave canônica do ciclo para garantir idempotência.
func RecurringPeriodKey(dueDate time.Time, freq RecurringFrequency) string {
	d := dueDate.UTC()
	switch freq {
	case FreqMonthly:
		return d.Format("2006-01")
	case FreqYearly:
		return d.Format("2006")
	default:
		return d.Format("2006-01-02")
	}
}

// AdvanceRecurringDate calcula a próxima data de vencimento a partir de startDate e currentDue.
func AdvanceRecurringDate(startDate, currentDue time.Time, freq RecurringFrequency) time.Time {
	s := startDate.UTC()
	c := currentDue.UTC()
	switch freq {
	case FreqMonthly:
		months := (c.Year()-s.Year())*12 + int(c.Month()-s.Month()) + 1
		if months <= 0 {
			months = 1
		}
		return AddMonthsClamped(s, months)
	case FreqYearly:
		years := (c.Year() - s.Year()) + 1
		if years <= 0 {
			years = 1
		}
		return AddMonthsClamped(s, years*12)
	default:
		return c.AddDate(0, 0, 7)
	}
}

// ListRecurringRules lista todas as regras de recorrência de um ambiente acessível
// e emite alertas deduplicados de vencimento próximo (até 3 dias de antecedência, E6-D2).
func (s *Service) ListRecurringRules(ctx context.Context, v workspace.Viewer, wsID uuid.UUID) ([]RecurringRule, error) {
	var out []RecurringRule
	err := db.WithUserTx(ctx, s.db, v.UserID, func(tx pgx.Tx) error {
		ws, err := workspace.GetTx(ctx, tx, v, wsID)
		if err != nil {
			return ErrNotFound
		}
		q := expensedb.New(tx)
		rows, err := q.ListWorkspaceRecurringRules(ctx, expensedb.ListWorkspaceRecurringRulesParams{
			HouseholdID: v.HouseholdID, WorkspaceID: wsID,
		})
		if err != nil {
			return err
		}
		splitRows, err := q.ListWorkspaceRecurringRuleSplits(ctx, expensedb.ListWorkspaceRecurringRuleSplitsParams{
			HouseholdID: v.HouseholdID, WorkspaceID: wsID,
		})
		if err != nil {
			return err
		}
		splitsByRule := make(map[uuid.UUID][]SplitShare)
		for _, sr := range splitRows {
			splitsByRule[sr.RecurringRuleID] = append(splitsByRule[sr.RecurringRuleID], SplitShare{
				UserID:     sr.UserID,
				UserName:   sr.UserName,
				WeightBps:  sr.WeightBps,
				ShareCents: sr.ShareCents,
			})
		}

		alertUntil := defaultTodayUTC().AddDate(0, 0, 3)
		out = make([]RecurringRule, 0, len(rows))
		for _, r := range rows {
			rule := fromRecurringListRow(r)
			if sp := splitsByRule[rule.ID]; len(sp) > 0 {
				rule.Splits = sp
			} else {
				rule.Splits = []SplitShare{}
			}
			out = append(out, rule)

			if r.IsActive && !r.NextDueDate.UTC().After(alertUntil) {
				periodKey := RecurringPeriodKey(r.NextDueDate, rule.Frequency)
				dedupKey := "recurring_due:" + rule.ID.String() + ":" + periodKey
				shouldNotify := ws.Kind == workspace.KindPersonal || rule.PaidByUserID == v.UserID
				if !shouldNotify {
					for _, sp := range rule.Splits {
						if sp.UserID == v.UserID {
							shouldNotify = true
							break
						}
					}
				}
				if shouldNotify {
					_ = notification.SendTx(ctx, tx, notification.SendParams{
						HouseholdID:     v.HouseholdID,
						RecipientUserID: v.UserID,
						Kind:            notification.KindRecurringDueSoon,
						Title:           "Vencimento próximo de recorrência",
						Body:            "A assinatura/conta '" + rule.Description + "' vence em " + rule.NextDueDate + ".",
						EntityType:      "recurring_rule",
						EntityID:        rule.ID,
						DedupKey:        dedupKey,
					})
				}
			}
		}
		return nil
	})
	return out, err
}

// CreateRecurringRule cadastra uma nova conta recorrente ou assinatura no ambiente informado.
func (s *Service) CreateRecurringRule(ctx context.Context, v workspace.Viewer, wsID uuid.UUID, in RecurringRuleInput) (RecurringRule, error) {
	start, endPtr, err := in.Validate()
	if err != nil {
		return RecurringRule{}, err
	}
	var out RecurringRule
	err = db.WithUserTx(ctx, s.db, v.UserID, func(tx pgx.Tx) error {
		ws, err := workspace.GetTx(ctx, tx, v, wsID)
		if err != nil {
			return ErrNotFound
		}
		expIn := ExpenseInput{
			CategoryID:      in.CategoryID,
			PaymentMethodID: in.PaymentMethodID,
			PaidByUserID:    in.PaidByUserID,
			AmountCents:     in.AmountCents,
			Description:     in.Description,
			IncurredOn:      in.StartDate,
			Notes:           in.Notes,
			SplitStrategy:   in.SplitStrategy,
			Splits:          in.Splits,
		}
		paidBy, splits, _, err := s.validateRefsAndSplits(ctx, tx, v, ws, expIn)
		if err != nil {
			return err
		}
		q := expensedb.New(tx)
		created, err := q.CreateRecurringRule(ctx, expensedb.CreateRecurringRuleParams{
			HouseholdID:     v.HouseholdID,
			WorkspaceID:     ws.ID,
			CategoryID:      in.CategoryID,
			PaymentMethodID: in.PaymentMethodID,
			PaidByUserID:    paidBy,
			CreatedByUserID: v.UserID,
			AmountCents:     in.AmountCents,
			Description:     in.Description,
			Notes:           in.Notes,
			Frequency:       string(in.Frequency),
			StartDate:       start,
			EndDate:         endPtr,
			NextDueDate:     start,
			SplitStrategy:   string(in.SplitStrategy),
		})
		if err != nil {
			return err
		}
		if err := saveRecurringSplitsTx(ctx, q, created.ID, splits); err != nil {
			return err
		}
		out, err = loadRecurringRuleTx(ctx, q, v.HouseholdID, created.ID)
		if err != nil {
			return err
		}
		return audit.Record(ctx, tx, audit.Entry{
			HouseholdID: audit.Ptr(v.HouseholdID), ActorID: audit.Ptr(v.UserID),
			Action: audit.ActionRecurringCreated, EntityType: "recurring_rule", EntityID: audit.Ptr(created.ID),
			Meta: map[string]any{"workspace_kind": string(ws.Kind), "frequency": string(in.Frequency)},
		})
	})
	return out, err
}

// UpdateRecurringRule atualiza uma recorrência (incluindo pausar/reativar via IsActive).
func (s *Service) UpdateRecurringRule(ctx context.Context, v workspace.Viewer, id uuid.UUID, in RecurringRuleInput) (RecurringRule, error) {
	nextDue, endPtr, err := in.Validate()
	if err != nil {
		return RecurringRule{}, err
	}
	var out RecurringRule
	err = db.WithUserTx(ctx, s.db, v.UserID, func(tx pgx.Tx) error {
		q := expensedb.New(tx)
		cur, err := q.GetRecurringRule(ctx, expensedb.GetRecurringRuleParams{ID: id, HouseholdID: v.HouseholdID})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		ws, err := workspace.GetTx(ctx, tx, v, cur.WorkspaceID)
		if err != nil {
			return ErrNotFound
		}
		expIn := ExpenseInput{
			CategoryID:      in.CategoryID,
			PaymentMethodID: in.PaymentMethodID,
			PaidByUserID:    in.PaidByUserID,
			AmountCents:     in.AmountCents,
			Description:     in.Description,
			IncurredOn:      in.StartDate,
			Notes:           in.Notes,
			SplitStrategy:   in.SplitStrategy,
			Splits:          in.Splits,
		}
		paidBy, splits, _, err := s.validateRefsAndSplits(ctx, tx, v, ws, expIn)
		if err != nil {
			return err
		}
		if _, err := q.UpdateRecurringRule(ctx, expensedb.UpdateRecurringRuleParams{
			ID:              id,
			HouseholdID:     v.HouseholdID,
			CategoryID:      in.CategoryID,
			PaymentMethodID: in.PaymentMethodID,
			PaidByUserID:    paidBy,
			AmountCents:     in.AmountCents,
			Description:     in.Description,
			Notes:           in.Notes,
			Frequency:       string(in.Frequency),
			EndDate:         endPtr,
			NextDueDate:     nextDue,
			SplitStrategy:   string(in.SplitStrategy),
			IsActive:        in.IsActive,
		}); err != nil {
			return err
		}
		if err := q.DeleteRecurringRuleSplits(ctx, id); err != nil {
			return err
		}
		if err := saveRecurringSplitsTx(ctx, q, id, splits); err != nil {
			return err
		}
		out, err = loadRecurringRuleTx(ctx, q, v.HouseholdID, id)
		if err != nil {
			return err
		}
		return audit.Record(ctx, tx, audit.Entry{
			HouseholdID: audit.Ptr(v.HouseholdID), ActorID: audit.Ptr(v.UserID),
			Action: audit.ActionRecurringUpdated, EntityType: "recurring_rule", EntityID: audit.Ptr(id),
			Meta: map[string]any{"workspace_kind": string(ws.Kind), "is_active": in.IsActive},
		})
	})
	return out, err
}

// DeleteRecurringRule remove a regra de recorrência preservando as despesas passadas já geradas.
func (s *Service) DeleteRecurringRule(ctx context.Context, v workspace.Viewer, id uuid.UUID) error {
	return db.WithUserTx(ctx, s.db, v.UserID, func(tx pgx.Tx) error {
		q := expensedb.New(tx)
		cur, err := q.GetRecurringRule(ctx, expensedb.GetRecurringRuleParams{ID: id, HouseholdID: v.HouseholdID})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		ws, err := workspace.GetTx(ctx, tx, v, cur.WorkspaceID)
		if err != nil {
			return ErrNotFound
		}
		n, err := q.DeleteRecurringRule(ctx, expensedb.DeleteRecurringRuleParams{ID: id, HouseholdID: v.HouseholdID})
		if err != nil {
			return err
		}
		if n == 0 {
			return ErrNotFound
		}
		return audit.Record(ctx, tx, audit.Entry{
			HouseholdID: audit.Ptr(v.HouseholdID), ActorID: audit.Ptr(v.UserID),
			Action: audit.ActionRecurringDeleted, EntityType: "recurring_rule", EntityID: audit.Ptr(id),
			Meta: map[string]any{"workspace_kind": string(ws.Kind)},
		})
	})
}

// GenerateResult informa quantas ocorrências foram materializadas.
type GenerateResult struct {
	GeneratedCount int       `json:"generated_count"`
	Items          []Expense `json:"items"`
}

// GenerateDue materializa de forma idempotente todas as recorrências ativas do
// ambiente cujo next_due_date <= upToDate (limitado a MaxCyclesPerGenerate por regra).
func (s *Service) GenerateDue(ctx context.Context, v workspace.Viewer, wsID uuid.UUID, upToDate time.Time) (GenerateResult, error) {
	var res GenerateResult
	res.Items = []Expense{}
	err := db.WithUserTx(ctx, s.db, v.UserID, func(tx pgx.Tx) error {
		ws, err := workspace.GetTx(ctx, tx, v, wsID)
		if err != nil {
			return ErrNotFound
		}
		q := expensedb.New(tx)
		rules, err := q.LockDueRecurringRules(ctx, expensedb.LockDueRecurringRulesParams{
			HouseholdID: v.HouseholdID,
			WorkspaceID: ws.ID,
			UpToDate:    upToDate.UTC(),
		})
		if err != nil {
			return err
		}

		for _, rule := range rules {
			ruleSplits, err := q.ListRecurringRuleSplits(ctx, rule.ID)
			if err != nil {
				return err
			}
			splits := make([]SplitShare, 0, len(ruleSplits))
			for _, rs := range ruleSplits {
				splits = append(splits, SplitShare{
					UserID:     rs.UserID,
					UserName:   rs.UserName,
					WeightBps:  rs.WeightBps,
					ShareCents: rs.ShareCents,
				})
			}

			due := rule.NextDueDate.UTC()
			freq := RecurringFrequency(rule.Frequency)
			active := rule.IsActive
			cycles := 0

			for active && !due.After(upToDate.UTC()) && cycles < MaxCyclesPerGenerate {
				if rule.EndDate != nil && due.After(rule.EndDate.UTC()) {
					active = false
					break
				}
				cycles++
				period := RecurringPeriodKey(due, freq)

				// Idempotência: confere se já existe despesa para (rule.ID, period).
				_, existsErr := q.GetExpenseByRecurringPeriod(ctx, expensedb.GetExpenseByRecurringPeriodParams{
					RecurringRuleID: &rule.ID,
					RecurringPeriod: &period,
				})
				if errors.Is(existsErr, pgx.ErrNoRows) {
					ruleID := rule.ID
					per := period
					created, err := q.CreateExpense(ctx, expensedb.CreateExpenseParams{
						HouseholdID:     v.HouseholdID,
						WorkspaceID:     ws.ID,
						CategoryID:      rule.CategoryID,
						PaymentMethodID: rule.PaymentMethodID,
						PaidByUserID:    rule.PaidByUserID,
						CreatedByUserID: rule.CreatedByUserID,
						AmountCents:     rule.AmountCents,
						Description:     rule.Description,
						IncurredOn:      due,
						Notes:           rule.Notes,
						SplitStrategy:   rule.SplitStrategy,
						RecurringRuleID: &ruleID,
						RecurringPeriod: &per,
					})
					if err != nil {
						return err
					}
					if ws.Kind == workspace.KindHousehold {
						if err := saveSplitsTx(ctx, q, created.ID, splits); err != nil {
							return err
						}
					}
					exp, err := loadExpenseTx(ctx, q, v.HouseholdID, created.ID)
					if err != nil {
						return err
					}
					res.Items = append(res.Items, exp)
					res.GeneratedCount++
				} else if existsErr != nil {
					return existsErr
				}

				due = AdvanceRecurringDate(rule.StartDate, due, freq)
				if rule.EndDate != nil && due.After(rule.EndDate.UTC()) {
					active = false
				}
			}

			if err := q.AdvanceRecurringRuleDueDate(ctx, expensedb.AdvanceRecurringRuleDueDateParams{
				ID:          rule.ID,
				HouseholdID: v.HouseholdID,
				NextDueDate: due,
				IsActive:    active,
			}); err != nil {
				return err
			}
		}

		if res.GeneratedCount > 0 {
			return audit.Record(ctx, tx, audit.Entry{
				HouseholdID: audit.Ptr(v.HouseholdID), ActorID: audit.Ptr(v.UserID),
				Action: audit.ActionRecurringGenerated, EntityType: "workspace", EntityID: audit.Ptr(ws.ID),
				Meta: map[string]any{"generated_count": res.GeneratedCount},
			})
		}
		return nil
	})
	return res, err
}

// StartRecurringWorker materializa periodicamente as recorrências vencidas até a
// data atual para todos os membros ativos (E5-D1), respeitando RLS via WithUserTx.
func (s *Service) StartRecurringWorker(ctx context.Context, pool *expensedb.Queries, wsSvc *workspace.Service, every time.Duration) {
	runOnce := func() {
		opCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		viewers, err := pool.ListAllActiveViewers(opCtx)
		if err != nil {
			slog.Warn("recurring worker: falha ao listar usuários ativos", "err", err)
			return
		}
		today := time.Now().UTC()
		for _, vw := range viewers {
			v := workspace.Viewer{UserID: vw.UserID, HouseholdID: vw.HouseholdID}
			workspaces, err := wsSvc.List(opCtx, v)
			if err != nil {
				continue
			}
			for _, w := range workspaces {
				if res, err := s.GenerateDue(opCtx, v, w.ID, today); err == nil && res.GeneratedCount > 0 {
					slog.Info("recorrências geradas automaticamente", "workspace_id", w.ID, "count", res.GeneratedCount)
				}
				// Emite também alertas deduplicados de vencimento próximo (até 3 dias, E6-D2) em background.
				_, _ = s.ListRecurringRules(opCtx, v, w.ID)
			}
		}
	}

	go func() {
		runOnce()
		t := time.NewTicker(every)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				runOnce()
			}
		}
	}()
}

func saveRecurringSplitsTx(ctx context.Context, q *expensedb.Queries, ruleID uuid.UUID, splits []SplitShare) error {
	for _, sp := range splits {
		if err := q.InsertRecurringRuleSplit(ctx, expensedb.InsertRecurringRuleSplitParams{
			RecurringRuleID: ruleID,
			UserID:          sp.UserID,
			WeightBps:       sp.WeightBps,
			ShareCents:      sp.ShareCents,
		}); err != nil {
			return err
		}
	}
	return nil
}

func loadRecurringRuleTx(ctx context.Context, q *expensedb.Queries, householdID, ruleID uuid.UUID) (RecurringRule, error) {
	row, err := q.GetRecurringRule(ctx, expensedb.GetRecurringRuleParams{ID: ruleID, HouseholdID: householdID})
	if errors.Is(err, pgx.ErrNoRows) {
		return RecurringRule{}, ErrNotFound
	}
	if err != nil {
		return RecurringRule{}, err
	}
	rule := fromRecurringGetRow(row)
	spRows, err := q.ListRecurringRuleSplits(ctx, ruleID)
	if err != nil {
		return RecurringRule{}, err
	}
	rule.Splits = make([]SplitShare, 0, len(spRows))
	for _, sr := range spRows {
		rule.Splits = append(rule.Splits, SplitShare{
			UserID:     sr.UserID,
			UserName:   sr.UserName,
			WeightBps:  sr.WeightBps,
			ShareCents: sr.ShareCents,
		})
	}
	return rule, nil
}

func fromRecurringGetRow(r expensedb.GetRecurringRuleRow) RecurringRule {
	var endStr *string
	if r.EndDate != nil {
		s := r.EndDate.UTC().Format("2006-01-02")
		endStr = &s
	}
	return RecurringRule{
		ID:                r.ID,
		HouseholdID:       r.HouseholdID,
		WorkspaceID:       r.WorkspaceID,
		CategoryID:        r.CategoryID,
		CategoryName:      r.CategoryName,
		PaymentMethodID:   r.PaymentMethodID,
		PaymentMethodName: r.PaymentMethodName,
		PaymentMethodKind: r.PaymentMethodKind,
		PaymentMethodLast: r.PaymentMethodLast4,
		PaidByUserID:      r.PaidByUserID,
		PaidByName:        r.PaidByName,
		CreatedByUserID:   r.CreatedByUserID,
		AmountCents:       r.AmountCents,
		Description:       r.Description,
		Notes:             r.Notes,
		Frequency:         RecurringFrequency(r.Frequency),
		StartDate:         r.StartDate.UTC().Format("2006-01-02"),
		EndDate:           endStr,
		NextDueDate:       r.NextDueDate.UTC().Format("2006-01-02"),
		SplitStrategy:     SplitStrategy(r.SplitStrategy),
		Splits:            []SplitShare{},
		IsActive:          r.IsActive,
		CreatedAt:         r.CreatedAt,
		UpdatedAt:         r.UpdatedAt,
	}
}

func fromRecurringListRow(r expensedb.ListWorkspaceRecurringRulesRow) RecurringRule {
	return fromRecurringGetRow(expensedb.GetRecurringRuleRow(r))
}

func defaultTodayUTC() time.Time {
	return time.Now().UTC()
}

func defaultFirstOfMonthUTC(t time.Time) time.Time {
	y, m, _ := t.UTC().Date()
	return time.Date(y, m, 1, 0, 0, 0, 0, time.UTC)
}
