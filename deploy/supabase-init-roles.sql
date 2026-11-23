-- ============================================================================
-- Finanças Família — Script de Inicialização para Supabase Free (ADR 0004 / 0012)
-- ============================================================================
-- Execute este script UMA ÚNICA VEZ no "SQL Editor" do painel do Supabase antes
-- de rodar as migrations (`admin migrate up`).
--
-- SUBSTITUA as senhas 'TROQUE_POR_SENHA_FORTE_OWNER' e 'TROQUE_POR_SENHA_FORTE_RW'
-- por senhas aleatórias longas (ex.: geradas com `openssl rand -hex 24`).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
        CREATE ROLE app_owner LOGIN PASSWORD 'TROQUE_POR_SENHA_FORTE_OWNER'
            NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
        CREATE ROLE app_rw LOGIN PASSWORD 'TROQUE_POR_SENHA_FORTE_RW'
            NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    END IF;
END
$$;

GRANT CONNECT ON DATABASE postgres TO app_owner, app_rw;
GRANT USAGE, CREATE ON SCHEMA public TO app_owner;
GRANT USAGE ON SCHEMA public TO app_rw;
