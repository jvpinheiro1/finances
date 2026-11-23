-- Módulo notification: caixa de entrada de notificações por familiar (RLS por recipient_user_id).

-- name: InsertNotification :exec
INSERT INTO notification (
    household_id, recipient_user_id, kind, title, body, entity_type, entity_id
) VALUES (
    @household_id, @recipient_user_id, @kind, @title, @body, @entity_type, @entity_id
);

-- name: InsertDedupNotification :exec
INSERT INTO notification (
    household_id, recipient_user_id, kind, title, body, entity_type, entity_id, dedup_key
) VALUES (
    @household_id, @recipient_user_id, @kind, @title, @body, @entity_type, @entity_id, @dedup_key
)
ON CONFLICT (recipient_user_id, dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING;

-- name: ListMyNotifications :many
SELECT * FROM notification
 WHERE household_id = @household_id
   AND recipient_user_id = @recipient_user_id
   AND (@unread_only::bool = false OR is_read = false)
 ORDER BY is_read ASC, created_at DESC
 LIMIT 100;

-- name: CountMyUnreadNotifications :one
SELECT count(*) FROM notification
 WHERE household_id = @household_id
   AND recipient_user_id = @recipient_user_id
   AND is_read = false;

-- name: MarkNotificationRead :one
UPDATE notification
   SET is_read = true,
       read_at = COALESCE(read_at, now())
 WHERE id = @id
   AND household_id = @household_id
   AND recipient_user_id = @recipient_user_id
RETURNING *;

-- name: MarkAllNotificationsRead :execrows
UPDATE notification
   SET is_read = true,
       read_at = COALESCE(read_at, now())
 WHERE household_id = @household_id
   AND recipient_user_id = @recipient_user_id
   AND is_read = false;
