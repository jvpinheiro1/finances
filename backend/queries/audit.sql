-- Módulo audit: trilha de auditoria (nunca guardar senha, token ou dado financeiro).

-- name: InsertAuditLog :exec
INSERT INTO audit_log (household_id, actor_id, action, entity_type, entity_id, meta)
VALUES (@household_id, @actor_id, @action, @entity_type, @entity_id, @meta);
