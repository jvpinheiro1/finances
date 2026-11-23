package httpx

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientIPTrustedProxies(t *testing.T) {
	t.Cleanup(func() {
		_ = SetTrustedProxies(nil)
	})

	// 1. Sem trusted proxies configurados: deve ignorar X-Forwarded-For (anti-spoofing).
	_ = SetTrustedProxies(nil)
	r1 := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	r1.RemoteAddr = "10.0.0.5:43210"
	r1.Header.Set("X-Forwarded-For", "198.51.100.42")
	if got := ClientIP(r1); got != "10.0.0.5" {
		t.Fatalf("esperava 10.0.0.5 sem trusted proxy, obteve %q", got)
	}

	// 2. Com trusted proxy 10.0.0.0/8 e 172.16.0.0/12 configurados:
	if err := SetTrustedProxies([]string{"10.0.0.0/8", "172.16.0.0/12", "127.0.0.1/32"}); err != nil {
		t.Fatalf("SetTrustedProxies: %v", err)
	}
	if got := ClientIP(r1); got != "198.51.100.42" {
		t.Fatalf("esperava 198.51.100.42 vindo do proxy 10.0.0.5, obteve %q", got)
	}

	// 3. Cadeia com tentativa de spoofing pelo cliente ("1.2.3.4, 203.0.113.9, 172.16.0.10"):
	// O cliente enviou "X-Forwarded-For: 1.2.3.4", o edge proxy adicionou "203.0.113.9" e o internal proxy "172.16.0.10".
	// Lendo da direita para a esquerda, 172.16.0.10 é confiável e 203.0.113.9 é o primeiro IP externo real.
	r2 := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	r2.RemoteAddr = "10.0.0.5:43210"
	r2.Header.Set("X-Forwarded-For", "1.2.3.4, 203.0.113.9, 172.16.0.10")
	if got := ClientIP(r2); got != "203.0.113.9" {
		t.Fatalf("esperava 203.0.113.9 (bloqueando spoofing 1.2.3.4), obteve %q", got)
	}

	// 4. Conexão direta de IP externo (não confiável) tentando forjar X-Forwarded-For:
	r3 := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	r3.RemoteAddr = "203.0.113.77:55123"
	r3.Header.Set("X-Forwarded-For", "8.8.8.8")
	if got := ClientIP(r3); got != "203.0.113.77" {
		t.Fatalf("esperava 203.0.113.77 em conexão direta externa, obteve %q", got)
	}
}
