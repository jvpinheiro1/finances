// Package httpx reúne utilidades HTTP: JSON, erros e middlewares.
package httpx

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
)

// MaxBodyBytes limita o corpo das requisições JSON.
const MaxBodyBytes = 64 << 10

// ErrorBody é o formato padrão de erro da API.
type ErrorBody struct {
	Error ErrorDetail `json:"error"`
}

// ErrorDetail traz um código estável (para o frontend) e uma mensagem legível.
type ErrorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// WriteJSON escreve v como JSON com o status informado.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if v == nil {
		return
	}
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("falha ao escrever resposta JSON", "err", err)
	}
}

// WriteError escreve um erro no formato padrão.
func WriteError(w http.ResponseWriter, status int, code, message string) {
	WriteJSON(w, status, ErrorBody{Error: ErrorDetail{Code: code, Message: message}})
}

// Erros comuns.
func NotFound(w http.ResponseWriter) {
	WriteError(w, http.StatusNotFound, "not_found", "recurso não encontrado")
}

func Unauthorized(w http.ResponseWriter) {
	WriteError(w, http.StatusUnauthorized, "unauthenticated", "autenticação necessária")
}

func BadRequest(w http.ResponseWriter, message string) {
	WriteError(w, http.StatusBadRequest, "invalid_request", message)
}

// InternalError registra o erro (sem dados da requisição) e responde 500 genérico.
func InternalError(w http.ResponseWriter, r *http.Request, err error) {
	slog.ErrorContext(r.Context(), "erro interno", "err", err, "route", r.Pattern)
	WriteError(w, http.StatusInternalServerError, "internal_error", "erro interno")
}

// DecodeJSON lê o corpo como JSON estrito (campos desconhecidos são rejeitados).
func DecodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, MaxBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			return errors.New("corpo da requisição muito grande")
		}
		return fmt.Errorf("JSON inválido")
	}
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("o corpo deve conter um único objeto JSON")
	}
	return nil
}
