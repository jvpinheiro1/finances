package identity

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"financas-familia/backend/internal/audit"
	"financas-familia/backend/internal/identity/identitydb"
	"financas-familia/backend/internal/platform/authctx"
)

// Auditor grava eventos de auditoria.
type Auditor interface {
	Record(ctx context.Context, e audit.Entry) error
}

// Config do serviço de identidade.
type Config struct {
	SessionTTL     time.Duration
	SessionIdleTTL time.Duration
	Lockout        LockoutPolicy
}

// Service implementa login, sessões e troca de senha.
type Service struct {
	q     identitydb.Querier
	audit Auditor
	cfg   Config
	now   func() time.Time
}

// NewService cria o serviço.
func NewService(q identitydb.Querier, a Auditor, cfg Config) *Service {
	if cfg.Lockout.Threshold == 0 {
		cfg.Lockout = DefaultLockout
	}
	return &Service{q: q, audit: a, cfg: cfg, now: time.Now}
}

// touchInterval evita um UPDATE de sessão a cada requisição.
const touchInterval = time.Minute

// NormalizeEmail remove espaços e padroniza caixa.
func NormalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

// LoginResult traz o usuário e o token a ser enviado no cookie.
type LoginResult struct {
	User      User
	Token     SessionToken
	ExpiresAt time.Time
}

// Login valida as credenciais e cria uma sessão.
func (s *Service) Login(ctx context.Context, email, password string) (LoginResult, error) {
	email = NormalizeEmail(email)
	if email == "" || password == "" || len(password) > 4*MaxPasswordLen {
		_, _ = VerifyPassword(password, dummyHash)
		return LoginResult{}, ErrInvalidCredentials
	}

	u, err := s.q.GetUserByEmail(ctx, email)
	if errors.Is(err, pgx.ErrNoRows) {
		_, _ = VerifyPassword(password, dummyHash)
		s.record(ctx, audit.Entry{Action: audit.ActionLoginFailed, Meta: map[string]any{"reason": "unknown_user"}})
		return LoginResult{}, ErrInvalidCredentials
	}
	if err != nil {
		return LoginResult{}, fmt.Errorf("buscar usuário: %w", err)
	}

	// Verifica sempre (tempo constante), mesmo se a conta estiver bloqueada/desativada.
	ok, verr := VerifyPassword(password, u.PasswordHash)
	if verr != nil {
		return LoginResult{}, fmt.Errorf("verificar senha do usuário %s: %w", u.ID, verr)
	}
	now := s.now()
	entry := audit.Entry{HouseholdID: audit.Ptr(u.HouseholdID), ActorID: audit.Ptr(u.ID), Action: audit.ActionLoginFailed}

	switch {
	case u.Status != "active":
		entry.Meta = map[string]any{"reason": "disabled"}
		s.record(ctx, entry)
		return LoginResult{}, ErrInvalidCredentials
	case u.LockedUntil != nil && u.LockedUntil.After(now):
		entry.Meta = map[string]any{"reason": "locked"}
		s.record(ctx, entry)
		return LoginResult{}, ErrInvalidCredentials
	case !ok:
		failures, err := s.q.IncrementFailedLogins(ctx, u.ID)
		if err != nil {
			return LoginResult{}, fmt.Errorf("registrar falha de login: %w", err)
		}
		entry.Meta = map[string]any{"reason": "wrong_password", "consecutive_failures": failures}
		s.record(ctx, entry)
		if d := s.cfg.Lockout.LockDuration(int(failures)); d > 0 {
			until := now.Add(d)
			if err := s.q.SetLockedUntil(ctx, identitydb.SetLockedUntilParams{ID: u.ID, LockedUntil: &until}); err != nil {
				return LoginResult{}, fmt.Errorf("bloquear conta: %w", err)
			}
			s.record(ctx, audit.Entry{HouseholdID: audit.Ptr(u.HouseholdID), ActorID: audit.Ptr(u.ID),
				Action: audit.ActionLoginLocked, Meta: map[string]any{"lock_seconds": int64(d.Seconds())}})
		}
		return LoginResult{}, ErrInvalidCredentials
	}

	if err := s.q.ResetLoginFailures(ctx, u.ID); err != nil {
		return LoginResult{}, fmt.Errorf("zerar falhas de login: %w", err)
	}
	token, err := NewSessionToken()
	if err != nil {
		return LoginResult{}, fmt.Errorf("gerar token: %w", err)
	}
	expires := now.Add(s.cfg.SessionTTL)
	if err := s.q.CreateSession(ctx, identitydb.CreateSessionParams{
		TokenHash: token.Hash(), UserID: u.ID, ExpiresAt: expires, LastSeenAt: now,
	}); err != nil {
		return LoginResult{}, fmt.Errorf("criar sessão: %w", err)
	}
	s.record(ctx, audit.Entry{HouseholdID: audit.Ptr(u.HouseholdID), ActorID: audit.Ptr(u.ID), Action: audit.ActionLoginSucceeded})

	return LoginResult{
		User: User{ID: u.ID, HouseholdID: u.HouseholdID, Name: u.Name, Email: u.Email,
			MustChangePassword: u.MustChangePassword},
		Token:     token,
		ExpiresAt: expires,
	}, nil
}

// Authenticate valida o token do cookie e devolve o principal.
func (s *Service) Authenticate(ctx context.Context, token SessionToken) (authctx.Principal, error) {
	if !token.Valid() {
		return authctx.Principal{}, ErrSessionInvalid
	}
	hash := token.Hash()
	row, err := s.q.GetSessionWithUser(ctx, hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return authctx.Principal{}, ErrSessionInvalid
	}
	if err != nil {
		return authctx.Principal{}, fmt.Errorf("buscar sessão: %w", err)
	}
	// Defesa extra: compara o hash em tempo constante.
	if subtle.ConstantTimeCompare(row.TokenHash, hash) != 1 {
		return authctx.Principal{}, ErrSessionInvalid
	}
	now := s.now()
	if !now.Before(row.ExpiresAt) || now.Sub(row.LastSeenAt) > s.cfg.SessionIdleTTL || row.Status != "active" {
		if err := s.q.DeleteSession(ctx, hash); err != nil {
			slog.WarnContext(ctx, "falha ao remover sessão expirada", "err", err)
		}
		return authctx.Principal{}, ErrSessionInvalid
	}
	if now.Sub(row.LastSeenAt) > touchInterval {
		if err := s.q.TouchSession(ctx, identitydb.TouchSessionParams{TokenHash: hash, LastSeenAt: now}); err != nil {
			slog.WarnContext(ctx, "falha ao atualizar sessão", "err", err)
		}
	}
	return authctx.Principal{
		UserID: row.UserID, HouseholdID: row.HouseholdID, Name: row.Name, Email: row.Email,
		MustChangePassword: row.MustChangePassword, SessionHash: hash,
	}, nil
}

// Logout revoga a sessão atual.
func (s *Service) Logout(ctx context.Context, p authctx.Principal) error {
	if err := s.q.DeleteSession(ctx, p.SessionHash); err != nil {
		return fmt.Errorf("remover sessão: %w", err)
	}
	s.record(ctx, audit.Entry{HouseholdID: audit.Ptr(p.HouseholdID), ActorID: audit.Ptr(p.UserID), Action: audit.ActionLogout})
	return nil
}

// ChangePassword troca a senha e revoga as outras sessões do usuário.
func (s *Service) ChangePassword(ctx context.Context, p authctx.Principal, current, next string) error {
	u, err := s.q.GetUserByID(ctx, p.UserID)
	if err != nil {
		return fmt.Errorf("buscar usuário: %w", err)
	}
	ok, err := VerifyPassword(current, u.PasswordHash)
	if err != nil {
		return fmt.Errorf("verificar senha: %w", err)
	}
	if !ok {
		return ErrWrongPassword
	}
	if err := ValidateNewPassword(next); err != nil {
		return err
	}
	if current == next {
		return ErrSamePassword
	}
	hash, err := HashPassword(next)
	if err != nil {
		return fmt.Errorf("gerar hash: %w", err)
	}
	if err := s.q.UpdatePassword(ctx, identitydb.UpdatePasswordParams{
		ID: u.ID, PasswordHash: hash, MustChangePassword: false,
	}); err != nil {
		return fmt.Errorf("atualizar senha: %w", err)
	}
	if err := s.q.DeleteOtherSessions(ctx, identitydb.DeleteOtherSessionsParams{
		UserID: u.ID, KeepTokenHash: p.SessionHash,
	}); err != nil {
		return fmt.Errorf("revogar outras sessões: %w", err)
	}
	s.record(ctx, audit.Entry{HouseholdID: audit.Ptr(u.HouseholdID), ActorID: audit.Ptr(u.ID), Action: audit.ActionPasswordChanged})
	return nil
}

// PurgeExpiredSessions remove sessões expiradas ou inativas.
func (s *Service) PurgeExpiredSessions(ctx context.Context) (int64, error) {
	now := s.now()
	return s.q.DeleteExpiredSessions(ctx, identitydb.DeleteExpiredSessionsParams{
		Now: now, IdleBefore: now.Add(-s.cfg.SessionIdleTTL),
	})
}

// record grava a auditoria sem interromper o fluxo em caso de falha.
func (s *Service) record(ctx context.Context, e audit.Entry) {
	if s.audit == nil {
		return
	}
	if err := s.audit.Record(ctx, e); err != nil {
		slog.ErrorContext(ctx, "falha ao gravar auditoria", "action", e.Action, "err", err)
	}
}
