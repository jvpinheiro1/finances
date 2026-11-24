package household

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"financas-familia/backend/internal/household/householddb"
)

// Funções usadas apenas pelo CLI admin (papel app_owner), dentro de transações.

var (
	ErrAlreadyBootstrapped = errors.New("a residência já foi criada")
	ErrInvalidName         = errors.New("nome da residência deve ter entre 1 e 100 caracteres")
	ErrInvalidMaxMembers   = errors.New("limite de membros deve estar entre 1 e 20")
)

// Info é a visão administrativa da residência.
type Info struct {
	ID         uuid.UUID
	Name       string
	MaxMembers int
}

// Create cria a única residência do sistema.
func Create(ctx context.Context, tx householddb.DBTX, name string, maxMembers int) (Info, error) {
	name = strings.TrimSpace(name)
	if n := len([]rune(name)); n < 1 || n > 100 {
		return Info{}, ErrInvalidName
	}
	if maxMembers < 1 || maxMembers > 20 {
		return Info{}, ErrInvalidMaxMembers
	}
	q := householddb.New(tx)
	n, err := q.CountHouseholds(ctx)
	if err != nil {
		return Info{}, fmt.Errorf("contar residências: %w", err)
	}
	if n > 0 {
		return Info{}, ErrAlreadyBootstrapped
	}
	h, err := q.CreateHousehold(ctx, householddb.CreateHouseholdParams{Name: name, MaxMembers: int32(maxMembers)})
	if err != nil {
		return Info{}, fmt.Errorf("criar residência: %w", err)
	}
	return Info{ID: h.ID, Name: h.Name, MaxMembers: int(h.MaxMembers)}, nil
}

// GetOnly devolve a residência do sistema (ErrNotFound se o bootstrap não foi feito).
func GetOnly(ctx context.Context, tx householddb.DBTX) (Info, error) {
	h, err := householddb.New(tx).GetOnlyHousehold(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return Info{}, ErrNotFound
	}
	if err != nil {
		return Info{}, fmt.Errorf("buscar residência: %w", err)
	}
	return Info{ID: h.ID, Name: h.Name, MaxMembers: int(h.MaxMembers)}, nil
}
