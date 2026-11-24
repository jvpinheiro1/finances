// Package app monta o servidor HTTP (composition root dos módulos).
package app

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"financas-familia/backend/internal/audit"
	"financas-familia/backend/internal/bankimport"
	"financas-familia/backend/internal/expense"
	"financas-familia/backend/internal/household"
	"financas-familia/backend/internal/household/householddb"
	"financas-familia/backend/internal/identity"
	"financas-familia/backend/internal/identity/identitydb"
	"financas-familia/backend/internal/notification"
	"financas-familia/backend/internal/platform/config"
	"financas-familia/backend/internal/platform/httpx"
	"financas-familia/backend/internal/report"
	"financas-familia/backend/internal/settlement"
	"financas-familia/backend/internal/workspace"
)

// App reúne o handler HTTP e os serviços com tarefas de fundo.
type App struct {
	Handler   http.Handler
	Identity  *identity.Service
	Workspace *workspace.Service
	Expense   *expense.Service
}

// New monta as dependências e as rotas.
func New(cfg config.Config, pool *pgxpool.Pool) *App {
	_ = httpx.SetTrustedProxies(cfg.TrustedProxyCIDRs)

	auditRec := audit.NewRecorder(pool)

	idSvc := identity.NewService(identitydb.New(pool), auditRec, identity.Config{
		SessionTTL: cfg.SessionTTL, SessionIdleTTL: cfg.SessionIdleTTL,
	})
	idH := identity.NewHandler(idSvc, cfg.CookieSecure)
	wsSvc := workspace.NewService(pool)
	expSvc := expense.NewService(pool)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := pool.Ping(ctx); err != nil {
			httpx.WriteJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "unavailable"})
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ready"})
	})

	idH.Register(mux)
	hhSvc := household.NewService(householddb.New(pool))
	household.NewHandler(hhSvc).Register(mux, idH.RequireUser)
	workspace.NewHandler(wsSvc).Register(mux, idH.RequireUser)
	expense.NewHandler(expSvc).Register(mux, idH.RequireUser)
	settlement.NewHandler(settlement.NewService(pool)).Register(mux, idH.RequireUser)
	notification.NewHandler(notification.NewService(pool)).Register(mux, idH.RequireUser)
	report.NewHandler(report.NewService(wsSvc, expSvc, hhSvc)).Register(mux, idH.RequireUser)
	bankimport.NewHandler(bankimport.NewService(pool, pool, expSvc)).Register(mux, idH.RequireUser)

	staticDir := strings.TrimSpace(cfg.StaticDir)
	var fileServer http.Handler
	if staticDir != "" {
		fileServer = http.FileServer(http.Dir(staticDir))
	}

	// Fallback: se STATIC_DIR estiver configurado (deploy unificado em PaaS, ADR 0012),
	// serve os arquivos estáticos da PWA para rotas fora de /api/; caso contrário, 404 JSON.
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if fileServer == nil || strings.HasPrefix(r.URL.Path, "/api/") || (r.Method != http.MethodGet && r.Method != http.MethodHead) {
			httpx.NotFound(w)
			return
		}
		cleanRel := filepath.Clean(strings.TrimPrefix(r.URL.Path, "/"))
		if cleanRel == "." || cleanRel == "" {
			http.ServeFile(w, r, filepath.Join(staticDir, "index.html"))
			return
		}
		candidate := filepath.Join(staticDir, cleanRel)
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			fileServer.ServeHTTP(w, r)
			return
		}
		http.ServeFile(w, r, filepath.Join(staticDir, "index.html"))
	})

	h := httpx.Chain(mux,
		httpx.RequestID,
		httpx.Logger,
		httpx.Recover,
		httpx.SecurityHeaders,
		httpx.CSRF(cfg.AllowedOrigins),
	)
	return &App{Handler: h, Identity: idSvc, Workspace: wsSvc, Expense: expSvc}
}
