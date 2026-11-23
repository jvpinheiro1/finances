// Package admin orquestra operações administrativas que envolvem vários
// módulos numa única transação (usadas pelo CLI cmd/admin com o papel app_owner).
package admin

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"financas-familia/backend/internal/audit"
	"financas-familia/backend/internal/expense"
	"financas-familia/backend/internal/household"
	"financas-familia/backend/internal/identity"
	"financas-familia/backend/internal/platform/db"
	"financas-familia/backend/internal/workspace"
)

// ErrMemberLimit indica que a residência já tem o máximo de membros ativos.
var ErrMemberLimit = errors.New("limite de membros ativos da residência atingido")

var cliMeta = map[string]any{"via": "cli"}

// Bootstrap cria a residência, o ambiente coletivo e as 8 categorias iniciais (E2-D2).
func Bootstrap(ctx context.Context, b db.TxBeginner, name string, maxMembers int) (household.Info, error) {
	var info household.Info
	err := db.WithTx(ctx, b, func(tx pgx.Tx) error {
		var err error
		if info, err = household.Create(ctx, tx, name, maxMembers); err != nil {
			return err
		}
		if _, err = workspace.CreateHousehold(ctx, tx, info.ID); err != nil {
			return err
		}
		if err = expense.SeedDefaultCategories(ctx, tx, info.ID); err != nil {
			return fmt.Errorf("criar categorias padrão: %w", err)
		}
		return audit.Record(ctx, tx, audit.Entry{
			HouseholdID: audit.Ptr(info.ID), Action: audit.ActionHouseholdCreate,
			EntityType: "household", EntityID: audit.Ptr(info.ID), Meta: cliMeta,
		})
	})
	return info, err
}

// AddUser cria um membro com senha temporária e o ambiente individual dele,
// tudo na mesma transação (regra de negócio 3 da Etapa 1).
func AddUser(ctx context.Context, b db.TxBeginner, name, email string) (identity.AdminUser, string, error) {
	var (
		user identity.AdminUser
		temp string
	)
	err := db.WithTx(ctx, b, func(tx pgx.Tx) error {
		hh, err := household.GetOnly(ctx, tx)
		if err != nil {
			return err
		}
		// Serializa criações concorrentes para respeitar o limite de membros.
		if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtext('financas.add_user'))"); err != nil {
			return fmt.Errorf("obter lock: %w", err)
		}
		n, err := identity.CountActiveMembers(ctx, tx, hh.ID)
		if err != nil {
			return fmt.Errorf("contar membros: %w", err)
		}
		if n >= int64(hh.MaxMembers) {
			return ErrMemberLimit
		}
		if user, temp, err = identity.CreateUserWithTempPassword(ctx, tx, hh.ID, name, email); err != nil {
			return err
		}
		if _, err = workspace.CreatePersonal(ctx, tx, hh.ID, user.ID); err != nil {
			return err
		}
		return audit.Record(ctx, tx, audit.Entry{
			HouseholdID: audit.Ptr(hh.ID), Action: audit.ActionUserCreated,
			EntityType: "user", EntityID: audit.Ptr(user.ID), Meta: cliMeta,
		})
	})
	if err != nil {
		return identity.AdminUser{}, "", err
	}
	return user, temp, nil
}

// ResetPassword gera nova senha temporária e revoga as sessões do usuário.
func ResetPassword(ctx context.Context, b db.TxBeginner, email string) (identity.AdminUser, string, error) {
	var (
		user identity.AdminUser
		temp string
	)
	err := db.WithTx(ctx, b, func(tx pgx.Tx) error {
		var err error
		if user, temp, err = identity.ResetToTempPassword(ctx, tx, email); err != nil {
			return err
		}
		return audit.Record(ctx, tx, audit.Entry{
			HouseholdID: audit.Ptr(user.HouseholdID), Action: audit.ActionPasswordReset,
			EntityType: "user", EntityID: audit.Ptr(user.ID), Meta: cliMeta,
		})
	})
	if err != nil {
		return identity.AdminUser{}, "", err
	}
	return user, temp, nil
}

// ListUsers lista os usuários.
func ListUsers(ctx context.Context, b db.TxBeginner) ([]identity.AdminUser, error) {
	var out []identity.AdminUser
	err := db.WithTx(ctx, b, func(tx pgx.Tx) error {
		var err error
		out, err = identity.ListUsers(ctx, tx)
		return err
	})
	return out, err
}
