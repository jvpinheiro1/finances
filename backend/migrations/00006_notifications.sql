-- Etapa 6: notificações internas por destinatário com FORCE ROW LEVEL SECURITY.
-- Executada com o papel app_owner. A API usa app_rw.

-- +goose Up

CREATE TABLE notification (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id      uuid        NOT NULL REFERENCES household (id) ON DELETE CASCADE,
    recipient_user_id uuid        NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    kind              text        NOT NULL CHECK (kind IN (
                          'settlement_pending',
                          'settlement_confirmed',
                          'settlement_rejected',
                          'collective_expense_added',
                          'recurring_due_soon'
                      )),
    title             text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 140),
    body              text        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 400),
    entity_type       text,
    entity_id         uuid,
    dedup_key         text        CHECK (dedup_key IS NULL OR char_length(dedup_key) BETWEEN 1 AND 120),
    is_read           boolean     NOT NULL DEFAULT false,
    read_at           timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_recipient_unread_idx
    ON notification (recipient_user_id, is_read, created_at DESC);

CREATE UNIQUE INDEX notification_recipient_dedup_uq
    ON notification (recipient_user_id, dedup_key)
 WHERE dedup_key IS NOT NULL;

-- RLS em notification:
--   SELECT e UPDATE: exclusivamente o próprio destinatário (recipient_user_id = app_current_user_id()).
--   INSERT: qualquer membro ativo da mesma residência (para notificar outros membros em eventos coletivos/reembolsos).
ALTER TABLE notification ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification FORCE ROW LEVEL SECURITY;

CREATE POLICY notification_recipient_select ON notification
    FOR SELECT TO app_rw
    USING (
        household_id = app_current_household_id()
        AND recipient_user_id = app_current_user_id()
    );

CREATE POLICY notification_recipient_update ON notification
    FOR UPDATE TO app_rw
    USING (
        household_id = app_current_household_id()
        AND recipient_user_id = app_current_user_id()
    )
    WITH CHECK (
        household_id = app_current_household_id()
        AND recipient_user_id = app_current_user_id()
    );

CREATE POLICY notification_household_insert ON notification
    FOR INSERT TO app_rw
    WITH CHECK (household_id = app_current_household_id());

CREATE POLICY notification_owner_all ON notification
    FOR ALL TO app_owner
    USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON notification TO app_rw;

-- +goose Down
DROP TABLE IF EXISTS notification;
