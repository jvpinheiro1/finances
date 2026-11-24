-- Módulo settlement: cálculo de saldos entre familiares (descontando estornos) e reembolsos.

-- name: ListCollectiveSplitDebts :many
SELECT s.user_id AS debtor_id,
       e.paid_by_user_id AS creditor_id,
       COALESCE(SUM(s.share_cents), 0)::bigint AS total_cents
  FROM expense_split s
  JOIN expense e ON e.id = s.expense_id
  JOIN workspace w ON w.id = e.workspace_id
 WHERE e.household_id = @household_id
   AND w.kind = 'household'
   AND s.user_id <> e.paid_by_user_id
 GROUP BY s.user_id, e.paid_by_user_id;

-- name: ListCollectiveRefundSplitCredits :many
SELECT rs.user_id AS debtor_id,
       e.paid_by_user_id AS creditor_id,
       COALESCE(SUM(rs.share_cents), 0)::bigint AS total_cents
  FROM expense_refund_split rs
  JOIN expense_refund r ON r.id = rs.refund_id
  JOIN expense e ON e.id = r.expense_id
  JOIN workspace w ON w.id = e.workspace_id
 WHERE e.household_id = @household_id
   AND w.kind = 'household'
   AND rs.user_id <> e.paid_by_user_id
 GROUP BY rs.user_id, e.paid_by_user_id;

-- name: ListConfirmedSettlementTotals :many
SELECT from_user_id AS debtor_id,
       to_user_id AS creditor_id,
       COALESCE(SUM(amount_cents), 0)::bigint AS total_cents
  FROM settlement
 WHERE household_id = @household_id
   AND status = 'confirmed'
 GROUP BY from_user_id, to_user_id;

-- name: CreateSettlement :one
INSERT INTO settlement (
    household_id, from_user_id, to_user_id, amount_cents, status,
    paid_on, notes, created_by_user_id, decided_by_user_id, decided_at
) VALUES (
    @household_id, @from_user_id, @to_user_id, @amount_cents, @status,
    @paid_on, @notes, @created_by_user_id, @decided_by_user_id, @decided_at
)
RETURNING *;

-- name: GetSettlement :one
SELECT st.*,
       fu.name AS from_user_name,
       tu.name AS to_user_name
  FROM settlement st
  JOIN app_user fu ON fu.id = st.from_user_id
  JOIN app_user tu ON tu.id = st.to_user_id
 WHERE st.id = @id AND st.household_id = @household_id;

-- name: ListSettlements :many
SELECT st.*,
       fu.name AS from_user_name,
       tu.name AS to_user_name
  FROM settlement st
  JOIN app_user fu ON fu.id = st.from_user_id
  JOIN app_user tu ON tu.id = st.to_user_id
 WHERE st.household_id = @household_id
   AND (@filter_status::bool = false OR st.status = @status)
 ORDER BY (st.status = 'pending') DESC, st.paid_on DESC, st.created_at DESC
 LIMIT 200;

-- name: DecideSettlement :one
UPDATE settlement
   SET status = @status,
       decided_by_user_id = @decided_by_user_id,
       decided_at = now()
 WHERE id = @id
   AND household_id = @household_id
   AND status = 'pending'
RETURNING *;
