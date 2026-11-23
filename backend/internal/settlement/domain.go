// Package settlement calcula os saldos entre familiares e gerencia reembolsos
// com confirmação em duas etapas (ADR 0006 / E3-D2).
package settlement

import (
	"errors"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"financas-familia/backend/internal/expense"
)

// Erros de domínio.
var (
	ErrNotFound         = errors.New("reembolso não encontrado")
	ErrInvalidAmount    = errors.New("o valor do reembolso em centavos deve ser positivo")
	ErrSameMember       = errors.New("o pagador e o recebedor do reembolso devem ser pessoas diferentes")
	ErrInvalidMember    = errors.New("membro inválido para esta residência")
	ErrInvalidNotes     = errors.New("as observações devem ter no máximo 500 caracteres")
	ErrForbiddenCreator = errors.New("você só pode registrar reembolsos em que você pagou ou recebeu")
	ErrOnlyCreditor     = errors.New("somente quem recebeu o reembolso (credor) pode confirmá-lo")
	ErrForbiddenReject  = errors.New("somente o credor ou quem registrou o reembolso pendente pode recusá-lo")
	ErrNotPending       = errors.New("este reembolso já foi confirmado ou recusado")
)

// Status de um reembolso.
type Status string

const (
	StatusPending   Status = "pending"
	StatusConfirmed Status = "confirmed"
	StatusRejected  Status = "rejected"
)

// MemberBalance representa o saldo líquido global de um membro na casa.
// NetCents > 0 significa que o membro tem a receber; NetCents < 0 significa que deve.
type MemberBalance struct {
	UserID   uuid.UUID `json:"user_id"`
	UserName string    `json:"user_name"`
	NetCents int64     `json:"net_cents"`
}

// PairDebt representa quanto um membro deve diretamente a outro após compensar
// despesas coletivas e reembolsos confirmados entre os dois.
type PairDebt struct {
	FromUserID   uuid.UUID `json:"from_user_id"`
	FromUserName string    `json:"from_user_name"`
	ToUserID     uuid.UUID `json:"to_user_id"`
	ToUserName   string    `json:"to_user_name"`
	AmountCents  int64     `json:"amount_cents"`
}

// BalanceSummary reúne os saldos líquidos por membro e as dívidas bilaterais entre pares.
type BalanceSummary struct {
	Members  []MemberBalance `json:"members"`
	Pairwise []PairDebt      `json:"pairwise"`
}

// Settlement representa um reembolso entre dois membros.
type Settlement struct {
	ID              uuid.UUID  `json:"id"`
	HouseholdID     uuid.UUID  `json:"household_id"`
	FromUserID      uuid.UUID  `json:"from_user_id"`
	FromUserName    string     `json:"from_user_name"`
	ToUserID        uuid.UUID  `json:"to_user_id"`
	ToUserName      string     `json:"to_user_name"`
	AmountCents     int64      `json:"amount_cents"`
	Status          Status     `json:"status"`
	PaidOn          string     `json:"paid_on"` // AAAA-MM-DD
	Notes           string     `json:"notes"`
	CreatedByUserID uuid.UUID  `json:"created_by_user_id"`
	DecidedByUserID *uuid.UUID `json:"decided_by_user_id,omitempty"`
	DecidedAt       *time.Time `json:"decided_at,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
}

// CreateInput reúne os dados para registrar um reembolso.
type CreateInput struct {
	FromUserID  uuid.UUID
	ToUserID    uuid.UUID
	AmountCents int64
	PaidOn      string // AAAA-MM-DD
	Notes       string
}

// Validate sanitiza e valida os campos do reembolso.
func (in *CreateInput) Validate() (time.Time, error) {
	if in.FromUserID == uuid.Nil || in.ToUserID == uuid.Nil {
		return time.Time{}, ErrInvalidMember
	}
	if in.FromUserID == in.ToUserID {
		return time.Time{}, ErrSameMember
	}
	if in.AmountCents <= 0 || in.AmountCents > expense.MaxAmountCents {
		return time.Time{}, ErrInvalidAmount
	}
	in.Notes = strings.TrimSpace(in.Notes)
	if utf8.RuneCountInString(in.Notes) > 500 {
		return time.Time{}, ErrInvalidNotes
	}
	if expense.LooksLikeCardPAN(in.Notes) {
		return time.Time{}, expense.ErrCardPANDetected
	}
	return expense.ParseDate(in.PaidOn)
}

// DirectedTotal representa um total acumulado de A devendo/pagando a B.
type DirectedTotal struct {
	DebtorID   uuid.UUID
	CreditorID uuid.UUID
	TotalCents int64
}

// MemberRef identifica um membro ativo.
type MemberRef struct {
	ID   uuid.UUID
	Name string
}

// ComputeBalances calcula os saldos líquidos por membro e as dívidas bilaterais
// entre cada par de membros a partir das cotas de despesas coletivas e dos
// reembolsos confirmados.
func ComputeBalances(members []MemberRef, splitDebts, confirmedSettlements []DirectedTotal) BalanceSummary {
	type pairKey struct {
		a, b uuid.UUID
	}
	// raw[debtor][creditor] = quanto debtor deve a creditor
	raw := make(map[pairKey]int64)
	netByMember := make(map[uuid.UUID]int64, len(members))

	for _, d := range splitDebts {
		if d.DebtorID == d.CreditorID || d.TotalCents == 0 {
			continue
		}
		raw[pairKey{d.DebtorID, d.CreditorID}] += d.TotalCents
		netByMember[d.DebtorID] -= d.TotalCents
		netByMember[d.CreditorID] += d.TotalCents
	}
	for _, st := range confirmedSettlements {
		if st.DebtorID == st.CreditorID || st.TotalCents == 0 {
			continue
		}
		raw[pairKey{st.DebtorID, st.CreditorID}] -= st.TotalCents
		netByMember[st.DebtorID] += st.TotalCents
		netByMember[st.CreditorID] -= st.TotalCents
	}

	sortedMembers := make([]MemberRef, len(members))
	copy(sortedMembers, members)
	slices.SortFunc(sortedMembers, func(a, b MemberRef) int {
		if c := strings.Compare(a.Name, b.Name); c != 0 {
			return c
		}
		return strings.Compare(a.ID.String(), b.ID.String())
	})

	memberBalances := make([]MemberBalance, 0, len(sortedMembers))
	for _, m := range sortedMembers {
		memberBalances = append(memberBalances, MemberBalance{
			UserID:   m.ID,
			UserName: m.Name,
			NetCents: netByMember[m.ID],
		})
	}

	var pairwise []PairDebt
	for i := 0; i < len(sortedMembers); i++ {
		for j := i + 1; j < len(sortedMembers); j++ {
			m1, m2 := sortedMembers[i], sortedMembers[j]
			// Quanto m1 deve líquido a m2:
			net12 := raw[pairKey{m1.ID, m2.ID}] - raw[pairKey{m2.ID, m1.ID}]
			switch {
			case net12 > 0:
				pairwise = append(pairwise, PairDebt{
					FromUserID: m1.ID, FromUserName: m1.Name,
					ToUserID: m2.ID, ToUserName: m2.Name,
					AmountCents: net12,
				})
			case net12 < 0:
				pairwise = append(pairwise, PairDebt{
					FromUserID: m2.ID, FromUserName: m2.Name,
					ToUserID: m1.ID, ToUserName: m1.Name,
					AmountCents: -net12,
				})
			}
		}
	}
	if pairwise == nil {
		pairwise = []PairDebt{}
	}
	return BalanceSummary{Members: memberBalances, Pairwise: pairwise}
}
