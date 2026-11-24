-- Módulo expense: categorias, meios de pagamento, despesas, divisões, parcelamentos, estornos e recorrências.
-- Todas as consultas da API rodam em transação com app.user_id definido (RLS).

-- === Categorias ===

-- name: ListCategories :many
SELECT * FROM category
 WHERE household_id = @household_id
   AND (@include_archived::bool OR NOT is_archived)
 ORDER BY is_archived, name;

-- name: GetCategory :one
SELECT * FROM category WHERE id = @id AND household_id = @household_id;

-- name: CreateCategory :one
INSERT INTO category (household_id, name)
VALUES (@household_id, @name)
RETURNING *;

-- name: UpdateCategory :one
UPDATE category
   SET name = @name,
       is_archived = @is_archived
 WHERE id = @id AND household_id = @household_id
RETURNING *;

-- name: SeedDefaultCategories :exec
INSERT INTO category (household_id, name)
SELECT @household_id, c.name
  FROM (
      VALUES ('Alimentação'),
             ('Moradia'),
             ('Contas'),
             ('Transporte'),
             ('Saúde'),
             ('Lazer'),
             ('Educação'),
             ('Outros')
  ) AS c(name)
ON CONFLICT (household_id, name) DO NOTHING;

-- === Meios de pagamento ===

-- name: ListPaymentMethods :many
SELECT * FROM payment_method
 WHERE household_id = @household_id
   AND (owner_user_id IS NULL OR owner_user_id = @user_id::uuid)
   AND (@include_archived::bool OR NOT is_archived)
 ORDER BY is_archived, (owner_user_id IS NULL) DESC, name;

-- name: GetPaymentMethod :one
SELECT * FROM payment_method
 WHERE id = @id
   AND household_id = @household_id
   AND (owner_user_id IS NULL OR owner_user_id = @user_id::uuid);

-- name: CreatePaymentMethod :one
INSERT INTO payment_method (household_id, owner_user_id, name, kind, last4, closing_day, due_day)
VALUES (@household_id, @owner_user_id, @name, @kind, @last4, @closing_day, @due_day)
RETURNING *;

-- name: UpdatePaymentMethod :one
UPDATE payment_method
   SET name = @name,
       closing_day = @closing_day,
       due_day = @due_day,
       is_archived = @is_archived
 WHERE id = @id
   AND household_id = @household_id
   AND (owner_user_id IS NULL OR owner_user_id = @user_id::uuid)
RETURNING *;

-- === Parcelamentos (installment_plan) ===

-- name: CreateInstallmentPlan :one
INSERT INTO installment_plan (
    household_id, workspace_id, category_id, payment_method_id,
    paid_by_user_id, created_by_user_id, total_amount_cents,
    total_installments, description, first_incurred_on
) VALUES (
    @household_id, @workspace_id, @category_id, @payment_method_id,
    @paid_by_user_id, @created_by_user_id, @total_amount_cents,
    @total_installments, @description, @first_incurred_on
)
RETURNING *;

-- name: GetInstallmentPlan :one
SELECT * FROM installment_plan WHERE id = @id AND household_id = @household_id;

-- name: DeleteInstallmentPlan :execrows
DELETE FROM installment_plan WHERE id = @id AND household_id = @household_id;

-- === Despesas ===

-- name: CreateExpense :one
INSERT INTO expense (
    household_id, workspace_id, category_id, payment_method_id,
    paid_by_user_id, created_by_user_id, amount_cents, description,
    incurred_on, notes, split_strategy,
    installment_plan_id, installment_number, total_installments,
    recurring_rule_id, recurring_period
) VALUES (
    @household_id, @workspace_id, @category_id, @payment_method_id,
    @paid_by_user_id, @created_by_user_id, @amount_cents, @description,
    @incurred_on, @notes, @split_strategy,
    @installment_plan_id, @installment_number, @total_installments,
    @recurring_rule_id, @recurring_period
)
RETURNING *;

-- name: GetExpenseByRecurringPeriod :one
SELECT id FROM expense
 WHERE recurring_rule_id = @recurring_rule_id
   AND recurring_period = @recurring_period;

-- name: GetExpense :one
SELECT e.*,
       c.name AS category_name,
       pm.name AS payment_method_name,
       pm.kind AS payment_method_kind,
       pm.last4 AS payment_method_last4,
       u.name AS paid_by_name
  FROM expense e
  JOIN category c ON c.id = e.category_id
  LEFT JOIN payment_method pm ON pm.id = e.payment_method_id
  JOIN app_user u ON u.id = e.paid_by_user_id
 WHERE e.id = @id AND e.household_id = @household_id;

-- name: LockExpenseForUpdate :one
SELECT * FROM expense WHERE id = @id AND household_id = @household_id FOR UPDATE;

-- name: ListWorkspaceExpenses :many
SELECT e.*,
       c.name AS category_name,
       pm.name AS payment_method_name,
       pm.kind AS payment_method_kind,
       pm.last4 AS payment_method_last4,
       u.name AS paid_by_name
  FROM expense e
  JOIN category c ON c.id = e.category_id
  LEFT JOIN payment_method pm ON pm.id = e.payment_method_id
  JOIN app_user u ON u.id = e.paid_by_user_id
 WHERE e.household_id = @household_id
   AND e.workspace_id = @workspace_id
   AND (@filter_from::bool = false OR e.incurred_on >= @from_date::date)
   AND (@filter_to::bool = false OR e.incurred_on <= @to_date::date)
   AND (@filter_category::bool = false OR e.category_id = @category_id::uuid)
 ORDER BY e.incurred_on DESC, e.created_at DESC
 LIMIT @max_rows;

-- name: UpdateExpense :one
UPDATE expense
   SET category_id = @category_id,
       payment_method_id = @payment_method_id,
       paid_by_user_id = @paid_by_user_id,
       amount_cents = @amount_cents,
       description = @description,
       incurred_on = @incurred_on,
       notes = @notes,
       split_strategy = @split_strategy,
       updated_at = now()
 WHERE id = @id AND household_id = @household_id
RETURNING *;

-- name: AddExpenseRefundedCents :one
UPDATE expense
   SET refunded_cents = refunded_cents + @delta_cents,
       updated_at = now()
 WHERE id = @id AND household_id = @household_id
RETURNING *;

-- name: DeleteExpense :execrows
DELETE FROM expense WHERE id = @id AND household_id = @household_id;

-- name: ShareExpenseToWorkspace :one
UPDATE expense
   SET workspace_id = @target_workspace_id,
       split_strategy = @split_strategy,
       shared_at = now(),
       updated_at = now()
 WHERE id = @id AND household_id = @household_id
RETURNING *;

-- === Divisões (expense_split) ===

-- name: DeleteExpenseSplits :exec
DELETE FROM expense_split WHERE expense_id = @expense_id;

-- name: InsertExpenseSplit :exec
INSERT INTO expense_split (expense_id, user_id, weight_bps, share_cents)
VALUES (@expense_id, @user_id, @weight_bps, @share_cents);

-- name: ListExpenseSplits :many
SELECT s.expense_id, s.user_id, u.name AS user_name, s.weight_bps, s.share_cents
  FROM expense_split s
  JOIN app_user u ON u.id = s.user_id
 WHERE s.expense_id = @expense_id
 ORDER BY u.name, s.user_id;

-- name: ListWorkspaceExpenseSplits :many
SELECT s.expense_id, s.user_id, u.name AS user_name, s.weight_bps, s.share_cents
  FROM expense_split s
  JOIN expense e ON e.id = s.expense_id
  JOIN app_user u ON u.id = s.user_id
 WHERE e.household_id = @household_id
   AND e.workspace_id = @workspace_id
   AND (@filter_from::bool = false OR e.incurred_on >= @from_date::date)
   AND (@filter_to::bool = false OR e.incurred_on <= @to_date::date)
   AND (@filter_category::bool = false OR e.category_id = @category_id::uuid)
 ORDER BY u.name, s.user_id;

-- === Estornos (expense_refund) ===

-- name: CreateExpenseRefund :one
INSERT INTO expense_refund (
    expense_id, household_id, amount_cents, refunded_on, reason, created_by_user_id
) VALUES (
    @expense_id, @household_id, @amount_cents, @refunded_on, @reason, @created_by_user_id
)
RETURNING *;

-- name: InsertExpenseRefundSplit :exec
INSERT INTO expense_refund_split (refund_id, user_id, share_cents)
VALUES (@refund_id, @user_id, @share_cents);

-- name: ListExpenseRefunds :many
SELECT r.*, u.name AS created_by_name
  FROM expense_refund r
  JOIN app_user u ON u.id = r.created_by_user_id
 WHERE r.expense_id = @expense_id AND r.household_id = @household_id
 ORDER BY r.refunded_on DESC, r.created_at DESC;

-- === Recorrências e Assinaturas (recurring_rule) ===

-- name: CreateRecurringRule :one
INSERT INTO recurring_rule (
    household_id, workspace_id, category_id, payment_method_id,
    paid_by_user_id, created_by_user_id, amount_cents, description,
    notes, frequency, start_date, end_date, next_due_date, split_strategy, is_active
) VALUES (
    @household_id, @workspace_id, @category_id, @payment_method_id,
    @paid_by_user_id, @created_by_user_id, @amount_cents, @description,
    @notes, @frequency, @start_date, @end_date, @next_due_date, @split_strategy, true
)
RETURNING *;

-- name: GetRecurringRule :one
SELECT r.*,
       c.name AS category_name,
       pm.name AS payment_method_name,
       pm.kind AS payment_method_kind,
       pm.last4 AS payment_method_last4,
       u.name AS paid_by_name
  FROM recurring_rule r
  JOIN category c ON c.id = r.category_id
  LEFT JOIN payment_method pm ON pm.id = r.payment_method_id
  JOIN app_user u ON u.id = r.paid_by_user_id
 WHERE r.id = @id AND r.household_id = @household_id;

-- name: ListWorkspaceRecurringRules :many
SELECT r.*,
       c.name AS category_name,
       pm.name AS payment_method_name,
       pm.kind AS payment_method_kind,
       pm.last4 AS payment_method_last4,
       u.name AS paid_by_name
  FROM recurring_rule r
  JOIN category c ON c.id = r.category_id
  LEFT JOIN payment_method pm ON pm.id = r.payment_method_id
  JOIN app_user u ON u.id = r.paid_by_user_id
 WHERE r.household_id = @household_id
   AND r.workspace_id = @workspace_id
 ORDER BY r.is_active DESC, r.next_due_date ASC, r.created_at DESC;

-- name: LockDueRecurringRules :many
SELECT * FROM recurring_rule
 WHERE household_id = @household_id
   AND workspace_id = @workspace_id
   AND is_active = true
   AND next_due_date <= @up_to_date::date
 ORDER BY next_due_date ASC
   FOR UPDATE;

-- name: AdvanceRecurringRuleDueDate :exec
UPDATE recurring_rule
   SET next_due_date = @next_due_date,
       is_active = @is_active,
       updated_at = now()
 WHERE id = @id AND household_id = @household_id;

-- name: UpdateRecurringRule :one
UPDATE recurring_rule
   SET category_id = @category_id,
       payment_method_id = @payment_method_id,
       paid_by_user_id = @paid_by_user_id,
       amount_cents = @amount_cents,
       description = @description,
       notes = @notes,
       frequency = @frequency,
       end_date = @end_date,
       next_due_date = @next_due_date,
       split_strategy = @split_strategy,
       is_active = @is_active,
       updated_at = now()
 WHERE id = @id AND household_id = @household_id
RETURNING *;

-- name: DeleteRecurringRule :execrows
DELETE FROM recurring_rule WHERE id = @id AND household_id = @household_id;

-- name: DeleteRecurringRuleSplits :exec
DELETE FROM recurring_rule_split WHERE recurring_rule_id = @recurring_rule_id;

-- name: InsertRecurringRuleSplit :exec
INSERT INTO recurring_rule_split (recurring_rule_id, user_id, weight_bps, share_cents)
VALUES (@recurring_rule_id, @user_id, @weight_bps, @share_cents);

-- name: ListRecurringRuleSplits :many
SELECT s.recurring_rule_id, s.user_id, u.name AS user_name, s.weight_bps, s.share_cents
  FROM recurring_rule_split s
  JOIN app_user u ON u.id = s.user_id
 WHERE s.recurring_rule_id = @recurring_rule_id
 ORDER BY u.name, s.user_id;

-- name: ListWorkspaceRecurringRuleSplits :many
SELECT s.recurring_rule_id, s.user_id, u.name AS user_name, s.weight_bps, s.share_cents
  FROM recurring_rule_split s
  JOIN recurring_rule r ON r.id = s.recurring_rule_id
  JOIN app_user u ON u.id = s.user_id
 WHERE r.household_id = @household_id
   AND r.workspace_id = @workspace_id
 ORDER BY u.name, s.user_id;

-- name: ListAllActiveViewers :many
SELECT id AS user_id, household_id
  FROM app_user
 WHERE status = 'active'
 ORDER BY created_at;
