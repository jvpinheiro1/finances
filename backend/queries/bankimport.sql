-- Módulo bankimport: tokens de dispositivo Android e fila privada de revisão de notificações bancárias.

-- === Dispositivos (device_token) ===

-- name: CreateDeviceToken :one
INSERT INTO device_token (household_id, user_id, device_name, token_hash)
VALUES (@household_id, @user_id, @device_name, @token_hash)
RETURNING *;

-- name: ListMyDevices :many
SELECT * FROM device_token
 WHERE household_id = @household_id
   AND user_id = @user_id
 ORDER BY (revoked_at IS NULL) DESC, created_at DESC;

-- name: RevokeMyDevice :one
UPDATE device_token
   SET revoked_at = COALESCE(revoked_at, now())
 WHERE id = @id
   AND household_id = @household_id
   AND user_id = @user_id
RETURNING *;

-- name: GetActiveDeviceByTokenHash :one
SELECT dt.id AS device_id,
       dt.household_id,
       dt.user_id,
       dt.device_name,
       dt.token_hash,
       u.status AS user_status
  FROM device_token dt
  JOIN app_user u ON u.id = dt.user_id
 WHERE dt.token_hash = @token_hash
   AND dt.revoked_at IS NULL;

-- name: TouchDeviceToken :exec
UPDATE device_token SET last_used_at = now() WHERE id = @id;

-- === Fila privada de importação (bank_import_inbox, protegida por RLS) ===

-- name: UpsertBankImportItem :one
INSERT INTO bank_import_inbox (
    household_id, owner_user_id, device_token_id, bank_code,
    parse_status, parsed_amount_cents, merchant_or_title,
    card_last4, payment_kind, parsed_installments, occurred_on, dedup_hash
) VALUES (
    @household_id, @owner_user_id, @device_token_id, @bank_code,
    @parse_status, @parsed_amount_cents, @merchant_or_title,
    @card_last4, @payment_kind, @parsed_installments, @occurred_on, @dedup_hash
)
ON CONFLICT (owner_user_id, dedup_hash) DO UPDATE
   SET device_token_id = COALESCE(EXCLUDED.device_token_id, bank_import_inbox.device_token_id)
RETURNING *;

-- name: ListMyBankImports :many
SELECT * FROM bank_import_inbox
 WHERE household_id = @household_id
   AND owner_user_id = @owner_user_id
   AND (@filter_status::bool = false OR status = @status)
 ORDER BY (status = 'pending') DESC, occurred_on DESC, created_at DESC
 LIMIT 200;

-- name: GetMyBankImport :one
SELECT * FROM bank_import_inbox
 WHERE id = @id
   AND household_id = @household_id
   AND owner_user_id = @owner_user_id;

-- name: MarkBankImportApproved :one
UPDATE bank_import_inbox
   SET status = 'approved',
       approved_expense_id = @approved_expense_id
 WHERE id = @id
   AND household_id = @household_id
   AND owner_user_id = @owner_user_id
   AND status = 'pending'
RETURNING *;

-- name: MarkBankImportDiscarded :one
UPDATE bank_import_inbox
   SET status = 'discarded'
 WHERE id = @id
   AND household_id = @household_id
   AND owner_user_id = @owner_user_id
   AND status = 'pending'
RETURNING *;
