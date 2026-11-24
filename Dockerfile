# Dockerfile unificado para deploy em PaaS (Render / Fly.io) - ADR 0012 (E9-D1b).
# Empacota a PWA React compilada + os binários Go (api e admin) em um único
# container leve e sem privilégios de root, servindo frontend e /api/v1/* na
# mesma origem HTTPS (evitando problemas de CORS e bloqueio de cookies SameSite).

FROM node:24-alpine AS web-build
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm ci || npm install
COPY web/ ./
RUN npm run build

FROM golang:1.27-alpine AS api-build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY migrations/ ./migrations/
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api \
 && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/admin ./cmd/admin

FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata \
 && adduser -D -u 10001 appuser
WORKDIR /app
COPY --from=api-build /out/api /app/api
COPY --from=api-build /out/admin /app/admin
COPY --from=web-build /web/dist /app/public
ENV STATIC_DIR=/app/public \
    COOKIE_SECURE=true \
    LOG_LEVEL=info \
    TRUSTED_PROXY_CIDRS="10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,127.0.0.1/32,::1/128"
USER appuser
EXPOSE 8080
ENTRYPOINT ["/app/api"]
