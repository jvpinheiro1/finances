// Package config lê a configuração da API a partir de variáveis de ambiente.
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net/netip"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config da API. Segredos (DATABASE_URL) nunca devem ser logados.
type Config struct {
	DatabaseURL       string
	HTTPAddr          string
	AllowedOrigins    []string
	CookieSecure      bool
	SessionTTL        time.Duration
	SessionIdleTTL    time.Duration
	LogLevel          slog.Level
	TrustedProxyCIDRs []string
	StaticDir         string
}

// Load lê e valida as variáveis de ambiente.
func Load() (Config, error) {
	var errs []error
	defaultAddr := ":8080"
	if p := strings.TrimSpace(os.Getenv("PORT")); p != "" {
		if strings.HasPrefix(p, ":") {
			defaultAddr = p
		} else {
			defaultAddr = ":" + p
		}
	}
	c := Config{
		DatabaseURL: os.Getenv("DATABASE_URL"),
		HTTPAddr:    getenv("HTTP_ADDR", defaultAddr),
		StaticDir:   strings.TrimSpace(os.Getenv("STATIC_DIR")),
	}
	if c.DatabaseURL == "" {
		errs = append(errs, errors.New("DATABASE_URL é obrigatória"))
	}

	for _, o := range strings.Split(getenv("ALLOWED_ORIGINS", "http://localhost:5173"), ",") {
		if o = strings.TrimSpace(o); o != "" {
			c.AllowedOrigins = append(c.AllowedOrigins, strings.TrimRight(o, "/"))
		}
	}
	if len(c.AllowedOrigins) == 0 {
		errs = append(errs, errors.New("ALLOWED_ORIGINS não pode ser vazia"))
	}

	if rawCIDRs := strings.TrimSpace(os.Getenv("TRUSTED_PROXY_CIDRS")); rawCIDRs != "" {
		for _, cidr := range strings.Split(rawCIDRs, ",") {
			cidr = strings.TrimSpace(cidr)
			if cidr == "" {
				continue
			}
			if _, err := netip.ParsePrefix(cidr); err != nil {
				errs = append(errs, fmt.Errorf("TRUSTED_PROXY_CIDRS inválido (%q): %w", cidr, err))
				continue
			}
			c.TrustedProxyCIDRs = append(c.TrustedProxyCIDRs, cidr)
		}
	}

	var err error
	if c.CookieSecure, err = strconv.ParseBool(getenv("COOKIE_SECURE", "true")); err != nil {
		errs = append(errs, fmt.Errorf("COOKIE_SECURE inválida: %w", err))
	}
	if c.SessionTTL, err = time.ParseDuration(getenv("SESSION_TTL", "336h")); err != nil || c.SessionTTL <= 0 {
		errs = append(errs, errors.New("SESSION_TTL inválida (ex.: 336h)"))
	}
	if c.SessionIdleTTL, err = time.ParseDuration(getenv("SESSION_IDLE_TTL", "72h")); err != nil || c.SessionIdleTTL <= 0 {
		errs = append(errs, errors.New("SESSION_IDLE_TTL inválida (ex.: 72h)"))
	}
	if c.SessionIdleTTL > c.SessionTTL {
		errs = append(errs, errors.New("SESSION_IDLE_TTL não pode ser maior que SESSION_TTL"))
	}
	if err = c.LogLevel.UnmarshalText([]byte(getenv("LOG_LEVEL", "info"))); err != nil {
		errs = append(errs, fmt.Errorf("LOG_LEVEL inválido: %w", err))
	}
	return c, errors.Join(errs...)
}

func getenv(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	return def
}
