package httpx

import (
	"math"
	"net/http"
	"strconv"
	"sync"
	"time"
)

// RateLimiter é um token bucket em memória por chave (ex.: IP).
// Suficiente para uma única instância da API (monólito).
type RateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	rate    float64 // tokens por segundo
	burst   float64
	now     func() time.Time
	lastGC  time.Time
}

type bucket struct {
	tokens float64
	last   time.Time
}

// NewRateLimiter permite `burst` requisições imediatas e repõe `perMinute` por minuto.
func NewRateLimiter(perMinute, burst int) *RateLimiter {
	return &RateLimiter{
		buckets: make(map[string]*bucket),
		rate:    float64(perMinute) / 60,
		burst:   float64(burst),
		now:     time.Now,
	}
}

// Allow consome um token da chave. Se não houver, devolve o tempo de espera.
func (l *RateLimiter) Allow(key string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	l.gc(now)

	b, ok := l.buckets[key]
	if !ok {
		b = &bucket{tokens: l.burst, last: now}
		l.buckets[key] = b
	}
	b.tokens = math.Min(l.burst, b.tokens+now.Sub(b.last).Seconds()*l.rate)
	b.last = now
	if b.tokens >= 1 {
		b.tokens--
		return true, 0
	}
	wait := time.Duration((1 - b.tokens) / l.rate * float64(time.Second))
	return false, wait
}

// gc remove buckets cheios há tempo, para limitar o uso de memória.
func (l *RateLimiter) gc(now time.Time) {
	if now.Sub(l.lastGC) < time.Minute {
		return
	}
	l.lastGC = now
	full := time.Duration(l.burst / l.rate * float64(time.Second))
	for k, b := range l.buckets {
		if now.Sub(b.last) > full {
			delete(l.buckets, k)
		}
	}
}

// LimitByIP aplica o limitador por IP do cliente.
func LimitByIP(l *RateLimiter) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if ok, wait := l.Allow(ClientIP(r)); !ok {
				w.Header().Set("Retry-After", strconv.Itoa(int(math.Ceil(wait.Seconds()))))
				WriteError(w, http.StatusTooManyRequests, "too_many_requests", "muitas tentativas; aguarde e tente novamente")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
