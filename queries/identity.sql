-- Módulo identity: usuários e sessões.

-- name: GetUserByEmail :one
SELECT * FROM app_user WHERE email = @email;

-- name: GetUserByID :one
SELECT * FROM app_user WHERE id = @id;

-- name: IncrementFailedLogins :one
UPDATE app_user
   SET failed_logins = failed_logins + 1, updated_at = now()
 WHERE id = @id
RETURNING failed_logins;

-- name: SetLockedUntil :exec
UPDATE app_user SET locked_until = @locked_until, updated_at = now() WHERE id = @id;

-- name: ResetLoginFailures :exec
UPDATE app_user
   SET failed_logins = 0, locked_until = NULL, updated_at = now()
 WHERE id = @id AND (failed_logins <> 0 OR locked_until IS NOT NULL);

-- name: UpdatePassword :exec
UPDATE app_user
   SET password_hash = @password_hash,
       must_change_password = @must_change_password,
       password_changed_at = now(),
       failed_logins = 0,
       locked_until = NULL,
       updated_at = now()
 WHERE id = @id;

-- name: CreateSession :exec
INSERT INTO session (token_hash, user_id, expires_at, last_seen_at)
VALUES (@token_hash, @user_id, @expires_at, @last_seen_at);

-- name: GetSessionWithUser :one
SELECT s.token_hash, s.expires_at, s.last_seen_at,
       u.id AS user_id, u.household_id, u.name, u.email, u.status, u.must_change_password
  FROM session s
  JOIN app_user u ON u.id = s.user_id
 WHERE s.token_hash = @token_hash;

-- name: TouchSession :exec
UPDATE session SET last_seen_at = @last_seen_at WHERE token_hash = @token_hash;

-- name: DeleteSession :exec
DELETE FROM session WHERE token_hash = @token_hash;

-- name: DeleteOtherSessions :exec
DELETE FROM session WHERE user_id = @user_id AND token_hash <> @keep_token_hash;

-- name: DeleteUserSessions :exec
DELETE FROM session WHERE user_id = @user_id;

-- name: DeleteExpiredSessions :execrows
DELETE FROM session WHERE expires_at < @now OR last_seen_at < @idle_before;

-- Usadas só pelo CLI admin (papel app_owner).

-- name: CreateUser :one
INSERT INTO app_user (household_id, name, email, password_hash, must_change_password)
VALUES (@household_id, @name, @email, @password_hash, true)
RETURNING *;

-- name: CountActiveMembers :one
SELECT count(*) FROM app_user WHERE household_id = @household_id AND status = 'active';

-- name: ListUsers :many
SELECT * FROM app_user ORDER BY created_at;
