package identity

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"time"

	"github.com/google/uuid"
)

// Erros de domínio. Mensagens são seguras para exibir ao usuário.
var (
	// ErrInvalidCredentials cobre e-mail inexistente, senha errada, conta
	// desativada e conta bloqueada: a resposta não revela qual foi o caso.
	ErrInvalidCredentials = errors.New("e-mail ou senha inválidos, ou acesso temporariamente bloqueado")
	ErrWrongPassword      = errors.New("senha atual incorreta")
	ErrSamePassword       = errors.New("a nova senha deve ser diferente da atual")
	ErrSessionInvalid     = errors.New("sessão inválida ou expirada")
)

// User é a visão pública de um usuário autenticado.
type User struct {
	ID                 uuid.UUID
	HouseholdID        uuid.UUID
	Name               string
	Email              string
	MustChangePassword bool
}

// LockoutPolicy define o bloqueio progressivo após falhas de login (ADR 0003).
type LockoutPolicy struct {
	Threshold int           // falhas seguidas até o primeiro bloqueio
	BaseLock  time.Duration // duração do primeiro bloqueio
	MaxLock   time.Duration // teto
}

// DefaultLockout: 5 falhas → 15 min; cada falha extra dobra; teto de 24 h.
var DefaultLockout = LockoutPolicy{Threshold: 5, BaseLock: 15 * time.Minute, MaxLock: 24 * time.Hour}

// LockDuration devolve quanto tempo bloquear após `failures` falhas seguidas
// (0 = não bloquear).
func (p LockoutPolicy) LockDuration(failures int) time.Duration {
	if failures < p.Threshold {
		return 0
	}
	d := p.BaseLock
	for i := p.Threshold; i < failures; i++ {
		d *= 2
		if d >= p.MaxLock {
			return p.MaxLock
		}
	}
	return min(d, p.MaxLock)
}

// SessionToken é o valor do cookie. Só o hash vai para o banco.
type SessionToken string

// NewSessionToken gera um token aleatório de 256 bits.
func NewSessionToken() (SessionToken, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return SessionToken(base64.RawURLEncoding.EncodeToString(b)), nil
}

// Hash devolve o SHA-256 do token (chave da sessão no banco).
func (t SessionToken) Hash() []byte {
	h := sha256.Sum256([]byte(t))
	return h[:]
}

// Valid confere o formato (43 caracteres base64url = 32 bytes).
func (t SessionToken) Valid() bool {
	if len(t) != 43 {
		return false
	}
	_, err := base64.RawURLEncoding.DecodeString(string(t))
	return err == nil
}
