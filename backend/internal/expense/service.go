package expense

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"financas-familia/backend/internal/audit"
	"financas-familia/backend/internal/expense/expensedb"
	"financas-familia/backend/internal/household/householddb"
	"financas-familia/backend/internal/notification"
	"financas-familia/backend/internal/platform/db"
	"financas-familia/backend/internal/workspace"
)

// Service executa os casos de uso de categorias, meios de pagamento, despesas,
// divisões determinísticas, parcelamentos e estornos dentro de transações com RLS.
type Service struct {
	db db.TxBeginner
}

// NewService cria o serviço.
func NewService(b db.TxBeginner) *Service { return &Service{db: b} }

// SeedDefaultCategories cria as 8 categorias iniciais da residência (E2-D2).
func SeedDefaultCategories(ctx context.Context, tx expensedb.DBTX, householdID uuid.UUID) error {
	return expensedb.New(tx).SeedDefaultCategories(ctx, householdID)
}

// === Categorias ===

func (s *Service) ListCategories(ctx context.Context, v workspace.Viewer, includeArchived bool) ([]Category, error) {
	var out []Category
	err := db.WithUserTx(ctx, s.db, v.UserID, func(tx pgx.Tx) error {
		rows, err := expensedb.New(tx).ListCategories(ctx, expensedb.ListCategoriesParams{
			HouseholdID: v.HouseholdID, IncludeArchived: includeArchived,
		})
		if err != nil {
			return err
		}
		out = make([]Category, 0, len(rows))
		for _, r := range rows {
			out = append(out, Category{ID: r.ID, HouseholdID: r.HouseholdID, Name: r.Name, IsArchived: r.IsArchived})
		}
		return nil
	})
	return out, err
}

func (s *Service) CreateCategory(ctx context.Context, v workspace.Viewer, name string) (Category, error) {
	name, err := ValidateName(name)
	if err != nil {
		return Category{}, err
	}
	var out Category
	err = db.WithUserTx(ctx, s.db, v.UserID, func(tx pgx.Tx) error {
		r, err := expensedb.New(tx).CreateCategory(ctx, expensedb.CreateCategoryParams{
			HouseholdID: v.HouseholdID, Name: name,
		})
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return ErrDuplicateCategory
		}
		if err != nil {
			return err
		}
		out = Category{ID: r.ID, HouseholdID: r.HouseholdID, Name: r.Name, IsArchived: r.IsArchived}
		return audit.Record(ctx, tx, audit.Entry{
			HouseholdID: audit.Ptr(v.HouseholdID), ActorID: audit.Ptr(v.UserID),
			Action: audit.ActionCategoryCreated, EntityType: "category", EntityID: audit.Ptr(r.ID),
		})
	})
	return out, err
}

func (s *Service) UpdateCategory(ctx context.Context, v workspace.Viewer, id uuid.UUID, name string, isArchived bool) (Category, error) {
	name, err := ValidateName(name)
	if err != nil {
		return Category{}, err
	}
	var out Category
	err = db.WithUserTx(ctx, s.db, v.UserID, func(tx pgx.Tx) error {
		r, err := expensedb.New(tx).UpdateCategory(ctx, expensedb.UpdateCategoryParams{
			ID: id, HouseholdID: v.HouseholdID, Name: name, IsArchived: isArchived,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return ErrDuplicateCategory
		}
		if err != nil {
			return err
		}
		out = Category{ID: r.ID, HouseholdID: r.HouseholdID, Name: r.Name, IsArchived: r.IsArchived}
		return audit.Record(ctx, tx, audit.Entry{
			HouseholdID: audit.Ptr(v.HouseholdID), ActorID: audit.Ptr(v.UserID),
			Action: audit.ActionCategoryUpdated, EntityType: "category", EntityID: audit.Ptr(r.ID),
		})
	})
	return out, err
}

// === Meios de pagamento ===

func (s *Service) ListPaymentMethods(ctx context.Context, v workspace.Viewer, includeArchived bool) ([]PaymentMethod, error) {
	var out []PaymentMethod
	err := db.WithUserTx(ctx, s.db, v.UserID, func(tx pgx.Tx) error {
		rows, err := expensedb.New(tx).ListPaymentMethods(ctx, expensedb.ListPaymentMethodsParams{
			HouseholdID: v.HouseholdID, UserID: v.UserID, IncludeArchived: includeArchived,
		})
		if err != nil {
			return err
		}
		out = make([]PaymentMethod, 0, len(rows))
		for _, r := range rows {
			out = append(out, toPaymentMethod(r))
		}
		return nil
	})
	return out, err
}

type CreatePaymentMethodInput struct {
	Name       string
	Kind       PaymentKind
	Last4      *string
	ClosingDay *int32
	DueDay     *int32
	IsPersonal bool
}

func (s *Service) CreatePaymentMethod(ctx context.Context, v workspace.Viewer, in CreatePaymentMethodInput) (PaymentMethod, error) {
	name, err := ValidateName(in.Name)
	if err != nil {
		return PaymentMethod{}, err
	}
	if !in.Kind.Valid() {
		return PaymentMethod{}, ErrInvalidKind
	}
	last4, err := ValidateLast4(in.Kind, in.Last4)
	if err != nil {
		return PaymentMethod{}, err
	}
	closingDay, dueDay, err := ValidateBillingDays(in.Kind, in.ClosingDay, in.DueDay)
	if err != nil {
		return PaymentMethod{}, err
	}
	var ownerID *uuid.UUID
	if in.IsPersonal {
		ownerID = &v.UserID
	}
	var out PaymentMethod
	err = db.WithUserTx(ctx, s.db, v.UserID, func(tx pgx.Tx) error {
		r, err := expensedb.New(tx).CreatePaymentMethod(ctx, expensedb.CreatePaymentMethodParams{
			HouseholdID: v.HouseholdID,
			OwnerUserID: ownerID,
			Name:        name,
			Kind:        string(in.Kind),
			Last4:       last4,
			ClosingDay:  closingDay,
			DueDay:      dueDay,
		})
		if err != nil {
			return err
		}
		out = toPaymentMethod(r)
		return audit.Record(ctx, tx, audit.Entry{
			HouseholdID: audit.Ptr(v.HouseholdID), ActorID: audit.Ptr(v.UserID),
			Action: audit.ActionPaymentCreated, EntityType: "payment_method", EntityID: audit.Ptr(r.ID),
		})
	})
	return out, err
}

func (s *Service) UpdatePaymentMethod(ctx context.Context, v workspace.Viewer, id uuid.UUID, name string, closingDay, dueDay *int32, isArchived bool) (PaymentMethod, error) {
	name, err := ValidateName(name)
	if err != nil {
		return PaymentMethod{}, err
	}
	var out PaymentMethod
	err = db.WithUserTx(ctx, s.db, v.UserID, func(tx pgx.Tx) error {
		q := expensedb.New(tx)
		cur, err := q.GetPaymentMethod(ctx, expensedb.GetPaymentMethodParams{
			ID: id, HouseholdID: v.HouseholdID, UserID: v.UserID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		cd, dd, err := ValidateBillingDays(PaymentKind(cur.Kind), closingDay, dueDay)
		if err != nil {
			return err
		}
		r, err := q.UpdatePaymentMethod(ctx, expensedb.UpdatePaymentMethodParams{
			ID: id, HouseholdID: v.HouseholdID, UserID: v.UserID, Name: name,
			ClosingDay: cd, DueDay: dd, IsArchived: isArchived,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		out = toPaymentMethod(r)
		return audit.Record(ctx, tx, audit.Entry{
			HouseholdID: audit.Ptr(v.HouseholdID), ActorID: audit.Ptr(v.UserID),
			Action: audit.ActionPaymentUpdated, EntityType: "payment_method", EntityID: audit.Ptr(r.ID),
		})
	})
	return out, err
}

func toPaymentMethod(r expensedb.PaymentMethod) PaymentMethod {
	return PaymentMethod{
		ID: r.ID, HouseholdID: r.HouseholdID, OwnerUserID: r.OwnerUserID,
		IsPersonal: r.OwnerUserID != nil, Name: r.Name, Kind: PaymentKind(r.Kind),
		Last4: r.Last4, ClosingDay: r.ClosingDay, DueDay: r.DueDay, IsArchived: r.IsArchived,
	}
}

// === Despesas, Divisões, Parcelamentos e Estornos ===

type ExpenseFilter struct {
	FromDate   *string // AAAA-MM-DD
	ToDate     *string // AAAA-MM-DD
	CategoryID *uuid.UUID
}

type ExpenseListResult struct {
	Items      []Expense `json:"items"`
	TotalCents int64     `json:"total_cents"` // soma líquida (amount_cents - refunded_cents)
	Count      int       `json:"count"`
}

func (s *Service) ListByWorkspace(ctx context.Context, v workspace.Viewer, wsID uuid.UUID, f ExpenseFilter) (ExpenseListResult, error) {
	var (
		filterFrom bool
		fromDate   time.Time
		filterTo   bool
		toDate     time.Time
		filterCat  bool
		catID      uuid.UUID
	)
	if f.FromDate != nil && *f.FromDate != "" {
		t, err := ParseDate(*f.FromDate)
		if err != nil {
			return ExpenseListResult{}, err
		}
		filterFrom, fromDate = true, t
	}
	if f.ToDate != nil && *f.ToDate != "" {
		t, err := ParseDate(*f.ToDate)
		if err != nil {
			return ExpenseListResult{}, err
		}
		filterTo, toDate = true, t
	}
	if f.CategoryID != nil && *f.CategoryID != uuid.Nil {
		filterCat, catID = true, *f.CategoryID
	}

	var res ExpenseListResult
	err := db.WithUserTx(ctx, s.db, v.UserID, func(tx pgx.Tx) error {
		if _, err := workspace.GetTx(ctx, tx, v, wsID); err != nil {
			return ErrNotFound
		}
		q := expensedb.New(tx)
		rows, err := q.ListWorkspaceExpenses(ctx, expensedb.ListWorkspaceExpensesParams{
			HouseholdID:    v.HouseholdID,
			WorkspaceID:    wsID,
			FilterFrom:     filterFrom,
			FromDate:       fromDate,
			FilterTo:       filterTo,
			ToDate:         toDate,
			FilterCategory: filterCat,
			CategoryID:     catID,
		})
		if err != nil {
			return err
		}

		splitRows, err := q.ListWorkspaceExpenseSplits(ctx, expensedb.ListWorkspaceExpenseSplitsParams{
			HouseholdID: v.HouseholdID, WorkspaceID: wsID,
		})
		if err != nil {
			return err
		}
		splitsByExp := make(map[uuid.UUID][]SplitShare)
		for _, sr := range splitRows {
			splitsByExp[sr.ExpenseID] = append(splitsByExp[sr.ExpenseID], SplitShare{
				UserID:     sr.UserID,
				UserName:   sr.UserName,
				WeightBps:  sr.WeightBps,
				ShareCents: sr.ShareCents,
			})
		}

		res.Items = make([]Expense, 0, len(rows))
		for _, r := range rows {
			e := fromListRow(r)
			if sp := splitsByExp[e.ID]; len(sp) > 0 {
				e.Splits = sp
			} else {
				e.Splits = []SplitShare{}
			}
			res.Items = append(res.Items, e)
			res.TotalCents += e.NetAmountCents
		}
		res.Count = len(res.Items)
		return nil
	})
	return res, err
}

// Create cria uma despesa à vista (TotalInstallments == 1) ou materializa um
// parcelamento de 2..48 parcelas na mesma transação (ADR 0007).
func (s *Service) Create(ctx context.Context, v workspace.Viewer, wsID uuid.UUID, in ExpenseInput) (Expense, error) {
	incurredOn, err := in.Validate()
	if err != nil {
		return Expense{}, err
	}
	var out Expense
	err = db.WithUserTx(ctx, s.db, v.UserID, func(tx pgx.Tx) error {
		ws, err := workspace.GetTx(ctx, tx, v, wsID)
		if err != nil {
			return ErrNotFound
		}
		paidBy, totalSplits, pm, err := s.validateRefsAndSplits(ctx, tx, v, ws, in)
		if err != nil {
			return err
		}
		q := expensedb.New(tx)

		if in.TotalInstallments == 1 {
			created, err := q.CreateExpense(ctx, expensedb.CreateExpenseParams{
				HouseholdID:     v.HouseholdID,
				WorkspaceID:     ws.ID,
				CategoryID:      in.CategoryID,
				PaymentMethodID: in.PaymentMethodID,
				PaidByUserID:    paidBy,
				CreatedByUserID: v.UserID,
				AmountCents:     in.AmountCents,
				Description:     in.Description,
				IncurredOn:      incurredOn,
				Notes:           in.Notes,
				SplitStrategy:   string(in.SplitStrategy),
			})
			if err != nil {
				return err
			}
			if err := saveSplitsTx(ctx, q, created.ID, totalSplits); err != nil {
				return err
			}
			out, err = loadExpenseTx(ctx, q, v.HouseholdID, created.ID)
			if err != nil {
				return err
			}
			if ws.Kind == workspace.KindHousehold {
				if err := notifyCollectiveExpenseTx(ctx, tx, v.HouseholdID, v.UserID, out); err != nil {
					return err
				}
			}
			return audit.Record(ctx, tx, audit.Entry{
				HouseholdID: audit.Ptr(v.HouseholdID), ActorID: audit.Ptr(v.UserID),
				Action: audit.ActionExpenseCreated, EntityType: "expense", EntityID: audit.Ptr(created.ID),
				Meta: map[string]any{"workspace_kind": string(ws.Kind), "split_strategy": string(in.SplitStrategy)},
			})
		}

		// Compra parcelada (2..48x): materializa installment_plan + N parcelas.
		var closingDay *int32
		if pm != nil {
			closingDay = pm.ClosingDay
		}
		schedule, err := ComputeInstallmentSchedule(in.AmountCents, in.TotalInstallments, incurredOn, closingDay)
		if err != nil {
			return err
		}
		plan, err := q.CreateInstallmentPlan(ctx, expensedb.CreateInstallmentPlanParams{
			HouseholdID:       v.HouseholdID,
			WorkspaceID:       ws.ID,
			CategoryID:        in.CategoryID,
			PaymentMethodID:   in.PaymentMethodID,
			PaidByUserID:      paidBy,
			CreatedByUserID:   v.UserID,
			TotalAmountCents:  in.AmountCents,
			TotalInstallments: int32(in.TotalInstallments),
			Description:       in.Description,
			FirstIncurredOn:   schedule[0].IncurredOn,
		})
		if err != nil {
			return err
		}

		var firstExpenseID uuid.UUID
		for _, sl := range schedule {
			var sliceSplits []SplitShare
			if ws.Kind == workspace.KindHousehold {
				sliceSplits, err = ComputeRefundSplits(sl.AmountCents, paidBy, totalSplits)
				if err != nil {
					return err
				}
			}
			num := sl.Number
			tot := sl.Total
			created, err := q.CreateExpense(ctx, expensedb.CreateExpenseParams{
				HouseholdID:       v.HouseholdID,
				WorkspaceID:       ws.ID,
				CategoryID:        in.CategoryID,
				PaymentMethodID:   in.PaymentMethodID,
				PaidByUserID:      paidBy,
				CreatedByUserID:   v.UserID,
				AmountCents:       sl.AmountCents,
				Description:       in.Description,
				IncurredOn:        sl.IncurredOn,
				Notes:             in.Notes,
				SplitStrategy:     string(in.SplitStrategy),
				InstallmentPlanID: &plan.ID,
				InstallmentNumber: &num,
				TotalInstallments: &tot,
			})
			if err != nil {
				return err
			}
			if err := saveSplitsTx(ctx, q, created.ID, sliceSplits); err != nil {
				return err
			}
			if sl.Number == 1 {
				firstExpenseID = created.ID
			}
		}

		out, err = loadExpenseTx(ctx, q, v.HouseholdID, firstExpenseID)
		if err != nil {
			return err
		}
		if ws.Kind == workspace.KindHousehold {
			if err := notifyCollectiveExpenseTx(ctx, tx, v.HouseholdID, v.UserID, out); err != nil {
				return err
			}
		}
		return audit.Record(ctx, tx, audit.Entry{
			HouseholdID: audit.Ptr(v.HouseholdID), ActorID: audit.Ptr(v.UserID),
			Action: audit.ActionInstallmentCreated, EntityType: "installment_plan", EntityID: audit.Ptr(plan.ID),
			Meta: map[string]any{"workspace_kind": string(ws.Kind), "total_installments": in.TotalInstallments},
		})
	})
	return out, err
}

func (s *Service) Get(ctx context.Context, v workspace.Viewer, id uuid.UUID) (Expense, error) {
	var out Expense
	err := db.WithUserTx(ctx, s.db, v.UserID, func(tx pgx.Tx) error {
		q := expensedb.New(tx)
		exp, err := loadExpenseTx(ctx, q, v.HouseholdID, id)
		if err != nil {
			return err
		}
		if _, err := workspace.GetTx(ctx, tx, v, exp.WorkspaceID); err != nil {
			return ErrNotFound
		}
		out = exp
		return nil
	})
	return out, err
}

func (s *Service) Update(ctx context.Context, v workspace.Viewer, id uuid.UUID, in ExpenseInput) (Expense, error) {
	in.TotalInstallments = 1 // edição atua sobre o lançamento/parcela individual
	incurredOn, err := in.Validate()
	if err != nil {
		return Expense{}, err
	}
	var out Expense
	err = db.WithUserTx(ctx, s.db, v.UserID, func(tx pgx.Tx) error {
		q := expensedb.New(tx)
		cur, err := q.GetExpense(ctx, expensedb.GetExpenseParams{ID: id, HouseholdID: v.HouseholdID})
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
		if in.AmountCents < cur.RefundedCents {
			return ErrInvalidRefundAmount
		}
		paidBy, splits, _, err := s.validateRefsAndSplits(ctx, tx, v, ws, in)
		if err != nil {
			return err
		}
		if _, err := q.UpdateExpense(ctx, expensedb.UpdateExpenseParams{
			ID:              id,
			HouseholdID:     v.HouseholdID,
			CategoryID:      in.CategoryID,
			PaymentMethodID: in.PaymentMethodID,
			PaidByUserID:    paidBy,
			AmountCents:     in.AmountCents,
			Description:     in.Description,
			IncurredOn:      incurredOn,
			Notes:           in.Notes,
			SplitStrategy:   string(in.SplitStrategy),
		}); err != nil {
			return err
		}
		if err := q.DeleteExpenseSplits(ctx, id); err != nil {
			return err
		}
		if err := saveSplitsTx(ctx, q, id, splits); err != nil {
			return err
		}
		out, err = loadExpenseTx(ctx, q, v.HouseholdID, id)
		if err != nil {
			return err
		}
		return audit.Record(ctx, tx, audit.Entry{
			HouseholdID: audit.Ptr(v.HouseholdID), ActorID: audit.Ptr(v.UserID),
			Action: audit.ActionExpenseUpdated, EntityType: "expense", EntityID: audit.Ptr(id),
			Meta: map[string]any{"workspace_kind": string(ws.Kind), "split_strategy": string(in.SplitStrategy)},
		})
	})
	return out, err
}

func (s *Service) Delete(ctx context.Context, v workspace.Viewer, id uuid.UUID) error {
	return db.WithUserTx(ctx, s.db, v.UserID, func(tx pgx.Tx) error {
		q := expensedb.New(tx)
		cur, err := q.GetExpense(ctx, expensedb.GetExpenseParams{ID: id, HouseholdID: v.HouseholdID})
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
		n, err := q.DeleteExpense(ctx, expensedb.DeleteExpenseParams{ID: id, HouseholdID: v.HouseholdID})
		if err != nil {
			return err
		}
		if n == 0 {
			return ErrNotFound
		}
		return audit.Record(ctx, tx, audit.Entry{
			HouseholdID: audit.Ptr(v.HouseholdID), ActorID: audit.Ptr(v.UserID),
			Action: audit.ActionExpenseDeleted, EntityType: "expense", EntityID: audit.Ptr(id),
			Meta: map[string]any{"workspace_kind": string(ws.Kind)},
		})
	})
}

// DeleteInstallmentPlan exclui todas as parcelas de um parcelamento de uma só vez (E4-D2).
func (s *Service) DeleteInstallmentPlan(ctx context.Context, v workspace.Viewer, planID uuid.UUID) error {
	return db.WithUserTx(ctx, s.db, v.UserID, func(tx pgx.Tx) error {
		q := expensedb.New(tx)
		plan, err := q.GetInstallmentPlan(ctx, expensedb.GetInstallmentPlanParams{
			ID: planID, HouseholdID: v.HouseholdID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		ws, err := workspace.GetTx(ctx, tx, v, plan.WorkspaceID)
		if err != nil {
			return ErrNotFound
		}
		n, err := q.DeleteInstallmentPlan(ctx, expensedb.DeleteInstallmentPlanParams{
			ID: planID, HouseholdID: v.HouseholdID,
		})
		if err != nil {
			return err
		}
		if n == 0 {
			return ErrNotFound
		}
		return audit.Record(ctx, tx, audit.Entry{
			HouseholdID: audit.Ptr(v.HouseholdID), ActorID: audit.Ptr(v.UserID),
			Action: audit.ActionInstallmentDeleted, EntityType: "installment_plan", EntityID: audit.Ptr(planID),
			Meta: map[string]any{"workspace_kind": string(ws.Kind)},
		})
	})
}

func (s *Service) ShareWithHousehold(ctx context.Context, v workspace.Viewer, id uuid.UUID) (Expense, error) {
	var out Expense
	err := db.WithUserTx(ctx, s.db, v.UserID, func(tx pgx.Tx) error {
		q := expensedb.New(tx)
		cur, err := q.GetExpense(ctx, expensedb.GetExpenseParams{ID: id, HouseholdID: v.HouseholdID})
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
		if ws.Kind == workspace.KindHousehold {
			return ErrAlreadyShared
		}
		collective, err := workspace.GetCollectiveTx(ctx, tx, v)
		if err != nil {
			return fmt.Errorf("buscar ambiente coletivo: %w", err)
		}
		members, err := householddb.New(tx).ListActiveMembers(ctx, v.HouseholdID)
		if err != nil {
			return err
		}
		inputs := make([]SplitInput, 0, len(members))
		for _, m := range members {
			inputs = append(inputs, SplitInput{UserID: m.ID})
		}
		splits, err := ComputeSplits(cur.AmountCents, cur.PaidByUserID, SplitEqual, inputs)
		if err != nil {
			return err
		}
		if _, err := q.ShareExpenseToWorkspace(ctx, expensedb.ShareExpenseToWorkspaceParams{
			ID: id, HouseholdID: v.HouseholdID, TargetWorkspaceID: collective.ID, SplitStrategy: string(SplitEqual),
		}); err != nil {
			return err
		}
		if err := q.DeleteExpenseSplits(ctx, id); err != nil {
			return err
		}
		if err := saveSplitsTx(ctx, q, id, splits); err != nil {
			return err
		}
		out, err = loadExpenseTx(ctx, q, v.HouseholdID, id)
		if err != nil {
			return err
		}
		if err := notifyCollectiveExpenseTx(ctx, tx, v.HouseholdID, v.UserID, out); err != nil {
			return err
		}
		return audit.Record(ctx, tx, audit.Entry{
			HouseholdID: audit.Ptr(v.HouseholdID), ActorID: audit.Ptr(v.UserID),
			Action: audit.ActionExpenseShared, EntityType: "expense", EntityID: audit.Ptr(id),
		})
	})
	return out, err
}

// CreateRefund registra um estorno parcial ou total numa despesa e, quando
// coletiva, distribui o crédito proporcionalmente entre os participantes (ADR 0007).
func (s *Service) CreateRefund(ctx context.Context, v workspace.Viewer, expenseID uuid.UUID, in RefundInput) (Expense, error) {
	refundedOn, err := in.Validate()
	if err != nil {
		return Expense{}, err
	}
	var out Expense
	err = db.WithUserTx(ctx, s.db, v.UserID, func(tx pgx.Tx) error {
		q := expensedb.New(tx)
		locked, err := q.LockExpenseForUpdate(ctx, expensedb.LockExpenseForUpdateParams{
			ID: expenseID, HouseholdID: v.HouseholdID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		ws, err := workspace.GetTx(ctx, tx, v, locked.WorkspaceID)
		if err != nil {
			return ErrNotFound
		}
		remaining := locked.AmountCents - locked.RefundedCents
		if in.AmountCents > remaining {
			return ErrInvalidRefundAmount
		}

		if _, err := q.AddExpenseRefundedCents(ctx, expensedb.AddExpenseRefundedCentsParams{
			ID: expenseID, HouseholdID: v.HouseholdID, DeltaCents: in.AmountCents,
		}); err != nil {
			return err
		}
		ref, err := q.CreateExpenseRefund(ctx, expensedb.CreateExpenseRefundParams{
			ExpenseID:       expenseID,
			HouseholdID:     v.HouseholdID,
			AmountCents:     in.AmountCents,
			RefundedOn:      refundedOn,
			Reason:          in.Reason,
			CreatedByUserID: v.UserID,
		})
		if err != nil {
			return err
		}

		if ws.Kind == workspace.KindHousehold {
			spRows, err := q.ListExpenseSplits(ctx, expenseID)
			if err != nil {
				return err
			}
			origSplits := make([]SplitShare, 0, len(spRows))
			for _, sr := range spRows {
				origSplits = append(origSplits, SplitShare{UserID: sr.UserID, ShareCents: sr.ShareCents})
			}
			refSplits, err := ComputeRefundSplits(in.AmountCents, locked.PaidByUserID, origSplits)
			if err != nil {
				return err
			}
			for _, rs := range refSplits {
				if err := q.InsertExpenseRefundSplit(ctx, expensedb.InsertExpenseRefundSplitParams{
					RefundID: ref.ID, UserID: rs.UserID, ShareCents: rs.ShareCents,
				}); err != nil {
					return err
				}
			}
		}

		out, err = loadExpenseTx(ctx, q, v.HouseholdID, expenseID)
		if err != nil {
			return err
		}
		return audit.Record(ctx, tx, audit.Entry{
			HouseholdID: audit.Ptr(v.HouseholdID), ActorID: audit.Ptr(v.UserID),
			Action: audit.ActionExpenseRefunded, EntityType: "expense_refund", EntityID: audit.Ptr(ref.ID),
			Meta: map[string]any{"workspace_kind": string(ws.Kind)},
		})
	})
	return out, err
}

// ListRefunds lista os estornos registrados numa despesa acessível.
func (s *Service) ListRefunds(ctx context.Context, v workspace.Viewer, expenseID uuid.UUID) ([]Refund, error) {
	var out []Refund
	err := db.WithUserTx(ctx, s.db, v.UserID, func(tx pgx.Tx) error {
		q := expensedb.New(tx)
		cur, err := q.GetExpense(ctx, expensedb.GetExpenseParams{ID: expenseID, HouseholdID: v.HouseholdID})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if _, err := workspace.GetTx(ctx, tx, v, cur.WorkspaceID); err != nil {
			return ErrNotFound
		}
		rows, err := q.ListExpenseRefunds(ctx, expensedb.ListExpenseRefundsParams{
			ExpenseID: expenseID, HouseholdID: v.HouseholdID,
		})
		if err != nil {
			return err
		}
		out = make([]Refund, 0, len(rows))
		for _, r := range rows {
			out = append(out, Refund{
				ID:              r.ID,
				ExpenseID:       r.ExpenseID,
				HouseholdID:     r.HouseholdID,
				AmountCents:     r.AmountCents,
				RefundedOn:      r.RefundedOn.UTC().Format("2006-01-02"),
				Reason:          r.Reason,
				CreatedByUserID: r.CreatedByUserID,
				CreatedByName:   r.CreatedByName,
				CreatedAt:       r.CreatedAt,
			})
		}
		return nil
	})
	return out, err
}

func (s *Service) validateRefsAndSplits(ctx context.Context, tx pgx.Tx, v workspace.Viewer, ws workspace.Workspace, in ExpenseInput) (uuid.UUID, []SplitShare, *expensedb.PaymentMethod, error) {
	q := expensedb.New(tx)
	if _, err := q.GetCategory(ctx, expensedb.GetCategoryParams{ID: in.CategoryID, HouseholdID: v.HouseholdID}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return uuid.Nil, nil, nil, fmt.Errorf("categoria não encontrada")
		}
		return uuid.Nil, nil, nil, err
	}
	var pmPtr *expensedb.PaymentMethod
	if in.PaymentMethodID != nil {
		pm, err := q.GetPaymentMethod(ctx, expensedb.GetPaymentMethodParams{
			ID: *in.PaymentMethodID, HouseholdID: v.HouseholdID, UserID: v.UserID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return uuid.Nil, nil, nil, fmt.Errorf("meio de pagamento não encontrado")
			}
			return uuid.Nil, nil, nil, err
		}
		pmPtr = &pm
	}

	members, err := householddb.New(tx).ListActiveMembers(ctx, v.HouseholdID)
	if err != nil {
		return uuid.Nil, nil, nil, err
	}
	activeSet := make(map[uuid.UUID]bool, len(members))
	for _, m := range members {
		activeSet[m.ID] = true
	}

	paidBy := in.PaidByUserID
	if paidBy == uuid.Nil {
		paidBy = v.UserID
	}
	if ws.Kind == workspace.KindPersonal && paidBy != v.UserID {
		return uuid.Nil, nil, nil, ErrInvalidPaidBy
	}
	if !activeSet[paidBy] {
		return uuid.Nil, nil, nil, ErrInvalidPaidBy
	}

	if ws.Kind == workspace.KindPersonal {
		return paidBy, nil, pmPtr, nil
	}

	splitInputs := in.Splits
	if len(splitInputs) == 0 {
		if in.SplitStrategy != SplitEqual {
			return uuid.Nil, nil, nil, ErrInvalidSplit
		}
		for _, m := range members {
			splitInputs = append(splitInputs, SplitInput{UserID: m.ID})
		}
	} else {
		for _, si := range splitInputs {
			if !activeSet[si.UserID] {
				return uuid.Nil, nil, nil, ErrInvalidSplit
			}
		}
	}

	splits, err := ComputeSplits(in.AmountCents, paidBy, in.SplitStrategy, splitInputs)
	if err != nil {
		return uuid.Nil, nil, nil, err
	}
	return paidBy, splits, pmPtr, nil
}

func saveSplitsTx(ctx context.Context, q *expensedb.Queries, expenseID uuid.UUID, splits []SplitShare) error {
	for _, sp := range splits {
		if err := q.InsertExpenseSplit(ctx, expensedb.InsertExpenseSplitParams{
			ExpenseID:  expenseID,
			UserID:     sp.UserID,
			WeightBps:  sp.WeightBps,
			ShareCents: sp.ShareCents,
		}); err != nil {
			return err
		}
	}
	return nil
}

func loadExpenseTx(ctx context.Context, q *expensedb.Queries, householdID, expenseID uuid.UUID) (Expense, error) {
	row, err := q.GetExpense(ctx, expensedb.GetExpenseParams{ID: expenseID, HouseholdID: householdID})
	if errors.Is(err, pgx.ErrNoRows) {
		return Expense{}, ErrNotFound
	}
	if err != nil {
		return Expense{}, err
	}
	exp := fromGetRow(row)
	spRows, err := q.ListExpenseSplits(ctx, expenseID)
	if err != nil {
		return Expense{}, err
	}
	exp.Splits = make([]SplitShare, 0, len(spRows))
	for _, sr := range spRows {
		exp.Splits = append(exp.Splits, SplitShare{
			UserID:     sr.UserID,
			UserName:   sr.UserName,
			WeightBps:  sr.WeightBps,
			ShareCents: sr.ShareCents,
		})
	}
	return exp, nil
}

func fromGetRow(r expensedb.GetExpenseRow) Expense {
	return Expense{
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
		RefundedCents:     r.RefundedCents,
		NetAmountCents:    r.AmountCents - r.RefundedCents,
		Description:       r.Description,
		IncurredOn:        r.IncurredOn.UTC().Format("2006-01-02"),
		Notes:             r.Notes,
		SplitStrategy:     SplitStrategy(r.SplitStrategy),
		Splits:            []SplitShare{},
		InstallmentPlanID: r.InstallmentPlanID,
		InstallmentNumber: r.InstallmentNumber,
		TotalInstallments: r.TotalInstallments,
		RecurringRuleID:   r.RecurringRuleID,
		RecurringPeriod:   r.RecurringPeriod,
		SharedAt:          r.SharedAt,
		CreatedAt:         r.CreatedAt,
		UpdatedAt:         r.UpdatedAt,
	}
}

func fromListRow(r expensedb.ListWorkspaceExpensesRow) Expense {
	return fromGetRow(expensedb.GetExpenseRow(r))
}

func notifyCollectiveExpenseTx(ctx context.Context, tx pgx.Tx, householdID, actorID uuid.UUID, exp Expense) error {
	for _, sp := range exp.Splits {
		if sp.UserID == actorID {
			continue
		}
		if err := notification.SendTx(ctx, tx, notification.SendParams{
			HouseholdID:     householdID,
			RecipientUserID: sp.UserID,
			Kind:            notification.KindCollectiveExpense,
			Title:           "Nova despesa coletiva na família",
			Body:            exp.Description + " foi registrada no Espaço da Família.",
			EntityType:      "expense",
			EntityID:        exp.ID,
		}); err != nil {
			return err
		}
	}
	return nil
}
