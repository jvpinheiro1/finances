-- Etapa 4: parcelamentos (installment_plan) e estornos (expense_refund / expense_refund_split).
-- Executada com o papel app_owner. A API usa app_rw com FORCE ROW LEVEL SECURITY.

-- +goose Up

ALTER TABLE payment_method
    ADD COLUMN closing_day integer CHECK (closing_day IS NULL OR closing_day BETWEEN 1 AND 31),
    ADD COLUMN due_day     integer CHECK (due_day IS NULL OR due_day BETWEEN 1 AND 31),
    ADD CONSTRAINT payment_method_billing_days_card_only
        CHECK ((closing_day IS NULL AND due_day IS NULL) OR kind = 'credit_card');

CREATE TABLE installment_plan (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id       uuid        NOT NULL REFERENCES household (id) ON DELETE CASCADE,
    workspace_id       uuid        NOT NULL REFERENCES workspace (id) ON DELETE RESTRICT,
    category_id        uuid        NOT NULL REFERENCES category (id) ON DELETE RESTRICT,
    payment_method_id  uuid        REFERENCES payment_method (id) ON DELETE RESTRICT,
    paid_by_user_id    uuid        NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT,
    created_by_user_id uuid        NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT,
    total_amount_cents bigint      NOT NULL CHECK (total_amount_cents > 0),
    total_installments integer     NOT NULL CHECK (total_installments BETWEEN 2 AND 48),
    description        text        NOT NULL CHECK (char_length(description) BETWEEN 1 AND 160),
    first_incurred_on  date        NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX installment_plan_workspace_idx ON installment_plan (workspace_id);

ALTER TABLE expense
    ADD COLUMN installment_plan_id uuid    REFERENCES installment_plan (id) ON DELETE CASCADE,
    ADD COLUMN installment_number  integer CHECK (installment_number IS NULL OR installment_number BETWEEN 1 AND 48),
    ADD COLUMN total_installments  integer CHECK (total_installments IS NULL OR total_installments BETWEEN 1 AND 48),
    ADD COLUMN refunded_cents      bigint  NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0 AND refunded_cents <= amount_cents);
CREATE INDEX expense_installment_plan_idx ON expense (installment_plan_id);

CREATE TABLE expense_refund (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    expense_id         uuid        NOT NULL REFERENCES expense (id) ON DELETE CASCADE,
    household_id       uuid        NOT NULL REFERENCES household (id) ON DELETE CASCADE,
    amount_cents       bigint      NOT NULL CHECK (amount_cents > 0),
    refunded_on        date        NOT NULL,
    reason             text        NOT NULL DEFAULT '' CHECK (char_length(reason) <= 300),
    created_by_user_id uuid        NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT,
    created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX expense_refund_expense_idx ON expense_refund (expense_id, refunded_on DESC);

CREATE TABLE expense_refund_split (
    refund_id   uuid   NOT NULL REFERENCES expense_refund (id) ON DELETE CASCADE,
    user_id     uuid   NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT,
    share_cents bigint NOT NULL CHECK (share_cents >= 0),
    PRIMARY KEY (refund_id, user_id)
);
CREATE INDEX expense_refund_split_user_idx ON expense_refund_split (user_id);

-- Verifica se o usuário atual pode acessar o estorno pai.
-- +goose StatementBegin
CREATE FUNCTION app_can_access_refund(ref_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM expense_refund r
         WHERE r.id = ref_id
           AND r.household_id = app_current_household_id()
           AND app_can_access_expense(r.expense_id)
    )
$$;
-- +goose StatementEnd
REVOKE ALL ON FUNCTION app_can_access_refund(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_can_access_refund(uuid) TO app_rw;

-- RLS em installment_plan
ALTER TABLE installment_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE installment_plan FORCE ROW LEVEL SECURITY;

CREATE POLICY installment_plan_member_all ON installment_plan
    FOR ALL TO app_rw
    USING (
        household_id = app_current_household_id()
        AND app_can_access_workspace(workspace_id)
    )
    WITH CHECK (
        household_id = app_current_household_id()
        AND app_can_access_workspace(workspace_id)
    );

CREATE POLICY installment_plan_owner_all ON installment_plan
    FOR ALL TO app_owner
    USING (true) WITH CHECK (true);

-- RLS em expense_refund
ALTER TABLE expense_refund ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_refund FORCE ROW LEVEL SECURITY;

CREATE POLICY expense_refund_member_all ON expense_refund
    FOR ALL TO app_rw
    USING (
        household_id = app_current_household_id()
        AND app_can_access_expense(expense_id)
    )
    WITH CHECK (
        household_id = app_current_household_id()
        AND app_can_access_expense(expense_id)
    );

CREATE POLICY expense_refund_owner_all ON expense_refund
    FOR ALL TO app_owner
    USING (true) WITH CHECK (true);

-- RLS em expense_refund_split
ALTER TABLE expense_refund_split ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_refund_split FORCE ROW LEVEL SECURITY;

CREATE POLICY expense_refund_split_member_all ON expense_refund_split
    FOR ALL TO app_rw
    USING (app_can_access_refund(refund_id))
    WITH CHECK (app_can_access_refund(refund_id));

CREATE POLICY expense_refund_split_owner_all ON expense_refund_split
    FOR ALL TO app_owner
    USING (true) WITH CHECK (true);

-- Privilégios da API (app_rw)
GRANT SELECT, INSERT, DELETE ON installment_plan TO app_rw;
GRANT SELECT, INSERT ON expense_refund TO app_rw;
GRANT SELECT, INSERT ON expense_refund_split TO app_rw;

-- +goose Down
DROP TABLE IF EXISTS expense_refund_split;
DROP FUNCTION IF EXISTS app_can_access_refund(uuid);
DROP TABLE IF EXISTS expense_refund;
ALTER TABLE expense
    DROP COLUMN IF EXISTS refunded_cents,
    DROP COLUMN IF EXISTS total_installments,
    DROP COLUMN IF EXISTS installment_number,
    DROP COLUMN IF EXISTS installment_plan_id;
DROP TABLE IF EXISTS installment_plan;
ALTER TABLE payment_method
    DROP CONSTRAINT IF EXISTS payment_method_billing_days_card_only,
    DROP COLUMN IF EXISTS due_day,
    DROP COLUMN IF EXISTS closing_day;
