package workspace

import (
	"testing"

	"github.com/google/uuid"
)

func TestCanAccess(t *testing.T) {
	hh := uuid.New()
	otherHH := uuid.New()
	userA := uuid.New()
	userB := uuid.New()

	collective := Workspace{ID: uuid.New(), HouseholdID: hh, Kind: KindHousehold}
	personalA := Workspace{ID: uuid.New(), HouseholdID: hh, Kind: KindPersonal, OwnerUserID: &userA}
	personalB := Workspace{ID: uuid.New(), HouseholdID: hh, Kind: KindPersonal, OwnerUserID: &userB}

	viewerA := Viewer{UserID: userA, HouseholdID: hh}

	if !CanAccess(viewerA, collective) {
		t.Fatal("membro deve acessar o ambiente coletivo da própria residência")
	}
	if !CanAccess(viewerA, personalA) {
		t.Fatal("usuário A deve acessar o próprio ambiente individual")
	}
	if CanAccess(viewerA, personalB) {
		t.Fatal("usuário A NÃO pode acessar o ambiente individual de B")
	}
	if CanAccess(Viewer{UserID: userA, HouseholdID: otherHH}, collective) {
		t.Fatal("usuário de outra residência NÃO pode acessar ambiente coletivo")
	}
	if CanAccess(Viewer{}, collective) {
		t.Fatal("viewer sem IDs não pode acessar nada")
	}
}
