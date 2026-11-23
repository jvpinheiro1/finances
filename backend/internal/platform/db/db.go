// Package db concentra a conexão com o PostgreSQL e o escopo de usuário para RLS.
package db

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Connect abre o pool e confere a conexão.
func Connect(ctx context.Context, url string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		// Não inclui a URL no erro: ela contém a senha.
		return nil, fmt.Errorf("configuração do banco inválida")
	}
	cfg.MaxConns = 10
	cfg.MaxConnIdleTime = 5 * time.Minute
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("abrir pool: %w", err)
	}
	pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("conectar ao banco: %w", err)
	}
	return pool, nil
}

// TxBeginner é satisfeito por *pgxpool.Pool e por pgx.Tx.
type TxBeginner interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

// WithTx executa fn numa transação; faz commit se fn não retornar erro.
func WithTx(ctx context.Context, b TxBeginner, fn func(pgx.Tx) error) (err error) {
	tx, err := b.Begin(ctx)
	if err != nil {
		return fmt.Errorf("iniciar transação: %w", err)
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback(ctx)
		}
	}()
	if err = fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// WithUserTx executa fn numa transação em que app.user_id = userID (escopo da
// transação), ativando as políticas de RLS (ADR 0004).
func WithUserTx(ctx context.Context, b TxBeginner, userID uuid.UUID, fn func(pgx.Tx) error) error {
	return WithTx(ctx, b, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "SELECT set_config('app.user_id', $1, true)", userID.String()); err != nil {
			return fmt.Errorf("definir usuário da transação: %w", err)
		}
		return fn(tx)
	})
}
