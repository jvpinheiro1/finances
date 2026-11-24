package identity

import (
	"strings"
	"testing"
	"time"
)

func TestHashAndVerifyPassword(t *testing.T) {
	pw := "SenhaForte#2026!"
	hash, err := HashPassword(pw)
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if !strings.HasPrefix(hash, "$argon2id$") {
		t.Fatalf("formato inesperado: %s", hash)
	}
	ok, err := VerifyPassword(pw, hash)
	if err != nil || !ok {
		t.Fatalf("VerifyPassword correto = (%v, %v), queria (true, nil)", ok, err)
	}
	ok, err = VerifyPassword("outra-senha-errada", hash)
	if err != nil || ok {
		t.Fatalf("VerifyPassword errado = (%v, %v), queria (false, nil)", ok, err)
	}
	if _, err := VerifyPassword(pw, "invalido"); err == nil {
		t.Fatal("esperava erro para hash malformado")
	}
}

func TestValidateNewPassword(t *testing.T) {
	if err := ValidateNewPassword("curta123"); err != ErrPasswordTooShort {
		t.Fatalf("esperava ErrPasswordTooShort, obteve %v", err)
	}
	if err := ValidateNewPassword(strings.Repeat("a", MaxPasswordLen+1)); err != ErrPasswordTooLong {
		t.Fatalf("esperava ErrPasswordTooLong, obteve %v", err)
	}
	if err := ValidateNewPassword("SenhaValida123!"); err != nil {
		t.Fatalf("esperava nil, obteve %v", err)
	}
}

func TestLockoutPolicy(t *testing.T) {
	p := DefaultLockout
	if d := p.LockDuration(4); d != 0 {
		t.Fatalf("4 falhas não devem bloquear: %v", d)
	}
	if d := p.LockDuration(5); d != 15*time.Minute {
		t.Fatalf("5 falhas = %v, queria 15m", d)
	}
	if d := p.LockDuration(6); d != 30*time.Minute {
		t.Fatalf("6 falhas = %v, queria 30m", d)
	}
	if d := p.LockDuration(50); d != 24*time.Hour {
		t.Fatalf("teto = %v, queria 24h", d)
	}
}

func TestSessionToken(t *testing.T) {
	tok, err := NewSessionToken()
	if err != nil {
		t.Fatalf("NewSessionToken: %v", err)
	}
	if !tok.Valid() {
		t.Fatalf("token gerado deveria ser válido: %q", tok)
	}
	if len(tok.Hash()) != 32 {
		t.Fatalf("hash deveria ter 32 bytes, tem %d", len(tok.Hash()))
	}
	if SessionToken("curto").Valid() {
		t.Fatal("token curto não pode ser válido")
	}
}
