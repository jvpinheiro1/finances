-- Módulo workspace: ambientes coletivo e individual.
-- As consultas da API rodam dentro de uma transação com app.user_id definido (RLS).

-- name: ListAccessibleWorkspaces :many
SELECT * FROM workspace
 WHERE household_id = @household_id
   AND (kind = 'household' OR owner_user_id = @user_id::uuid)
 ORDER BY kind, created_at;

-- name: GetWorkspace :one
SELECT * FROM workspace WHERE id = @id;

-- name: GetHouseholdWorkspace :one
SELECT * FROM workspace WHERE household_id = @household_id AND kind = 'household';

-- Usadas só pelo CLI admin (papel app_owner).

-- name: CreateHouseholdWorkspace :one
INSERT INTO workspace (household_id, kind) VALUES (@household_id, 'household') RETURNING *;

-- name: CreatePersonalWorkspace :one
INSERT INTO workspace (household_id, kind, owner_user_id)
VALUES (@household_id, 'personal', @owner_user_id::uuid)
RETURNING *;
