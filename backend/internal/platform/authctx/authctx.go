// Package authctx guarda o usuário autenticado no contexto da requisição.
// Fica em platform para que os módulos não dependam diretamente de identity.
package authctx

import (
	"context"

	"github.com/google/uuid"
)

// Principal é o usuário autenticado da requisição.
type Principal struct {
	UserID             uuid.UUID
	HouseholdID        uuid.UUID
	Name               string
	Email              string
	MustChangePassword bool
	// SessionHash identifica a sessão atual (hash do token, nunca o token).
	SessionHash []byte
}

type ctxKey struct{}

// With devolve um contexto com o principal.
func With(ctx context.Context, p Principal) context.Context {
	return context.WithValue(ctx, ctxKey{}, p)
}

// From recupera o principal; ok=false se a requisição não for autenticada.
func From(ctx context.Context) (Principal, bool) {
	p, ok := ctx.Value(ctxKey{}).(Principal)
	return p, ok
}
