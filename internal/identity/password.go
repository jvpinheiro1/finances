package identity

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"
)

// Parâmetros argon2id de referência do OWASP (ADR 0003).
type argonParams struct {
	memoryKiB uint32
	time      uint32
	threads   uint8
	saltLen   int
	keyLen    uint32
}

var defaultArgon = argonParams{memoryKiB: 19 * 1024, time: 2, threads: 1, saltLen: 16, keyLen: 32}

// Limites de senha.
const (
	MinPasswordLen = 12
	MaxPasswordLen = 128
)

var (
	ErrPasswordTooShort = fmt.Errorf("a senha deve ter pelo menos %d caracteres", MinPasswordLen)
	ErrPasswordTooLong  = fmt.Errorf("a senha deve ter no máximo %d caracteres", MaxPasswordLen)
	errMalformedHash    = errors.New("hash de senha em formato inválido")
)

// ValidateNewPassword aplica a política de senha.
func ValidateNewPassword(pw string) error {
	n := utf8.RuneCountInString(pw)
	switch {
	case n < MinPasswordLen:
		return ErrPasswordTooShort
	case n > MaxPasswordLen:
		return ErrPasswordTooLong
	}
	return nil
}

// HashPassword gera um hash argon2id no formato PHC.
func HashPassword(pw string) (string, error) {
	p := defaultArgon
	salt := make([]byte, p.saltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("gerar salt: %w", err)
	}
	key := argon2.IDKey([]byte(pw), salt, p.time, p.memoryKiB, p.threads, p.keyLen)
	b64 := base64.RawStdEncoding
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, p.memoryKiB, p.time, p.threads, b64.EncodeToString(salt), b64.EncodeToString(key)), nil
}

// VerifyPassword compara a senha com o hash em tempo constante.
func VerifyPassword(pw, encoded string) (bool, error) {
	parts := strings.Split(encoded, "$")
	// "", "argon2id", "v=19", "m=..,t=..,p=..", salt, hash
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false, errMalformedHash
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return false, errMalformedHash
	}
	var p argonParams
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &p.memoryKiB, &p.time, &p.threads); err != nil {
		return false, errMalformedHash
	}
	if p.memoryKiB == 0 || p.memoryKiB > 1<<20 || p.time == 0 || p.time > 10 || p.threads == 0 {
		return false, errMalformedHash
	}
	b64 := base64.RawStdEncoding
	salt, err := b64.DecodeString(parts[4])
	if err != nil || len(salt) < 8 {
		return false, errMalformedHash
	}
	want, err := b64.DecodeString(parts[5])
	if err != nil || len(want) < 16 || len(want) > 64 {
		return false, errMalformedHash
	}
	got := argon2.IDKey([]byte(pw), salt, p.time, p.memoryKiB, p.threads, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1, nil
}

// dummyHash é usado quando o e-mail não existe, para que o tempo de resposta
// não revele se a conta existe.
var dummyHash = func() string {
	h, err := HashPassword("senha-ficticia-para-equalizar-tempo")
	if err != nil {
		panic(err)
	}
	return h
}()

// GenerateTemporaryPassword cria uma senha temporária legível (sem caracteres ambíguos).
func GenerateTemporaryPassword() (string, error) {
	const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	const length = 16
	buf := make([]byte, length)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	out := make([]byte, length)
	// 256 % 56 != 0: descarta bytes que causariam viés.
	limit := byte(256 - 256%len(alphabet))
	for i := 0; i < length; {
		for _, b := range buf {
			if i == length {
				break
			}
			if b < limit {
				out[i] = alphabet[int(b)%len(alphabet)]
				i++
			}
		}
		if i < length {
			if _, err := rand.Read(buf); err != nil {
				return "", err
			}
		}
	}
	// Agrupa de 4 em 4 para facilitar a digitação: xxxx-xxxx-xxxx-xxxx.
	s := string(out)
	return s[0:4] + "-" + s[4:8] + "-" + s[8:12] + "-" + s[12:16], nil
}
