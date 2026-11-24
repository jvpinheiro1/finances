package identity

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"

	"financas-familia/backend/internal/platform/authctx"
	"financas-familia/backend/internal/platform/httpx"
)

// CookieName é o nome do cookie de sessão.
const CookieName = "ff_session"

// Handler expõe as rotas de autenticação.
type Handler struct {
	svc          *Service
	cookieSecure bool
	loginLimiter *httpx.RateLimiter
}

// NewHandler cria o handler. O limitador de login é por IP (10/min, rajada de 5).
func NewHandler(svc *Service, cookieSecure bool) *Handler {
	return &Handler{svc: svc, cookieSecure: cookieSecure, loginLimiter: httpx.NewRateLimiter(10, 5)}
}

// Register registra as rotas no mux.
func (h *Handler) Register(mux *http.ServeMux) {
	mux.Handle("POST /api/v1/auth/login", httpx.LimitByIP(h.loginLimiter)(http.HandlerFunc(h.login)))
	mux.Handle("POST /api/v1/auth/logout", h.RequireSession(http.HandlerFunc(h.logout)))
	mux.Handle("GET /api/v1/auth/me", h.RequireSession(http.HandlerFunc(h.me)))
	mux.Handle("POST /api/v1/auth/password", h.RequireSession(http.HandlerFunc(h.changePassword)))
}

type userDTO struct {
	ID                 uuid.UUID `json:"id"`
	HouseholdID        uuid.UUID `json:"household_id"`
	Name               string    `json:"name"`
	Email              string    `json:"email"`
	MustChangePassword bool      `json:"must_change_password"`
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (h *Handler) login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.BadRequest(w, err.Error())
		return
	}
	res, err := h.svc.Login(r.Context(), req.Email, req.Password)
	if errors.Is(err, ErrInvalidCredentials) {
		httpx.WriteError(w, http.StatusUnauthorized, "invalid_credentials", err.Error())
		return
	}
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	h.setCookie(w, string(res.Token), res.ExpiresAt)
	u := res.User
	httpx.WriteJSON(w, http.StatusOK, userDTO{
		ID: u.ID, HouseholdID: u.HouseholdID, Name: u.Name, Email: u.Email, MustChangePassword: u.MustChangePassword,
	})
}

func (h *Handler) logout(w http.ResponseWriter, r *http.Request) {
	p, _ := authctx.From(r.Context())
	if err := h.svc.Logout(r.Context(), p); err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	h.clearCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) me(w http.ResponseWriter, r *http.Request) {
	p, _ := authctx.From(r.Context())
	httpx.WriteJSON(w, http.StatusOK, userDTO{
		ID: p.UserID, HouseholdID: p.HouseholdID, Name: p.Name, Email: p.Email, MustChangePassword: p.MustChangePassword,
	})
}

type changePasswordRequest struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

func (h *Handler) changePassword(w http.ResponseWriter, r *http.Request) {
	var req changePasswordRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.BadRequest(w, err.Error())
		return
	}
	p, _ := authctx.From(r.Context())
	err := h.svc.ChangePassword(r.Context(), p, req.CurrentPassword, req.NewPassword)
	switch {
	case errors.Is(err, ErrWrongPassword):
		httpx.WriteError(w, http.StatusUnprocessableEntity, "wrong_password", err.Error())
	case errors.Is(err, ErrPasswordTooShort), errors.Is(err, ErrPasswordTooLong), errors.Is(err, ErrSamePassword):
		httpx.WriteError(w, http.StatusUnprocessableEntity, "weak_password", err.Error())
	case err != nil:
		httpx.InternalError(w, r, err)
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// RequireSession exige sessão válida, mesmo que a troca de senha esteja pendente.
func (h *Handler) RequireSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(CookieName)
		if err != nil {
			httpx.Unauthorized(w)
			return
		}
		p, err := h.svc.Authenticate(r.Context(), SessionToken(c.Value))
		if errors.Is(err, ErrSessionInvalid) {
			h.clearCookie(w)
			httpx.Unauthorized(w)
			return
		}
		if err != nil {
			httpx.InternalError(w, r, err)
			return
		}
		next.ServeHTTP(w, r.WithContext(authctx.With(r.Context(), p)))
	})
}

// RequireUser exige sessão válida E senha definitiva (sem troca pendente).
// Use em todas as rotas de negócio.
func (h *Handler) RequireUser(next http.Handler) http.Handler {
	return h.RequireSession(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if p, _ := authctx.From(r.Context()); p.MustChangePassword {
			httpx.WriteError(w, http.StatusForbidden, "password_change_required", "troque a senha temporária para continuar")
			return
		}
		next.ServeHTTP(w, r)
	}))
}

func (h *Handler) setCookie(w http.ResponseWriter, value string, expires time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    value,
		Path:     "/",
		Expires:  expires,
		MaxAge:   int(time.Until(expires).Seconds()),
		HttpOnly: true,
		Secure:   h.cookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

func (h *Handler) clearCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: CookieName, Value: "", Path: "/", MaxAge: -1,
		HttpOnly: true, Secure: h.cookieSecure, SameSite: http.SameSiteLaxMode,
	})
}

// StartSessionJanitor remove sessões expiradas periodicamente até ctx terminar.
func (s *Service) StartSessionJanitor(ctx context.Context, every time.Duration) {
	go func() {
		t := time.NewTicker(every)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				opCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
				if n, err := s.PurgeExpiredSessions(opCtx); err != nil {
					slog.Warn("falha ao limpar sessões expiradas", "err", err)
				} else if n > 0 {
					slog.Info("sessões expiradas removidas", "count", n)
				}
				cancel()
			}
		}
	}()
}
