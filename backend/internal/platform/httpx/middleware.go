package httpx

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"runtime/debug"
	"slices"
	"strings"
	"sync/atomic"
	"time"
)

// Middleware envolve um handler.
type Middleware func(http.Handler) http.Handler

// Chain aplica os middlewares na ordem informada (o primeiro é o mais externo).
func Chain(h http.Handler, mws ...Middleware) http.Handler {
	for i := len(mws) - 1; i >= 0; i-- {
		h = mws[i](h)
	}
	return h
}

type requestIDKey struct{}

// RequestID gera um identificador por requisição (não aceita o do cliente).
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b := make([]byte, 8)
		_, _ = rand.Read(b)
		id := hex.EncodeToString(b)
		w.Header().Set("X-Request-Id", id)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), requestIDKey{}, id)))
	})
}

// RequestIDFrom devolve o id da requisição, se houver.
func RequestIDFrom(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey{}).(string)
	return id
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusRecorder) Unwrap() http.ResponseWriter { return s.ResponseWriter }

// Logger registra método, rota (padrão, sem IDs), status e duração.
// Nunca registra corpo, query string, cookies ou headers (RNF01/LGPD).
func Logger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		route := r.Pattern
		if route == "" {
			route = "(sem rota)"
		}
		slog.InfoContext(r.Context(), "http",
			"request_id", RequestIDFrom(r.Context()),
			"method", r.Method,
			"route", route,
			"status", rec.status,
			"duration_ms", time.Since(start).Milliseconds(),
		)
	})
}

// Recover transforma panics em 500 sem derrubar o servidor.
func Recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				if v == http.ErrAbortHandler {
					panic(v)
				}
				slog.ErrorContext(r.Context(), "panic", "value", v, "stack", string(debug.Stack()),
					"request_id", RequestIDFrom(r.Context()))
				WriteError(w, http.StatusInternalServerError, "internal_error", "erro interno")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// SecurityHeaders aplica cabeçalhos defensivos às respostas da API e da SPA.
func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Cross-Origin-Resource-Policy", "same-origin")
		if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/healthz" || r.URL.Path == "/readyz" {
			h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
			h.Set("Cache-Control", "no-store")
		} else {
			h.Set("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'")
		}
		next.ServeHTTP(w, r)
	})
}

// CSRFHeader é o header obrigatório em métodos de escrita.
const CSRFHeader = "X-Requested-With"

// CSRF protege métodos de escrita (ADR 0003): exige o header X-Requested-With
// (navegadores não o enviam entre origens sem CORS, que a API não habilita) e,
// se houver Origin, ele precisa estar na lista permitida.
func CSRF(allowedOrigins []string) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodGet, http.MethodHead, http.MethodOptions:
				next.ServeHTTP(w, r)
				return
			}
			if r.Header.Get(CSRFHeader) == "" {
				WriteError(w, http.StatusForbidden, "csrf_rejected", "requisição recusada")
				return
			}
			if origin := r.Header.Get("Origin"); origin != "" &&
				!slices.Contains(allowedOrigins, strings.TrimRight(origin, "/")) {
				WriteError(w, http.StatusForbidden, "csrf_rejected", "requisição recusada")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

var trustedProxies atomic.Value // guarda []netip.Prefix

// SetTrustedProxies configura as faixas CIDR de proxies reversos confiáveis (ADR 0012).
func SetTrustedProxies(cidrs []string) error {
	var prefixes []netip.Prefix
	for _, c := range cidrs {
		c = strings.TrimSpace(c)
		if c == "" {
			continue
		}
		p, err := netip.ParsePrefix(c)
		if err != nil {
			return err
		}
		prefixes = append(prefixes, p)
	}
	trustedProxies.Store(prefixes)
	return nil
}

func isTrustedProxyAddr(ipStr string) bool {
	prefixes, _ := trustedProxies.Load().([]netip.Prefix)
	if len(prefixes) == 0 {
		return false
	}
	addr, err := netip.ParseAddr(strings.TrimSpace(ipStr))
	if err != nil {
		return false
	}
	addr = addr.Unmap()
	for _, p := range prefixes {
		if p.Contains(addr) {
			return true
		}
	}
	return false
}

// ClientIP devolve o IP do cliente.
// Quando r.RemoteAddr pertence a um proxy reverso confiável configurado via
// TRUSTED_PROXY_CIDRS (ADR 0012), extrai de forma segura o IP de X-Forwarded-For
// (da direita para a esquerda, parando no primeiro IP não confiável) ou X-Real-IP.
func ClientIP(r *http.Request) string {
	remoteHost := r.RemoteAddr
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		remoteHost = host
	}
	if !isTrustedProxyAddr(remoteHost) {
		return remoteHost
	}

	if xff := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); xff != "" {
		parts := strings.Split(xff, ",")
		var lastValid string
		for i := len(parts) - 1; i >= 0; i-- {
			candidate := strings.TrimSpace(parts[i])
			addr, err := netip.ParseAddr(candidate)
			if err != nil {
				continue
			}
			clean := addr.Unmap().String()
			lastValid = clean
			if !isTrustedProxyAddr(clean) {
				return clean
			}
		}
		if lastValid != "" {
			return lastValid
		}
	}

	if xri := strings.TrimSpace(r.Header.Get("X-Real-IP")); xri != "" {
		if addr, err := netip.ParseAddr(xri); err == nil {
			return addr.Unmap().String()
		}
	}
	return remoteHost
}
