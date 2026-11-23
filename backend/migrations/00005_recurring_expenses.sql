-- Etapa 5: despesas recorrentes e assinaturas (recurring_rule e recurring_rule_split).
-- Executada com o papel app_owner. A API usa app_rw com FORCE ROW LEVEL SECURITY.

-- +goose Up

CREATE TABLE recurring_rule (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id       uuid        NOT NULL REFERENCES household (id) ON DELETE CASCADE,
    workspace_id       uuid        NOT NULL REFERENCES workspace (id) ON DELETE RESTRICT,
    category_id        uuid        NOT NULL REFERENCES category (id) ON DELETE RESTRICT,
    payment_method_id  uuid        REFERENCES payment_method (id) ON DELETE RESTRICT,
    paid_by_user_id    uuid        NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT,
    created_by_user_id uuid        NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT,
    amount_cents       bigint      NOT NULL CHECK (amount_cents > 0),
    description        text        NOT NULL CHECK (char_length(description) BETWEEN 1 AND 160),
    notes              text        NOT NULL DEFAULT '' CHECK (char_length(notes) <= 500),
    frequency          text        NOT NULL CHECK (frequency IN ('monthly', 'weekly', 'yearly')),
    start_date         date        NOT NULL,
    end_date           date        CHECK (end_date IS NULL OR end_date >= start_date),
    next_due_date      date        NOT NULL,
    split_strategy     text        NOT NULL DEFAULT 'equal' CHECK (split_strategy IN ('equal', 'exact', 'percentage', 'shares')),
    is_active          boolean     NOT NULL DEFAULT true,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recurring_rule_workspace_idx ON recurring_rule (workspace_id, is_active, next_due_date);

CREATE TABLE recurring_rule_split (
    recurring_rule_id uuid    NOT NULL REFERENCES recurring_rule (id) ON DELETE CASCADE,
    user_id           uuid    NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT,
    weight_bps        integer CHECK (weight_bps IS NULL OR weight_bps > 0),
    share_cents       bigint  NOT NULL CHECK (share_cents >= 0),
    PRIMARY KEY (recurring_rule_id, user_id)
);

ALTER TABLE expense
    ADD COLUMN recurring_rule_id uuid REFERENCES recurring_rule (id) ON DELETE SET NULL,
    ADD COLUMN recurring_period  text CHECK (recurring_period IS NULL OR char_length(recurring_period) BETWEEN 4 AND 16);

CREATE UNIQUE INDEX expense_recurring_period_uq
    ON expense (recurring_rule_id, recurring_period)
 WHERE recurring_rule_id IS NOT NULL;

-- Verifica se o usuário atual pode acessar a regra de recorrência pai.
-- +goose StatementBegin
CREATE FUNCTION app_can_access_recurring_rule(rule_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM recurring_rule r
         WHERE r.id = rule_id
           AND r.household_id = app_current_household_id()
           AND app_can_access_workspace(r.workspace_id)
    )
$$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION app_can_access_recurring_rule(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_can_access_recurring_rule(uuid) TO app_rw;

-- RLS em recurring_rule
ALTER TABLE recurring_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_rule FORCE ROW LEVEL SECURITY;

CREATE POLICY recurring_rule_member_all ON recurring_rule
    FOR ALL TO app_rw
    USING (
        household_id = app_current_household_id()
        AND app_can_access_workspace(workspace_id)
    )
    WITH CHECK (
        household_id = app_current_household_id()
        AND app_can_access_workspace(workspace_id)
    );

CREATE POLICY recurring_rule_owner_all ON recurring_rule
    FOR ALL TO app_owner
    USING (true) WITH CHECK (true);

-- RLS em recurring_rule_split
ALTER TABLE recurring_rule_split ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_rule_split FORCE ROW LEVEL SECURITY;

CREATE POLICY recurring_rule_split_member_all ON recurring_rule_split
    FOR ALL TO app_rw
    USING (app_can_access_recurring_rule(recurring_rule_id))
    WITH CHECK (app_can_access_recurring_rule(recurring_rule_id));

CREATE POLICY recurring_rule_split_owner_all ON recurring_rule_split
    FOR ALL TO app_owner
    USING (true) WITH CHECK (true);

-- Privilégios da API (app_rw)
GRANT SELECT, INSERT, UPDATE, DELETE ON recurring_rule TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON recurring_rule_split TO app_rw;

-- +goose Down
DROP INDEX IF EXISTS expense_recurring_period_uq;
ALTER TABLE expense
    DROP COLUMN IF EXISTS recurring_period,
    DROP COLUMN IF EXISTS recurring_rule_id;
DROP TABLE IF EXISTS recurring_rule_split;
DROP FUNCTION IF EXISTS app_can_access_recurring_rule(uuid);
DROP TABLE IF EXISTS recurring_rule;
