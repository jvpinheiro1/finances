package bankimport

import (
	"context"
	"crypto/subtle"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"financas-familia/backend/internal/audit"
	"financas-familia/backend/internal/bankimport/bankimportdb"
	"financas-familia/backend/internal/expense"
	"financas-familia/backend/internal/platform/db"
	"financas-familia/backend/internal/workspace"
)

// Device representa um dispositivo Android pareado por um familiar.
type Device struct {
	ID         uuid.UUID  `json:"id"`
	UserID     uuid.UUID  `json:"user_id"`
	DeviceName string     `json:"device_name"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`
	RevokedAt  *time.Time `json:"revoked_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
}

// DeviceCreatedResult devolve o dispositivo e o token em texto puro (exibido uma única vez).
type DeviceCreatedResult struct {
	Device     Device `json:"device"`
	PlainToken string `json:"plain_token"`
}

// ImportItem representa um item na fila privada de revisão do dono do celular.
type ImportItem struct {
	ID                 uuid.UUID  `json:"id"`
	HouseholdID        uuid.UUID  `json:"household_id"`
	OwnerUserID        uuid.UUID  `json:"owner_user_id"`
	DeviceTokenID      *uuid.UUID `json:"device_token_id,omitempty"`
	BankCode           string     `json:"bank_code"`
	ParseStatus        string     `json:"parse_status"`
	ParsedAmountCents  *int64     `json:"parsed_amount_cents,omitempty"`
	MerchantOrTitle    string     `json:"merchant_or_title"`
	CardLast4          *string    `json:"card_last4,omitempty"`
	PaymentKind        string     `json:"payment_kind"`
	ParsedInstallments int32      `json:"parsed_installments"`
	OccurredOn         string     `json:"occurred_on"`
	Status             string     `json:"status"`
	ApprovedExpenseID  *uuid.UUID `json:"approved_expense_id,omitempty"`
	CreatedAt          time.Time  `json:"created_at"`
}

// DevicePrincipal identifica o dispositivo autenticado via Bearer token.
type DevicePrincipal struct {
	DeviceID    uuid.UUID
	UserID      uuid.UUID
	HouseholdID uuid.UUID
}

// Service gerencia tokens de dispositivo Android e a fila de revisão de notificações bancárias.
type Service struct {
	pool   bankimportdb.DBTX
	txb    db.TxBeginner
	expSvc *expense.Service
}

// NewService cria o serviço.
func NewService(pool bankimportdb.DBTX, txb db.TxBeginner, expSvc *expense.Service) *Service {
	return &Service{pool: pool, txb: txb, expSvc: expSvc}
}

// CreateDevice gera um novo token de dispositivo Android para o usuário autenticado.
func (s *Service) CreateDevice(ctx context.Context, v workspace.Viewer, deviceName string) (DeviceCreatedResult, error) {
	deviceName = strings.TrimSpace(deviceName)
	if n := utf8.RuneCountInString(deviceName); n < 1 || n > 80 {
		return DeviceCreatedResult{}, ErrInvalidDevice
	}
	plain, hash, err := GenerateDeviceToken()
	if err != nil {
		return DeviceCreatedResult{}, err
	}
	var out DeviceCreatedResult
	err = db.WithUserTx(ctx, s.txb, v.UserID, func(tx pgx.Tx) error {
		r, err := bankimportdb.New(tx).CreateDeviceToken(ctx, bankimportdb.CreateDeviceTokenParams{
			HouseholdID: v.HouseholdID,
			UserID:      v.UserID,
			DeviceName:  deviceName,
			TokenHash:   hash,
		})
		if err != nil {
			return err
		}
		out = DeviceCreatedResult{
			Device:     toDevice(r),
			PlainToken: plain,
		}
		return audit.Record(ctx, tx, audit.Entry{
			HouseholdID: audit.Ptr(v.HouseholdID), ActorID: audit.Ptr(v.UserID),
			Action: audit.ActionDeviceCreated, EntityType: "device_token", EntityID: audit.Ptr(r.ID),
		})
	})
	return out, err
}

// ListDevices lista os dispositivos do próprio usuário autenticado.
func (s *Service) ListDevices(ctx context.Context, v workspace.Viewer) ([]Device, error) {
	var out []Device
	err := db.WithUserTx(ctx, s.txb, v.UserID, func(tx pgx.Tx) error {
		rows, err := bankimportdb.New(tx).ListMyDevices(ctx, bankimportdb.ListMyDevicesParams{
			HouseholdID: v.HouseholdID, UserID: v.UserID,
		})
		if err != nil {
			return err
		}
		out = make([]Device, 0, len(rows))
		for _, r := range rows {
			out = append(out, toDevice(r))
		}
		return nil
	})
	return out, err
}

// RevokeDevice revoga imediatamente um token de dispositivo do próprio usuário.
func (s *Service) RevokeDevice(ctx context.Context, v workspace.Viewer, id uuid.UUID) (Device, error) {
	var out Device
	err := db.WithUserTx(ctx, s.txb, v.UserID, func(tx pgx.Tx) error {
		r, err := bankimportdb.New(tx).RevokeMyDevice(ctx, bankimportdb.RevokeMyDeviceParams{
			ID: id, HouseholdID: v.HouseholdID, UserID: v.UserID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		out = toDevice(r)
		return audit.Record(ctx, tx, audit.Entry{
			HouseholdID: audit.Ptr(v.HouseholdID), ActorID: audit.Ptr(v.UserID),
			Action: audit.ActionDeviceRevoked, EntityType: "device_token", EntityID: audit.Ptr(r.ID),
		})
	})
	return out, err
}

// AuthenticateDevice valida o Bearer token do dispositivo Android em tempo constante.
func (s *Service) AuthenticateDevice(ctx context.Context, plainToken string) (DevicePrincipal, error) {
	hash, ok := HashDeviceToken(plainToken)
	if !ok {
		return DevicePrincipal{}, ErrInvalidToken
	}
	q := bankimportdb.New(s.pool)
	row, err := q.GetActiveDeviceByTokenHash(ctx, hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return DevicePrincipal{}, ErrInvalidToken
	}
	if err != nil {
		return DevicePrincipal{}, err
	}
	if subtle.ConstantTimeCompare(row.TokenHash, hash) != 1 || row.UserStatus != "active" {
		return DevicePrincipal{}, ErrInvalidToken
	}
	_ = q.TouchDeviceToken(ctx, row.DeviceID)
	return DevicePrincipal{
		DeviceID:    row.DeviceID,
		UserID:      row.UserID,
		HouseholdID: row.HouseholdID,
	}, nil
}

// IngestInput reúne o payload enviado pelo App Android (ou simulação de teste).
// O conteúdo bruto nunca é escrito em logs (RNF01 / LGPD).
type IngestInput struct {
	PackageName string
	Title       string
	Text        string
	OccurredOn  string // AAAA-MM-DD opcional (padrão: hoje UTC)
	ExternalID  string // chave opcional de deduplicação gerada no Android
}

// Ingest processa a notificação bancária, aplica o parser versionado + mascaramento
// anti-PAN e grava na fila privada do dono do dispositivo (protegida por RLS).
func (s *Service) Ingest(ctx context.Context, dp DevicePrincipal, in IngestInput) (ImportItem, error) {
	if strings.TrimSpace(in.Title) == "" && strings.TrimSpace(in.Text) == "" {
		return ImportItem{}, ErrEmptyNotification
	}
	occurredStr := strings.TrimSpace(in.OccurredOn)
	var occurredDate time.Time
	var err error
	if occurredStr == "" {
		occurredDate = time.Now().UTC()
		occurredStr = occurredDate.Format("2006-01-02")
	} else {
		occurredDate, err = expense.ParseDate(occurredStr)
		if err != nil {
			return ImportItem{}, err
		}
	}

	parsed := ParseNotification(in.PackageName, in.Title, in.Text)
	dedupHash := ComputeDedupHash(parsed.BankCode, occurredStr, in.Title, in.Text, in.ExternalID)

	var out ImportItem
	err = db.WithUserTx(ctx, s.txb, dp.UserID, func(tx pgx.Tx) error {
		devID := dp.DeviceID
		r, err := bankimportdb.New(tx).UpsertBankImportItem(ctx, bankimportdb.UpsertBankImportItemParams{
			HouseholdID:        dp.HouseholdID,
			OwnerUserID:        dp.UserID,
			DeviceTokenID:      &devID,
			BankCode:           parsed.BankCode,
			ParseStatus:        parsed.ParseStatus,
			ParsedAmountCents:  parsed.ParsedAmountCents,
			MerchantOrTitle:    parsed.MerchantOrTitle,
			CardLast4:          parsed.CardLast4,
			PaymentKind:        parsed.PaymentKind,
			ParsedInstallments: parsed.ParsedInstallments,
			OccurredOn:         occurredDate,
			DedupHash:          dedupHash,
		})
		if err != nil {
			return err
		}
		out = toImportItem(r)
		// Auditoria registra apenas o ID, código do banco e parse_status (NUNCA valor nem texto da notificação!).
		return audit.Record(ctx, tx, audit.Entry{
			HouseholdID: audit.Ptr(dp.HouseholdID), ActorID: audit.Ptr(dp.UserID),
			Action: audit.ActionImportIngested, EntityType: "bank_import_inbox", EntityID: audit.Ptr(r.ID),
			Meta: map[string]any{"bank_code": parsed.BankCode, "parse_status": parsed.ParseStatus},
		})
	})
	return out, err
}

// ListImports lista os itens da fila privada de revisão do próprio usuário autenticado.
func (s *Service) ListImports(ctx context.Context, v workspace.Viewer, statusFilter string) ([]ImportItem, error) {
	var out []ImportItem
	err := db.WithUserTx(ctx, s.txb, v.UserID, func(tx pgx.Tx) error {
		rows, err := bankimportdb.New(tx).ListMyBankImports(ctx, bankimportdb.ListMyBankImportsParams{
			HouseholdID:  v.HouseholdID,
			OwnerUserID:  v.UserID,
			FilterStatus: statusFilter != "",
			Status:       statusFilter,
		})
		if err != nil {
			return err
		}
		out = make([]ImportItem, 0, len(rows))
		for _, r := range rows {
			out = append(out, toImportItem(r))
		}
		return nil
	})
	return out, err
}

// ApproveInput permite confirmar ou ajustar os dados do item ao transformá-lo em despesa.
type ApproveInput struct {
	WorkspaceID       uuid.UUID
	CategoryID        uuid.UUID
	PaymentMethodID   *uuid.UUID
	AmountCents       *int64 // opcional se o item já tiver ParsedAmountCents
	Description       string // opcional (usa MerchantOrTitle se vazio)
	IncurredOn        string // opcional (usa OccurredOn se vazio)
	TotalInstallments int    // opcional (usa ParsedInstallments se 0)
	Notes             string
}

// Approve transforma um item pendente da fila em uma despesa (no ambiente individual ou coletivo escolhido).
func (s *Service) Approve(ctx context.Context, v workspace.Viewer, id uuid.UUID, in ApproveInput) (expense.Expense, error) {
	var cur ImportItem
	err := db.WithUserTx(ctx, s.txb, v.UserID, func(tx pgx.Tx) error {
		r, err := bankimportdb.New(tx).GetMyBankImport(ctx, bankimportdb.GetMyBankImportParams{
			ID: id, HouseholdID: v.HouseholdID, OwnerUserID: v.UserID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		cur = toImportItem(r)
		return nil
	})
	if err != nil {
		return expense.Expense{}, err
	}
	if cur.Status != "pending" {
		return expense.Expense{}, ErrNotPending
	}

	var amount int64
	if in.AmountCents != nil && *in.AmountCents > 0 {
		amount = *in.AmountCents
	} else if cur.ParsedAmountCents != nil && *cur.ParsedAmountCents > 0 {
		amount = *cur.ParsedAmountCents
	} else {
		return expense.Expense{}, ErrAmountRequired
	}

	desc := strings.TrimSpace(in.Description)
	if desc == "" {
		desc = cur.MerchantOrTitle
	}
	incOn := strings.TrimSpace(in.IncurredOn)
	if incOn == "" {
		incOn = cur.OccurredOn
	}
	inst := in.TotalInstallments
	if inst <= 0 {
		inst = int(cur.ParsedInstallments)
	}

	createdExp, err := s.expSvc.Create(ctx, v, in.WorkspaceID, expense.ExpenseInput{
		CategoryID:        in.CategoryID,
		PaymentMethodID:   in.PaymentMethodID,
		PaidByUserID:      v.UserID,
		AmountCents:       amount,
		Description:       desc,
		IncurredOn:        incOn,
		Notes:             in.Notes,
		SplitStrategy:     expense.SplitEqual,
		TotalInstallments: inst,
	})
	if err != nil {
		return expense.Expense{}, err
	}

	err = db.WithUserTx(ctx, s.txb, v.UserID, func(tx pgx.Tx) error {
		expID := createdExp.ID
		if _, err := bankimportdb.New(tx).MarkBankImportApproved(ctx, bankimportdb.MarkBankImportApprovedParams{
			ID: id, HouseholdID: v.HouseholdID, OwnerUserID: v.UserID, ApprovedExpenseID: &expID,
		}); err != nil {
			return err
		}
		return audit.Record(ctx, tx, audit.Entry{
			HouseholdID: audit.Ptr(v.HouseholdID), ActorID: audit.Ptr(v.UserID),
			Action: audit.ActionImportApproved, EntityType: "bank_import_inbox", EntityID: audit.Ptr(id),
		})
	})
	if err != nil {
		return expense.Expense{}, err
	}
	return createdExp, nil
}

// Discard descarta um item pendente da fila privada do usuário.
func (s *Service) Discard(ctx context.Context, v workspace.Viewer, id uuid.UUID) (ImportItem, error) {
	var out ImportItem
	err := db.WithUserTx(ctx, s.txb, v.UserID, func(tx pgx.Tx) error {
		q := bankimportdb.New(tx)
		cur, err := q.GetMyBankImport(ctx, bankimportdb.GetMyBankImportParams{
			ID: id, HouseholdID: v.HouseholdID, OwnerUserID: v.UserID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if cur.Status != "pending" {
			return ErrNotPending
		}
		r, err := q.MarkBankImportDiscarded(ctx, bankimportdb.MarkBankImportDiscardedParams{
			ID: id, HouseholdID: v.HouseholdID, OwnerUserID: v.UserID,
		})
		if err != nil {
			return err
		}
		out = toImportItem(r)
		return audit.Record(ctx, tx, audit.Entry{
			HouseholdID: audit.Ptr(v.HouseholdID), ActorID: audit.Ptr(v.UserID),
			Action: audit.ActionImportDiscarded, EntityType: "bank_import_inbox", EntityID: audit.Ptr(id),
		})
	})
	return out, err
}

func toDevice(r bankimportdb.DeviceToken) Device {
	return Device{
		ID:         r.ID,
		UserID:     r.UserID,
		DeviceName: r.DeviceName,
		LastUsedAt: r.LastUsedAt,
		RevokedAt:  r.RevokedAt,
		CreatedAt:  r.CreatedAt,
	}
}

func toImportItem(r bankimportdb.BankImportInbox) ImportItem {
	return ImportItem{
		ID:                 r.ID,
		HouseholdID:        r.HouseholdID,
		OwnerUserID:        r.OwnerUserID,
		DeviceTokenID:      r.DeviceTokenID,
		BankCode:           r.BankCode,
		ParseStatus:        r.ParseStatus,
		ParsedAmountCents:  r.ParsedAmountCents,
		MerchantOrTitle:    r.MerchantOrTitle,
		CardLast4:          r.CardLast4,
		PaymentKind:        r.PaymentKind,
		ParsedInstallments: r.ParsedInstallments,
		OccurredOn:         r.OccurredOn.UTC().Format("2006-01-02"),
		Status:             r.Status,
		ApprovedExpenseID:  r.ApprovedExpenseID,
		CreatedAt:          r.CreatedAt,
	}
}
