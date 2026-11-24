// Package workspace define os ambientes (coletivo e individual) e a política
// central de acesso a eles (ADR 0004).
package workspace

import (
	"errors"

	"github.com/google/uuid"
)

// Kind é o tipo do ambiente.
type Kind string

const (
	KindHousehold Kind = "household" // coletivo: todos os membros ativos
	KindPersonal  Kind = "personal"  // individual: só o dono
)

// ErrNotFound é devolvido tanto para ambiente inexistente quanto sem acesso
// (a API não revela a existência de recursos de outros usuários).
var ErrNotFound = errors.New("ambiente não encontrado")

// Workspace é um ambiente.
type Workspace struct {
	ID          uuid.UUID
	HouseholdID uuid.UUID
	Kind        Kind
	OwnerUserID *uuid.UUID
}

// Viewer é quem está tentando acessar (usuário ativo autenticado).
type Viewer struct {
	UserID      uuid.UUID
	HouseholdID uuid.UUID
}

// CanAccess é a política central. Todo recurso financeiro futuro com
// workspace_id deve passar por ela.
func CanAccess(v Viewer, w Workspace) bool {
	if v.UserID == uuid.Nil || v.HouseholdID == uuid.Nil || w.HouseholdID != v.HouseholdID {
		return false
	}
	switch w.Kind {
	case KindHousehold:
		return true
	case KindPersonal:
		return w.OwnerUserID != nil && *w.OwnerUserID == v.UserID
	default:
		return false
	}
}
