// Package audit grava a trilha de auditoria. Nunca inclua senha, token,
// e-mail de terceiros ou dado financeiro em Meta.
package audit

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"

	"financas-familia/backend/internal/audit/auditdb"
)

// Ações registradas.
const (
	ActionLoginSucceeded  = "auth.login_succeeded"
	ActionLoginFailed     = "auth.login_failed"
	ActionLoginLocked     = "auth.account_locked"
	ActionLogout          = "auth.logout"
	ActionPasswordChanged = "auth.password_changed"
	ActionHouseholdCreate = "household.created"
	ActionUserCreated     = "user.created"
	ActionPasswordReset   = "user.password_reset"
	ActionCategoryCreated = "category.created"
	ActionCategoryUpdated = "category.updated"
	ActionPaymentCreated  = "payment_method.created"
	ActionPaymentUpdated  = "payment_method.updated"
	ActionExpenseCreated  = "expense.created"
	ActionExpenseUpdated  = "expense.updated"
	ActionExpenseDeleted     = "expense.deleted"
	ActionExpenseShared      = "expense.shared_with_household"
	ActionSettlementCreated  = "settlement.created"
	ActionSettlementConfirm  = "settlement.confirmed"
	ActionSettlementRejected = "settlement.rejected"
	ActionInstallmentCreated = "installment_plan.created"
	ActionInstallmentDeleted = "installment_plan.deleted"
	ActionExpenseRefunded    = "expense.refunded"
	ActionRecurringCreated   = "recurring_rule.created"
	ActionRecurringUpdated   = "recurring_rule.updated"
	ActionRecurringDeleted   = "recurring_rule.deleted"
	ActionRecurringGenerated = "recurring_rule.generated"
	ActionDeviceCreated      = "device.created"
	ActionDeviceRevoked      = "device.revoked"
	ActionImportIngested     = "bank_import.ingested"
	ActionImportApproved     = "bank_import.approved"
	ActionImportDiscarded    = "bank_import.discarded"
)

// Entry é um evento de auditoria.
type Entry struct {
	HouseholdID *uuid.UUID
	ActorID     *uuid.UUID
	Action      string
	EntityType  string
	EntityID    *uuid.UUID
	Meta        map[string]any
}

// Recorder grava eventos usando a conexão (pool ou transação) informada.
type Recorder struct {
	db auditdb.DBTX
}

// NewRecorder cria um gravador.
func NewRecorder(db auditdb.DBTX) *Recorder { return &Recorder{db: db} }

// Record grava o evento.
func (r *Recorder) Record(ctx context.Context, e Entry) error {
	return Record(ctx, r.db, e)
}

// Record grava o evento numa conexão específica (útil dentro de transações).
func Record(ctx context.Context, db auditdb.DBTX, e Entry) error {
	meta := []byte("{}")
	if len(e.Meta) > 0 {
		b, err := json.Marshal(e.Meta)
		if err != nil {
			return fmt.Errorf("serializar meta de auditoria: %w", err)
		}
		meta = b
	}
	var entityType *string
	if e.EntityType != "" {
		entityType = &e.EntityType
	}
	return auditdb.New(db).InsertAuditLog(ctx, auditdb.InsertAuditLogParams{
		HouseholdID: e.HouseholdID,
		ActorID:     e.ActorID,
		Action:      e.Action,
		EntityType:  entityType,
		EntityID:    e.EntityID,
		Meta:        meta,
	})
}

// Ptr é um atalho para obter o ponteiro de um UUID.
func Ptr(id uuid.UUID) *uuid.UUID { return &id }
