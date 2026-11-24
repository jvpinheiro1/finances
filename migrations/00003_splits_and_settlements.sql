-- Etapa 3: divisões de despesas coletivas (expense_split) e reembolsos (settlement).
-- Executada com o papel app_owner. A API usa app_rw com FORCE ROW LEVEL SECURITY.

-- +goose Up

ALTER TABLE expense
    ADD COLUMN split_strategy text NOT NULL DEFAULT 'equal'
        CHECK (split_strategy IN ('equal', 'exact', 'percentage', 'shares'));

CREATE TABLE expense_split (
    expense_id  uuid    NOT NULL REFERENCES expense (id) ON DELETE CASCADE,
    user_id     uuid    NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT,
    weight_bps  integer CHECK (weight_bps IS NULL OR weight_bps > 0),
    share_cents bigint  NOT NULL CHECK (share_cents >= 0),
    PRIMARY KEY (expense_id, user_id)
);
CREATE INDEX expense_split_user_idx ON expense_split (user_id);

CREATE TABLE settlement (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id       uuid        NOT NULL REFERENCES household (id) ON DELETE CASCADE,
    from_user_id       uuid        NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT,
    to_user_id         uuid        NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT,
    amount_cents       bigint      NOT NULL CHECK (amount_cents > 0),
    status             text        NOT NULL CHECK (status IN ('pending', 'confirmed', 'rejected')),
    paid_on            date        NOT NULL,
    notes              text        NOT NULL DEFAULT '' CHECK (char_length(notes) <= 500),
    created_by_user_id uuid        NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT,
    decided_by_user_id uuid        REFERENCES app_user (id) ON DELETE RESTRICT,
    decided_at         timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT settlement_distinct_users CHECK (from_user_id <> to_user_id)
);
CREATE INDEX settlement_household_status_idx ON settlement (household_id, status, paid_on DESC);

-- Verifica se o usuário atual pode acessar a despesa pai do split.
-- +goose StatementBegin
CREATE FUNCTION app_can_access_expense(exp_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM expense e
         WHERE e.id = exp_id
           AND e.household_id = app_current_household_id()
           AND app_can_access_workspace(e.workspace_id)
    )
$$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION app_can_access_expense(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_can_access_expense(uuid) TO app_rw;

-- RLS em expense_split
ALTER TABLE expense_split ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_split FORCE ROW LEVEL SECURITY;

CREATE POLICY expense_split_member_all ON expense_split
    FOR ALL TO app_rw
    USING (app_can_access_expense(expense_id))
    WITH CHECK (app_can_access_expense(expense_id));

CREATE POLICY expense_split_owner_all ON expense_split
    FOR ALL TO app_owner
    USING (true) WITH CHECK (true);

-- RLS em settlement
ALTER TABLE settlement ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlement FORCE ROW LEVEL SECURITY;

CREATE POLICY settlement_member_all ON settlement
    FOR ALL TO app_rw
    USING (household_id = app_current_household_id())
    WITH CHECK (household_id = app_current_household_id());

CREATE POLICY settlement_owner_all ON settlement
    FOR ALL TO app_owner
    USING (true) WITH CHECK (true);

-- Privilégios da API (app_rw)
GRANT SELECT, INSERT, UPDATE, DELETE ON expense_split TO app_rw;
GRANT SELECT, INSERT, UPDATE ON settlement TO app_rw;

-- +goose Down
DROP TABLE IF EXISTS settlement;
DROP TABLE IF EXISTS expense_split;
DROP FUNCTION IF EXISTS app_can_access_expense(uuid);
ALTER TABLE expense DROP COLUMN IF EXISTS split_strategy;
