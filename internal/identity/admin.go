package identity

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"financas-familia/backend/internal/identity/identitydb"
)

// Funções usadas apenas pelo CLI admin, com o papel app_owner e dentro de
// transações controladas por quem chama.

var (
	ErrEmailTaken   = errors.New("já existe um usuário com este e-mail")
	ErrInvalidEmail = errors.New("e-mail inválido")
	ErrInvalidName  = errors.New("nome deve ter entre 1 e 100 caracteres")
	ErrUserNotFound = errors.New("usuário não encontrado")
)

// AdminUser é a visão administrativa de um usuário.
type AdminUser struct {
	ID                 uuid.UUID
	HouseholdID        uuid.UUID
	Name               string
	Email              string
	Status             string
	MustChangePassword bool
	Locked             bool
}

// ValidateEmail normaliza e valida um e-mail simples (sem nome de exibição).
func ValidateEmail(email string) (string, error) {
	email = NormalizeEmail(email)
	if len(email) < 3 || len(email) > 254 {
		return "", ErrInvalidEmail
	}
	addr, err := mail.ParseAddress(email)
	if err != nil || addr.Address != email || !strings.Contains(email[strings.LastIndex(email, "@"):], ".") {
		return "", ErrInvalidEmail
	}
	return email, nil
}

// CountActiveMembers conta membros ativos da residência.
func CountActiveMembers(ctx context.Context, tx identitydb.DBTX, householdID uuid.UUID) (int64, error) {
	return identitydb.New(tx).CountActiveMembers(ctx, householdID)
}

// CreateUserWithTempPassword cria o usuário com senha temporária (troca obrigatória
// no primeiro login) e devolve a senha em texto para ser entregue pessoalmente.
func CreateUserWithTempPassword(ctx context.Context, tx identitydb.DBTX, householdID uuid.UUID, name, email string) (AdminUser, string, error) {
	name = strings.TrimSpace(name)
	if n := len([]rune(name)); n < 1 || n > 100 {
		return AdminUser{}, "", ErrInvalidName
	}
	email, err := ValidateEmail(email)
	if err != nil {
		return AdminUser{}, "", err
	}
	temp, err := GenerateTemporaryPassword()
	if err != nil {
		return AdminUser{}, "", fmt.Errorf("gerar senha temporária: %w", err)
	}
	hash, err := HashPassword(temp)
	if err != nil {
		return AdminUser{}, "", fmt.Errorf("gerar hash: %w", err)
	}
	u, err := identitydb.New(tx).CreateUser(ctx, identitydb.CreateUserParams{
		HouseholdID: householdID, Name: name, Email: email, PasswordHash: hash,
	})
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return AdminUser{}, "", ErrEmailTaken
	}
	if err != nil {
		return AdminUser{}, "", fmt.Errorf("criar usuário: %w", err)
	}
	return toAdmin(u), temp, nil
}

// ResetToTempPassword define nova senha temporária, desbloqueia a conta e
// revoga todas as sessões do usuário.
func ResetToTempPassword(ctx context.Context, tx identitydb.DBTX, email string) (AdminUser, string, error) {
	q := identitydb.New(tx)
	u, err := q.GetUserByEmail(ctx, NormalizeEmail(email))
	if errors.Is(err, pgx.ErrNoRows) {
		return AdminUser{}, "", ErrUserNotFound
	}
	if err != nil {
		return AdminUser{}, "", fmt.Errorf("buscar usuário: %w", err)
	}
	temp, err := GenerateTemporaryPassword()
	if err != nil {
		return AdminUser{}, "", fmt.Errorf("gerar senha temporária: %w", err)
	}
	hash, err := HashPassword(temp)
	if err != nil {
		return AdminUser{}, "", fmt.Errorf("gerar hash: %w", err)
	}
	if err := q.UpdatePassword(ctx, identitydb.UpdatePasswordParams{ID: u.ID, PasswordHash: hash, MustChangePassword: true}); err != nil {
		return AdminUser{}, "", fmt.Errorf("atualizar senha: %w", err)
	}
	if err := q.DeleteUserSessions(ctx, u.ID); err != nil {
		return AdminUser{}, "", fmt.Errorf("revogar sessões: %w", err)
	}
	u.MustChangePassword = true
	u.LockedUntil = nil
	return toAdmin(u), temp, nil
}

// ListUsers lista todos os usuários.
func ListUsers(ctx context.Context, tx identitydb.DBTX) ([]AdminUser, error) {
	rows, err := identitydb.New(tx).ListUsers(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]AdminUser, 0, len(rows))
	for _, r := range rows {
		out = append(out, toAdmin(r))
	}
	return out, nil
}

func toAdmin(u identitydb.AppUser) AdminUser {
	return AdminUser{
		ID: u.ID, HouseholdID: u.HouseholdID, Name: u.Name, Email: u.Email, Status: u.Status,
		MustChangePassword: u.MustChangePassword, Locked: u.LockedUntil != nil,
	}
}
