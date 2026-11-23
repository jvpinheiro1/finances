-- Etapa 1: residência, usuários, ambientes, sessões e auditoria.
-- Executada com o papel app_owner (dono das tabelas). A API usa app_rw.
-- Pré-requisito: os papéis app_owner e app_rw já existem (deploy/postgres/init).

-- +goose Up
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE household (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
    max_members integer     NOT NULL DEFAULT 4 CHECK (max_members BETWEEN 1 AND 20),
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_user (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id         uuid        NOT NULL REFERENCES household (id),
    name                 text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
    email                citext      NOT NULL UNIQUE CHECK (char_length(email) BETWEEN 3 AND 254),
    password_hash        text        NOT NULL,
    status               text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    must_change_password boolean     NOT NULL DEFAULT true,
    failed_logins        integer     NOT NULL DEFAULT 0 CHECK (failed_logins >= 0),
    locked_until         timestamptz,
    password_changed_at  timestamptz NOT NULL DEFAULT now(),
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX app_user_household_idx ON app_user (household_id);

CREATE TABLE workspace (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id  uuid        NOT NULL REFERENCES household (id),
    kind          text        NOT NULL CHECK (kind IN ('household', 'personal')),
    owner_user_id uuid        REFERENCES app_user (id),
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT workspace_owner_matches_kind CHECK ((kind = 'personal') = (owner_user_id IS NOT NULL))
);
CREATE UNIQUE INDEX workspace_one_household_uq ON workspace (household_id) WHERE kind = 'household';
CREATE UNIQUE INDEX workspace_one_personal_uq ON workspace (owner_user_id) WHERE kind = 'personal';

CREATE TABLE session (
    token_hash   bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
    user_id      uuid        NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    created_at   timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX session_user_idx ON session (user_id);
CREATE INDEX session_expires_idx ON session (expires_at);

CREATE TABLE audit_log (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    household_id uuid REFERENCES household (id),
    actor_id     uuid REFERENCES app_user (id),
    action       text        NOT NULL CHECK (char_length(action) BETWEEN 1 AND 100),
    entity_type  text,
    entity_id    uuid,
    meta         jsonb       NOT NULL DEFAULT '{}'::jsonb,
    at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_household_at_idx ON audit_log (household_id, at DESC);

-- Usuário autenticado da transação atual (definido pela API com set_config(..., true)).
-- +goose StatementBegin
CREATE FUNCTION app_current_user_id() RETURNS uuid
    LANGUAGE sql STABLE
AS $$
    SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;
-- +goose StatementEnd

-- Residência do usuário autenticado (só se ativo). SECURITY DEFINER para não depender
-- de RLS futura em app_user; search_path fixo por segurança.
-- +goose StatementBegin
CREATE FUNCTION app_current_household_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = public, pg_temp
AS $$
    SELECT household_id FROM app_user
     WHERE id = app_current_user_id() AND status = 'active'
$$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION app_current_household_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_current_user_id() TO app_rw;
GRANT EXECUTE ON FUNCTION app_current_household_id() TO app_rw;

-- RLS: base da privacidade dos ambientes (ADR 0004).
ALTER TABLE workspace ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace FORCE ROW LEVEL SECURITY;

CREATE POLICY workspace_member_select ON workspace
    FOR SELECT TO app_rw
    USING (
        household_id = app_current_household_id()
        AND (
            kind = 'household'
            OR (kind = 'personal' AND owner_user_id = app_current_user_id())
        )
    );

-- O dono (migrations e CLI admin) administra ambientes sem restrição.
CREATE POLICY workspace_owner_all ON workspace
    FOR ALL TO app_owner
    USING (true) WITH CHECK (true);

-- Privilégios mínimos da API.
GRANT USAGE ON SCHEMA public TO app_rw;
GRANT SELECT ON household TO app_rw;
GRANT SELECT ON app_user TO app_rw;
GRANT UPDATE (password_hash, must_change_password, failed_logins, locked_until,
              password_changed_at, updated_at) ON app_user TO app_rw;
GRANT SELECT ON workspace TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON session TO app_rw;
GRANT INSERT ON audit_log TO app_rw;

-- +goose Down
DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS session;
DROP TABLE IF EXISTS workspace;
DROP FUNCTION IF EXISTS app_current_household_id();
DROP FUNCTION IF EXISTS app_current_user_id();
DROP TABLE IF EXISTS app_user;
DROP TABLE IF EXISTS household;
