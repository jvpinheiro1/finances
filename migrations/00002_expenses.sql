-- Etapa 2: categorias, meios de pagamento e despesas (individuais e coletivas).
-- Executada com o papel app_owner. A API usa app_rw com FORCE ROW LEVEL SECURITY.

-- +goose Up

CREATE TABLE category (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id uuid        NOT NULL REFERENCES household (id) ON DELETE CASCADE,
    name         citext      NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
    is_archived  boolean     NOT NULL DEFAULT false,
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (household_id, name)
);
CREATE INDEX category_household_idx ON category (household_id);

CREATE TABLE payment_method (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id  uuid        NOT NULL REFERENCES household (id) ON DELETE CASCADE,
    owner_user_id uuid        REFERENCES app_user (id) ON DELETE CASCADE,
    name          text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
    kind          text        NOT NULL CHECK (kind IN ('pix', 'debit', 'credit_card', 'cash', 'transfer', 'other')),
    last4         text        CHECK (last4 IS NULL OR last4 ~ '^[0-9]{4}$'),
    is_archived   boolean     NOT NULL DEFAULT false,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT payment_method_last4_card_only CHECK (last4 IS NULL OR kind IN ('credit_card', 'debit'))
);
CREATE INDEX payment_method_household_idx ON payment_method (household_id);

CREATE TABLE expense (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id       uuid        NOT NULL REFERENCES household (id) ON DELETE CASCADE,
    workspace_id       uuid        NOT NULL REFERENCES workspace (id) ON DELETE RESTRICT,
    category_id        uuid        NOT NULL REFERENCES category (id) ON DELETE RESTRICT,
    payment_method_id  uuid        REFERENCES payment_method (id) ON DELETE RESTRICT,
    paid_by_user_id    uuid        NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT,
    created_by_user_id uuid        NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT,
    amount_cents       bigint      NOT NULL CHECK (amount_cents > 0),
    description        text        NOT NULL CHECK (char_length(description) BETWEEN 1 AND 160),
    incurred_on        date        NOT NULL,
    notes              text        NOT NULL DEFAULT '' CHECK (char_length(notes) <= 500),
    shared_at          timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX expense_workspace_date_idx ON expense (workspace_id, incurred_on DESC, created_at DESC);
CREATE INDEX expense_category_idx ON expense (category_id);

-- Verifica no banco se o usuário da transação pode acessar o workspace informado.
-- +goose StatementBegin
CREATE FUNCTION app_can_access_workspace(ws_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM workspace w
         WHERE w.id = ws_id
           AND w.household_id = app_current_household_id()
           AND (
               w.kind = 'household'
               OR (w.kind = 'personal' AND w.owner_user_id = app_current_user_id())
           )
    )
$$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION app_can_access_workspace(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_can_access_workspace(uuid) TO app_rw;

-- RLS em category
ALTER TABLE category ENABLE ROW LEVEL SECURITY;
ALTER TABLE category FORCE ROW LEVEL SECURITY;

CREATE POLICY category_member_all ON category
    FOR ALL TO app_rw
    USING (household_id = app_current_household_id())
    WITH CHECK (household_id = app_current_household_id());

CREATE POLICY category_owner_all ON category
    FOR ALL TO app_owner
    USING (true) WITH CHECK (true);

-- RLS em payment_method: visível se for coletivo (owner_user_id IS NULL) ou do próprio usuário.
ALTER TABLE payment_method ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_method FORCE ROW LEVEL SECURITY;

CREATE POLICY payment_method_member_all ON payment_method
    FOR ALL TO app_rw
    USING (
        household_id = app_current_household_id()
        AND (owner_user_id IS NULL OR owner_user_id = app_current_user_id())
    )
    WITH CHECK (
        household_id = app_current_household_id()
        AND (owner_user_id IS NULL OR owner_user_id = app_current_user_id())
    );

CREATE POLICY payment_method_owner_all ON payment_method
    FOR ALL TO app_owner
    USING (true) WITH CHECK (true);

-- RLS em expense: exige acesso ao workspace_id (tanto para ler quanto para gravar/mover).
ALTER TABLE expense ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense FORCE ROW LEVEL SECURITY;

CREATE POLICY expense_member_all ON expense
    FOR ALL TO app_rw
    USING (
        household_id = app_current_household_id()
        AND app_can_access_workspace(workspace_id)
    )
    WITH CHECK (
        household_id = app_current_household_id()
        AND app_can_access_workspace(workspace_id)
    );

CREATE POLICY expense_owner_all ON expense
    FOR ALL TO app_owner
    USING (true) WITH CHECK (true);

-- Privilégios da API (app_rw).
GRANT SELECT, INSERT, UPDATE ON category TO app_rw;
GRANT SELECT, INSERT, UPDATE ON payment_method TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON expense TO app_rw;

-- Seed das 8 categorias padrão (E2-D2) para qualquer residência já existente.
INSERT INTO category (household_id, name)
SELECT h.id, c.name
  FROM household h
 CROSS JOIN (
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

-- +goose Down
DROP TABLE IF EXISTS expense;
DROP FUNCTION IF EXISTS app_can_access_workspace(uuid);
DROP TABLE IF EXISTS payment_method;
DROP TABLE IF EXISTS category;
