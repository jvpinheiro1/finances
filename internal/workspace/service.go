package workspace

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"financas-familia/backend/internal/platform/db"
	"financas-familia/backend/internal/workspace/workspacedb"
)

// Service consulta ambientes sempre dentro de uma transação com o usuário
// definido (RLS) e aplica a política central em Go (defesa em profundidade).
type Service struct {
	db db.TxBeginner
}

// NewService cria o serviço.
func NewService(b db.TxBeginner) *Service { return &Service{db: b} }

// List devolve os ambientes acessíveis: o individual do usuário e o coletivo.
func (s *Service) List(ctx context.Context, v Viewer) ([]Workspace, error) {
	var out []Workspace
	err := db.WithUserTx(ctx, s.db, v.UserID, func(tx pgx.Tx) error {
		rows, err := workspacedb.New(tx).ListAccessibleWorkspaces(ctx, workspacedb.ListAccessibleWorkspacesParams{
			HouseholdID: v.HouseholdID, UserID: v.UserID,
		})
		if err != nil {
			return err
		}
		for _, r := range rows {
			w := fromRow(r)
			if CanAccess(v, w) {
				out = append(out, w)
			}
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("listar ambientes: %w", err)
	}
	return out, nil
}

// Get devolve um ambiente ou ErrNotFound (inexistente ou sem acesso).
func (s *Service) Get(ctx context.Context, v Viewer, id uuid.UUID) (Workspace, error) {
	var w Workspace
	err := db.WithUserTx(ctx, s.db, v.UserID, func(tx pgx.Tx) error {
		var err error
		w, err = GetTx(ctx, tx, v, id)
		return err
	})
	if errors.Is(err, ErrNotFound) {
		return Workspace{}, ErrNotFound
	}
	if err != nil {
		return Workspace{}, fmt.Errorf("buscar ambiente: %w", err)
	}
	return w, nil
}

// GetTx busca um ambiente dentro de uma transação já aberta com app.user_id definido
// e aplica a política central CanAccess.
func GetTx(ctx context.Context, tx workspacedb.DBTX, v Viewer, id uuid.UUID) (Workspace, error) {
	r, err := workspacedb.New(tx).GetWorkspace(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return Workspace{}, ErrNotFound
	}
	if err != nil {
		return Workspace{}, err
	}
	w := fromRow(r)
	if !CanAccess(v, w) {
		return Workspace{}, ErrNotFound
	}
	return w, nil
}

// GetCollectiveTx devolve o ambiente coletivo da residência do viewer dentro de uma transação.
func GetCollectiveTx(ctx context.Context, tx workspacedb.DBTX, v Viewer) (Workspace, error) {
	r, err := workspacedb.New(tx).GetHouseholdWorkspace(ctx, v.HouseholdID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Workspace{}, ErrNotFound
	}
	if err != nil {
		return Workspace{}, err
	}
	w := fromRow(r)
	if !CanAccess(v, w) {
		return Workspace{}, ErrNotFound
	}
	return w, nil
}

// CreateHousehold cria o ambiente coletivo (uso do CLI admin, dentro de tx).
func CreateHousehold(ctx context.Context, tx workspacedb.DBTX, householdID uuid.UUID) (Workspace, error) {
	r, err := workspacedb.New(tx).CreateHouseholdWorkspace(ctx, householdID)
	if err != nil {
		return Workspace{}, fmt.Errorf("criar ambiente coletivo: %w", err)
	}
	return fromRow(r), nil
}

// CreatePersonal cria o ambiente individual do usuário (uso do CLI admin, dentro de tx).
func CreatePersonal(ctx context.Context, tx workspacedb.DBTX, householdID, ownerID uuid.UUID) (Workspace, error) {
	r, err := workspacedb.New(tx).CreatePersonalWorkspace(ctx, workspacedb.CreatePersonalWorkspaceParams{
		HouseholdID: householdID, OwnerUserID: ownerID,
	})
	if err != nil {
		return Workspace{}, fmt.Errorf("criar ambiente individual: %w", err)
	}
	return fromRow(r), nil
}

func fromRow(r workspacedb.Workspace) Workspace {
	return Workspace{ID: r.ID, HouseholdID: r.HouseholdID, Kind: Kind(r.Kind), OwnerUserID: r.OwnerUserID}
}
