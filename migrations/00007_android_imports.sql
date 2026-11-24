-- Etapa 8: tokens de dispositivo Android (device_token) e fila privada de revisão
-- de notificações bancárias (bank_import_inbox com FORCE ROW LEVEL SECURITY).

-- +goose Up

CREATE TABLE device_token (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id uuid        NOT NULL REFERENCES household (id) ON DELETE CASCADE,
    user_id      uuid        NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    device_name  text        NOT NULL CHECK (char_length(device_name) BETWEEN 1 AND 80),
    token_hash   bytea       NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    last_used_at timestamptz,
    revoked_at   timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX device_token_user_idx ON device_token (user_id, created_at DESC);

CREATE TABLE bank_import_inbox (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id        uuid        NOT NULL REFERENCES household (id) ON DELETE CASCADE,
    owner_user_id       uuid        NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    device_token_id     uuid        REFERENCES device_token (id) ON DELETE SET NULL,
    bank_code           text        NOT NULL CHECK (bank_code IN (
                            'nubank', 'itau', 'bradesco', 'bb', 'inter', 'santander', 'c6', 'generic'
                        )),
    parse_status        text        NOT NULL CHECK (parse_status IN ('parsed', 'needs_review')),
    parsed_amount_cents bigint      CHECK (parsed_amount_cents IS NULL OR parsed_amount_cents > 0),
    merchant_or_title   text        NOT NULL CHECK (char_length(merchant_or_title) BETWEEN 1 AND 160),
    card_last4          text        CHECK (card_last4 IS NULL OR card_last4 ~ '^[0-9]{4}$'),
    payment_kind        text        NOT NULL CHECK (payment_kind IN ('pix', 'credit_card', 'debit', 'transfer', 'other')),
    parsed_installments integer     NOT NULL DEFAULT 1 CHECK (parsed_installments BETWEEN 1 AND 48),
    occurred_on         date        NOT NULL,
    dedup_hash          text        NOT NULL CHECK (char_length(dedup_hash) BETWEEN 8 AND 128),
    status              text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'discarded')),
    approved_expense_id uuid        REFERENCES expense (id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (owner_user_id, dedup_hash)
);
CREATE INDEX bank_import_inbox_owner_status_idx
    ON bank_import_inbox (owner_user_id, status, occurred_on DESC, created_at DESC);

-- RLS estrito em bank_import_inbox: apenas o dono do celular (owner_user_id = app_current_user_id()).
ALTER TABLE bank_import_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_import_inbox FORCE ROW LEVEL SECURITY;

CREATE POLICY bank_import_inbox_owner_only ON bank_import_inbox
    FOR ALL TO app_rw
    USING (
        household_id = app_current_household_id()
        AND owner_user_id = app_current_user_id()
    )
    WITH CHECK (
        household_id = app_current_household_id()
        AND owner_user_id = app_current_user_id()
    );

CREATE POLICY bank_import_inbox_admin_all ON bank_import_inbox
    FOR ALL TO app_owner
    USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON device_token TO app_rw;
GRANT SELECT, INSERT, UPDATE ON bank_import_inbox TO app_rw;

-- +goose Down
DROP TABLE IF EXISTS bank_import_inbox;
DROP TABLE IF EXISTS device_token;
