-- Módulo household: residência e membros.

-- name: GetHousehold :one
SELECT * FROM household WHERE id = @id;

-- name: ListActiveMembers :many
SELECT id, name FROM app_user
 WHERE household_id = @household_id AND status = 'active'
 ORDER BY name, id;

-- Usadas só pelo CLI admin (papel app_owner).

-- name: CreateHousehold :one
INSERT INTO household (name, max_members) VALUES (@name, @max_members) RETURNING *;

-- name: GetOnlyHousehold :one
SELECT * FROM household ORDER BY created_at LIMIT 1;

-- name: CountHouseholds :one
SELECT count(*) FROM household;
