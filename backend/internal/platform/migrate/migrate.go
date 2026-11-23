// Package migrate executa as migrations com goose (papel app_owner).
package migrate

import (
	"context"
	"database/sql"
	"fmt"
	"io"

	_ "github.com/jackc/pgx/v5/stdlib" // driver database/sql "pgx"
	"github.com/pressly/goose/v3"

	"financas-familia/backend/migrations"
)

func provider(url string) (*goose.Provider, *sql.DB, error) {
	sqlDB, err := sql.Open("pgx", url)
	if err != nil {
		return nil, nil, fmt.Errorf("abrir conexão para migrations")
	}
	p, err := goose.NewProvider(goose.DialectPostgres, sqlDB, migrations.FS)
	if err != nil {
		sqlDB.Close()
		return nil, nil, fmt.Errorf("criar provider goose: %w", err)
	}
	return p, sqlDB, nil
}

// Up aplica todas as migrations pendentes.
func Up(ctx context.Context, url string, out io.Writer) error {
	p, sqlDB, err := provider(url)
	if err != nil {
		return err
	}
	defer sqlDB.Close()
	res, err := p.Up(ctx)
	for _, r := range res {
		fmt.Fprintf(out, "up   %s (%s)\n", r.Source.Path, r.Duration)
	}
	if err != nil {
		return fmt.Errorf("migrate up: %w", err)
	}
	if len(res) == 0 {
		fmt.Fprintln(out, "nada a aplicar: banco já está atualizado")
	}
	return nil
}

// Down desfaz a última migration aplicada.
func Down(ctx context.Context, url string, out io.Writer) error {
	p, sqlDB, err := provider(url)
	if err != nil {
		return err
	}
	defer sqlDB.Close()
	r, err := p.Down(ctx)
	if r != nil {
		fmt.Fprintf(out, "down %s (%s)\n", r.Source.Path, r.Duration)
	}
	if err != nil {
		return fmt.Errorf("migrate down: %w", err)
	}
	return nil
}

// Status mostra o estado de cada migration.
func Status(ctx context.Context, url string, out io.Writer) error {
	p, sqlDB, err := provider(url)
	if err != nil {
		return err
	}
	defer sqlDB.Close()
	st, err := p.Status(ctx)
	if err != nil {
		return fmt.Errorf("migrate status: %w", err)
	}
	for _, s := range st {
		fmt.Fprintf(out, "%-8s %s\n", s.State, s.Source.Path)
	}
	return nil
}
