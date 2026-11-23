package app_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"financas-familia/backend/internal/admin"
	"financas-familia/backend/internal/app"
	"financas-familia/backend/internal/identity"
	"financas-familia/backend/internal/platform/config"
	"financas-familia/backend/internal/platform/db"
	"financas-familia/backend/internal/platform/httpx"
	"financas-familia/backend/internal/platform/migrate"
)

// TestEtapa1Integration executa os cenários de aceite da Etapa 1 contra um
// PostgreSQL real com os papéis app_owner e app_rw.
// Se TEST_OWNER_DATABASE_URL e TEST_RW_DATABASE_URL não estiverem definidas,
// o teste é pulado com instrução clara.
func TestEtapa1Integration(t *testing.T) {
	ownerURL := os.Getenv("TEST_OWNER_DATABASE_URL")
	rwURL := os.Getenv("TEST_RW_DATABASE_URL")
	if ownerURL == "" || rwURL == "" {
		t.Skip("defina TEST_OWNER_DATABASE_URL e TEST_RW_DATABASE_URL para rodar o teste de integração com PostgreSQL")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	// Limpa e testa ciclo completo de migrations (Up -> Down 7x -> Up).
	for range 7 {
		_ = migrate.Down(ctx, ownerURL, io.Discard)
	}
	if err := migrate.Up(ctx, ownerURL, io.Discard); err != nil {
		t.Fatalf("migrate up (1): %v", err)
	}
	for i := 7; i >= 1; i-- {
		if err := migrate.Down(ctx, ownerURL, io.Discard); err != nil {
			t.Fatalf("migrate down (%d): %v", i, err)
		}
	}
	if err := migrate.Up(ctx, ownerURL, io.Discard); err != nil {
		t.Fatalf("migrate up (2): %v", err)
	}

	ownerPool, err := db.Connect(ctx, ownerURL)
	if err != nil {
		t.Fatalf("conectar app_owner: %v", err)
	}
	defer ownerPool.Close()

	// Limpa dados anteriores se o banco já tinha registros.
	if _, err := ownerPool.Exec(ctx, "TRUNCATE audit_log, bank_import_inbox, device_token, notification, recurring_rule_split, recurring_rule, expense_refund_split, expense_refund, settlement, expense_split, expense, installment_plan, payment_method, category, session, workspace, app_user, household CASCADE"); err != nil {
		t.Fatalf("truncate: %v", err)
	}

	rwPool, err := db.Connect(ctx, rwURL)
	if err != nil {
		t.Fatalf("conectar app_rw: %v", err)
	}
	defer rwPool.Close()

	// 1. Bootstrap da residência (limite de 4 membros).
	hh, err := admin.Bootstrap(ctx, ownerPool, "Casa Família", 4)
	if err != nil {
		t.Fatalf("Bootstrap: %v", err)
	}

	// 2. Cria 4 membros e verifica que o 5º é recusado.
	type memberCred struct {
		user identity.AdminUser
		temp string
	}
	members := make([]memberCred, 4)
	names := []string{"Ana", "Bruno", "Carla", "Diego"}
	emails := []string{"ana@familia.local", "bruno@familia.local", "carla@familia.local", "diego@familia.local"}
	for i := range 4 {
		u, temp, err := admin.AddUser(ctx, ownerPool, names[i], emails[i])
		if err != nil {
			t.Fatalf("AddUser %d: %v", i, err)
		}
		members[i] = memberCred{user: u, temp: temp}
	}
	if _, _, err := admin.AddUser(ctx, ownerPool, "Extra", "extra@familia.local"); err != admin.ErrMemberLimit {
		t.Fatalf("5º membro deveria retornar ErrMemberLimit, obteve %v", err)
	}

	// Sobe o servidor HTTP da API conectado com app_rw (não é dono das tabelas!).
	cfg := config.Config{
		DatabaseURL:    rwURL,
		HTTPAddr:       ":0",
		AllowedOrigins: []string{"http://localhost:5173"},
		CookieSecure:   false,
		SessionTTL:     24 * time.Hour,
		SessionIdleTTL: 2 * time.Hour,
	}
	srv := httptest.NewServer(app.New(cfg, rwPool).Handler)
	defer srv.Close()

	// 3. Health / Readyz.
	resp := doReq(t, srv.URL, http.MethodGet, "/readyz", nil, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("/readyz = %d, queria 200", resp.StatusCode)
	}

	// 4. Sem sessão, rotas protegidas retornam 401.
	resp = doReq(t, srv.URL, http.MethodGet, "/api/v1/workspaces", nil, nil)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("GET /workspaces sem sessão = %d, queria 401", resp.StatusCode)
	}

	// 5. Login de Ana com senha temporária -> must_change_password = true.
	anaCookie := login(t, srv.URL, emails[0], members[0].temp)

	// Enquanto não trocar a senha, rotas de negócio retornam 403.
	resp = doReq(t, srv.URL, http.MethodGet, "/api/v1/workspaces", nil, anaCookie)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("GET /workspaces com senha temporária = %d, queria 403", resp.StatusCode)
	}

	// Troca de senha de Ana.
	anaNewPass := "AnaSenhaDefinitiva#2026"
	resp = doReq(t, srv.URL, http.MethodPost, "/api/v1/auth/password", map[string]string{
		"current_password": members[0].temp,
		"new_password":     anaNewPass,
	}, anaCookie)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("POST /auth/password Ana = %d, queria 204", resp.StatusCode)
	}

	// Login e troca de senha de Bruno.
	brunoCookie := login(t, srv.URL, emails[1], members[1].temp)
	brunoNewPass := "BrunoSenhaDefinitiva#2026"
	resp = doReq(t, srv.URL, http.MethodPost, "/api/v1/auth/password", map[string]string{
		"current_password": members[1].temp,
		"new_password":     brunoNewPass,
	}, brunoCookie)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("POST /auth/password Bruno = %d, queria 204", resp.StatusCode)
	}

	// 6. Ambientes de Ana e Bruno.
	anaWorkspaces := listWorkspaces(t, srv.URL, anaCookie)
	brunoWorkspaces := listWorkspaces(t, srv.URL, brunoCookie)
	if len(anaWorkspaces) != 2 || len(brunoWorkspaces) != 2 {
		t.Fatalf("esperava 2 ambientes para cada um (coletivo + individual), obteve Ana=%d Bruno=%d",
			len(anaWorkspaces), len(brunoWorkspaces))
	}

	var brunoPersonalID, collectiveID uuid.UUID
	for _, w := range brunoWorkspaces {
		switch w.Kind {
		case "personal":
			brunoPersonalID = w.ID
		case "household":
			collectiveID = w.ID
		}
	}
	if brunoPersonalID == uuid.Nil || collectiveID == uuid.Nil {
		t.Fatal("IDs de ambiente de Bruno não encontrados")
	}

	// Ana acessa o ambiente coletivo -> 200.
	resp = doReq(t, srv.URL, http.MethodGet, "/api/v1/workspaces/"+collectiveID.String(), nil, anaCookie)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("Ana acessando coletivo = %d, queria 200", resp.StatusCode)
	}

	// 7. ISOLAMENTO CRUZADO VIA API: Ana tenta acessar o ambiente individual de Bruno -> 404.
	resp = doReq(t, srv.URL, http.MethodGet, "/api/v1/workspaces/"+brunoPersonalID.String(), nil, anaCookie)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("Ana acessando ambiente individual de Bruno = %d, queria 404", resp.StatusCode)
	}

	// 8. ISOLAMENTO CRUZADO VIA RLS DIRETO NO BANCO (defesa em profundidade):
	// Mesmo executando SELECT direto na tabela workspace como app_rw com app.user_id = Ana,
	// o PostgreSQL NÃO pode retornar o ambiente individual de Bruno.
	var count int
	err = db.WithUserTx(ctx, rwPool, members[0].user.ID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, "SELECT count(*) FROM workspace WHERE id = $1", brunoPersonalID).Scan(&count)
	})
	if err != nil {
		t.Fatalf("query RLS direta: %v", err)
	}
	if count != 0 {
		t.Fatalf("FALHA DE RLS: query direta com app.user_id=Ana enxergou o ambiente individual de Bruno (count=%d)", count)
	}

	// 9. Bloqueio após 5 tentativas de senha errada para Carla (usando outro IP simulado ou serviço direto).
	idSvc := app.New(cfg, rwPool).Identity
	for i := 1; i <= 5; i++ {
		if _, err := idSvc.Login(ctx, emails[2], "senha-errada-123"); err != identity.ErrInvalidCredentials {
			t.Fatalf("tentativa falha %d deveria retornar ErrInvalidCredentials, obteve %v", i, err)
		}
	}
	// Na 6ª tentativa, mesmo com a senha temporária CORRETA, a conta está bloqueada.
	if _, err := idSvc.Login(ctx, emails[2], members[2].temp); err != identity.ErrInvalidCredentials {
		t.Fatalf("login com conta bloqueada deveria retornar ErrInvalidCredentials, obteve %v", err)
	}

	// =========================================================================
	// ETAPA 2: Categorias, Meios de Pagamento, Despesas e Compartilhamento
	// =========================================================================

	// 10. As 8 categorias padrão (E2-D2) já existem após o Bootstrap.
	resp = doReq(t, srv.URL, http.MethodGet, "/api/v1/categories", nil, anaCookie)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /categories = %d, queria 200", resp.StatusCode)
	}
	var catList struct {
		Items []struct {
			ID   uuid.UUID `json:"id"`
			Name string    `json:"name"`
		} `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&catList); err != nil {
		t.Fatalf("decode categories: %v", err)
	}
	resp.Body.Close()
	if len(catList.Items) != 8 {
		t.Fatalf("esperava 8 categorias padrão (E2-D2), obteve %d", len(catList.Items))
	}
	catID := catList.Items[0].ID

	// 11. Bruno cria um meio de pagamento PESSOAL (cartão final 4321); last4 inválido em PIX dá 422.
	resp = doReq(t, srv.URL, http.MethodPost, "/api/v1/payment-methods", map[string]any{
		"name":        "PIX com last4 indevido",
		"kind":        "pix",
		"last4":       "1234",
		"is_personal": false,
	}, brunoCookie)
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("PIX com last4 = %d, queria 422", resp.StatusCode)
	}

	resp = doReq(t, srv.URL, http.MethodPost, "/api/v1/payment-methods", map[string]any{
		"name":        "Nubank Bruno",
		"kind":        "credit_card",
		"last4":       "4321",
		"is_personal": true,
	}, brunoCookie)
	if resp.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("criar cartão pessoal Bruno = %d: %s", resp.StatusCode, string(b))
	}
	var brunoCard struct {
		ID uuid.UUID `json:"id"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&brunoCard)
	resp.Body.Close()

	// Ana NÃO enxerga o cartão pessoal de Bruno (nem via API nem via RLS).
	resp = doReq(t, srv.URL, http.MethodGet, "/api/v1/payment-methods", nil, anaCookie)
	var anaPMs struct {
		Items []struct {
			ID uuid.UUID `json:"id"`
		} `json:"items"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&anaPMs)
	resp.Body.Close()
	if len(anaPMs.Items) != 0 {
		t.Fatalf("Ana não deveria ver meio de pagamento pessoal de Bruno, viu %d", len(anaPMs.Items))
	}

	// 12. Rejeição de PAN completo na descrição da despesa (422).
	resp = doReq(t, srv.URL, http.MethodPost, "/api/v1/workspaces/"+brunoPersonalID.String()+"/expenses", map[string]any{
		"category_id":  catID,
		"amount_cents": 5000,
		"description":  "Cartão 4532 1122 3344 5566",
		"incurred_on":  "2026-11-23",
	}, brunoCookie)
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("despesa com PAN na descrição = %d, queria 422", resp.StatusCode)
	}

	// 13. Bruno cria uma despesa de R$ 150,00 (15000 centavos) no seu ambiente INDIVIDUAL.
	resp = doReq(t, srv.URL, http.MethodPost, "/api/v1/workspaces/"+brunoPersonalID.String()+"/expenses", map[string]any{
		"category_id":       catID,
		"payment_method_id": brunoCard.ID,
		"amount_cents":      15000,
		"description":       "Presente surpresa",
		"incurred_on":       "2026-11-23",
		"notes":             "Compra pessoal",
	}, brunoCookie)
	if resp.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("criar despesa individual Bruno = %d: %s", resp.StatusCode, string(b))
	}
	var brunoExp struct {
		ID          uuid.UUID `json:"id"`
		WorkspaceID uuid.UUID `json:"workspace_id"`
		AmountCents int64     `json:"amount_cents"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&brunoExp)
	resp.Body.Close()

	// 14. ISOLAMENTO DE DESPESA INDIVIDUAL (API + RLS direto no banco):
	// Ana tenta ler, listar, editar, excluir ou compartilhar a despesa individual de Bruno -> 404.
	for _, act := range []struct {
		method string
		path   string
		body   any
	}{
		{http.MethodGet, "/api/v1/workspaces/" + brunoPersonalID.String() + "/expenses", nil},
		{http.MethodGet, "/api/v1/expenses/" + brunoExp.ID.String(), nil},
		{http.MethodDelete, "/api/v1/expenses/" + brunoExp.ID.String(), nil},
		{http.MethodPost, "/api/v1/expenses/" + brunoExp.ID.String() + "/share-with-household", nil},
	} {
		r := doReq(t, srv.URL, act.method, act.path, act.body, anaCookie)
		if r.StatusCode != http.StatusNotFound {
			t.Fatalf("Ana %s %s = %d, queria 404", act.method, act.path, r.StatusCode)
		}
	}

	// Query SQL direta na tabela expense como app_rw com app.user_id = Ana -> 0 linhas (RLS FORCE).
	var expCount int
	err = db.WithUserTx(ctx, rwPool, members[0].user.ID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, "SELECT count(*) FROM expense WHERE id = $1", brunoExp.ID).Scan(&expCount)
	})
	if err != nil {
		t.Fatalf("query RLS expense: %v", err)
	}
	if expCount != 0 {
		t.Fatalf("FALHA DE RLS EM EXPENSE: query direta com app.user_id=Ana enxergou despesa individual de Bruno (count=%d)", expCount)
	}

	// 15. Bruno compartilha a despesa individual com a casa.
	resp = doReq(t, srv.URL, http.MethodPost, "/api/v1/expenses/"+brunoExp.ID.String()+"/share-with-household", nil, brunoCookie)
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("Bruno compartilhar despesa = %d: %s", resp.StatusCode, string(b))
	}
	resp.Body.Close()

	// Agora a despesa aparece para Ana no ambiente coletivo, com total_cents = 15000.
	resp = doReq(t, srv.URL, http.MethodGet, "/api/v1/workspaces/"+collectiveID.String()+"/expenses", nil, anaCookie)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("Ana listar despesas coletivas = %d", resp.StatusCode)
	}
	var colExps struct {
		Items      []map[string]any `json:"items"`
		TotalCents int64            `json:"total_cents"`
		Count      int              `json:"count"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&colExps)
	resp.Body.Close()
	if colExps.Count != 1 || colExps.TotalCents != 15000 {
		t.Fatalf("esperava 1 despesa coletiva somando 15000 centavos, obteve count=%d total=%d", colExps.Count, colExps.TotalCents)
	}

	// 16. Conforme E2-D1, Ana pode editar a despesa no ambiente coletivo.
	resp = doReq(t, srv.URL, http.MethodPatch, "/api/v1/expenses/"+brunoExp.ID.String(), map[string]any{
		"category_id":     catID,
		"paid_by_user_id": members[1].user.ID,
		"amount_cents":    16000,
		"description":     "Supermercado da família (ajustado)",
		"incurred_on":     "2026-11-23",
		"notes":           "Incluído pão",
	}, anaCookie)
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("Ana editar despesa coletiva (E2-D1) = %d: %s", resp.StatusCode, string(b))
	}
	resp.Body.Close()

	// =========================================================================
	// ETAPA 3: Divisões Determinísticas (E3-D1), Saldos e Reembolsos (E3-D2)
	// =========================================================================

	// 17. Divisão exact com soma errada retorna 422.
	resp = doReq(t, srv.URL, http.MethodPost, "/api/v1/workspaces/"+collectiveID.String()+"/expenses", map[string]any{
		"category_id":     catID,
		"paid_by_user_id": members[1].user.ID,
		"amount_cents":    10000,
		"description":     "Divisão inválida",
		"incurred_on":     "2026-11-23",
		"split_strategy":  "exact",
		"splits": []map[string]any{
			{"user_id": members[0].user.ID, "share_cents": 5000},
			{"user_id": members[1].user.ID, "share_cents": 4000},
		},
	}, brunoCookie)
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("divisão exact inválida = %d, queria 422", resp.StatusCode)
	}

	// 18. Despesa coletiva de 10000 centavos (R$ 100,00) paga por Bruno e dividida
	// igualmente entre Ana, Bruno e Carla (3 membros).
	// E3-D1: Bruno (pagador) absorve o 1 centavo de resto -> Bruno=3334, Ana=3333, Carla=3333.
	resp = doReq(t, srv.URL, http.MethodPost, "/api/v1/workspaces/"+collectiveID.String()+"/expenses", map[string]any{
		"category_id":     catID,
		"paid_by_user_id": members[1].user.ID,
		"amount_cents":    10000,
		"description":     "Jantar de domingo",
		"incurred_on":     "2026-11-23",
		"split_strategy":  "equal",
		"splits": []map[string]any{
			{"user_id": members[0].user.ID},
			{"user_id": members[1].user.ID},
			{"user_id": members[2].user.ID},
		},
	}, brunoCookie)
	if resp.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("criar despesa dividida por 3 = %d: %s", resp.StatusCode, string(b))
	}
	var splitExp struct {
		ID     uuid.UUID `json:"id"`
		Splits []struct {
			UserID     uuid.UUID `json:"user_id"`
			ShareCents int64     `json:"share_cents"`
		} `json:"splits"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&splitExp)
	resp.Body.Close()

	var sumShares int64
	sharesByUser := make(map[uuid.UUID]int64)
	for _, s := range splitExp.Splits {
		sumShares += s.ShareCents
		sharesByUser[s.UserID] = s.ShareCents
	}
	if sumShares != 10000 || sharesByUser[members[1].user.ID] != 3334 || sharesByUser[members[0].user.ID] != 3333 {
		t.Fatalf("rateio E3-D1 incorreto: sum=%d shares=%v", sumShares, sharesByUser)
	}

	// 19. Verifica o saldo de Ana com Bruno em GET /api/v1/balances:
	// Despesa 1 (16000 / 4 membros = 4000 para Ana, pago por Bruno)
	// Despesa 2 (10000 / 3 membros = 3333 para Ana, pago por Bruno)
	// Total que Ana deve a Bruno = 4000 + 3333 = 7333 centavos.
	if debt := getPairDebt(t, srv.URL, anaCookie, members[0].user.ID, members[1].user.ID); debt != 7333 {
		t.Fatalf("dívida de Ana para Bruno = %d, queria 7333", debt)
	}

	// 20. Fluxo de reembolso E3-D2:
	// Ana (devedora) registra reembolso de 3333 centavos para Bruno (credor) -> status = pending.
	resp = doReq(t, srv.URL, http.MethodPost, "/api/v1/settlements", map[string]any{
		"from_user_id": members[0].user.ID,
		"to_user_id":   members[1].user.ID,
		"amount_cents": 3333,
		"paid_on":      "2026-11-23",
		"notes":        "PIX referente ao jantar",
	}, anaCookie)
	if resp.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("Ana criar reembolso = %d: %s", resp.StatusCode, string(b))
	}
	var stCreated struct {
		ID     uuid.UUID `json:"id"`
		Status string    `json:"status"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&stCreated)
	resp.Body.Close()
	if stCreated.Status != "pending" {
		t.Fatalf("reembolso criado pelo devedor deveria nascer pending, nasceu %q", stCreated.Status)
	}

	// Enquanto pending, a dívida continua 7333.
	if debt := getPairDebt(t, srv.URL, anaCookie, members[0].user.ID, members[1].user.ID); debt != 7333 {
		t.Fatalf("dívida com reembolso pendente = %d, queria 7333", debt)
	}

	// Ana (devedora) tenta confirmar o próprio reembolso -> 403 Forbidden.
	resp = doReq(t, srv.URL, http.MethodPost, "/api/v1/settlements/"+stCreated.ID.String()+"/confirm", nil, anaCookie)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("devedora confirmando próprio reembolso = %d, queria 403", resp.StatusCode)
	}

	// Bruno (credor) confirma o recebimento -> 200 OK (confirmed).
	resp = doReq(t, srv.URL, http.MethodPost, "/api/v1/settlements/"+stCreated.ID.String()+"/confirm", nil, brunoCookie)
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("Bruno confirmar reembolso = %d: %s", resp.StatusCode, string(b))
	}
	resp.Body.Close()

	// Agora a dívida de Ana com Bruno cai de 7333 para 4000 centavos!
	if debt := getPairDebt(t, srv.URL, anaCookie, members[0].user.ID, members[1].user.ID); debt != 4000 {
		t.Fatalf("dívida após confirmação de reembolso = %d, queria 4000", debt)
	}

	// =========================================================================
	// ETAPA 4: Parcelamentos (E4-D1 / E4-D2) e Estornos Proporcionais
	// =========================================================================

	// 21. Estorno parcial de 4000 centavos (R$ 40,00) na despesa coletiva brunoExp (16000 centavos, 4 membros).
	// Tentativa de estornar 20000 (> 16000) dá 422.
	resp = doReq(t, srv.URL, http.MethodPost, "/api/v1/expenses/"+brunoExp.ID.String()+"/refunds", map[string]any{
		"amount_cents": 20000,
		"refunded_on":  "2026-11-24",
		"reason":       "Acima do valor",
	}, brunoCookie)
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("estorno acima do saldo = %d, queria 422", resp.StatusCode)
	}

	resp = doReq(t, srv.URL, http.MethodPost, "/api/v1/expenses/"+brunoExp.ID.String()+"/refunds", map[string]any{
		"amount_cents": 4000,
		"refunded_on":  "2026-11-24",
		"reason":       "Produto devolvido",
	}, brunoCookie)
	if resp.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("criar estorno parcial = %d: %s", resp.StatusCode, string(b))
	}
	var refundedExp struct {
		RefundedCents  int64 `json:"refunded_cents"`
		NetAmountCents int64 `json:"net_amount_cents"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&refundedExp)
	resp.Body.Close()
	if refundedExp.RefundedCents != 4000 || refundedExp.NetAmountCents != 12000 {
		t.Fatalf("esperava refunded=4000 net=12000, obteve %+v", refundedExp)
	}

	// O estorno de 4000 dividido entre os 4 membros credita 1000 para Ana -> dívida de Ana com Bruno cai de 4000 para 3000!
	if debt := getPairDebt(t, srv.URL, anaCookie, members[0].user.ID, members[1].user.ID); debt != 3000 {
		t.Fatalf("dívida após estorno coletivo = %d, queria 3000", debt)
	}

	// 22. Compra parcelada de 10000 centavos (R$ 100,00) em 3x no ambiente individual de Bruno.
	resp = doReq(t, srv.URL, http.MethodPost, "/api/v1/workspaces/"+brunoPersonalID.String()+"/expenses", map[string]any{
		"category_id":        catID,
		"payment_method_id":  brunoCard.ID,
		"amount_cents":       10000,
		"description":        "Fone Bluetooth 3x",
		"incurred_on":        "2026-11-10",
		"total_installments": 3,
	}, brunoCookie)
	if resp.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("criar compra parcelada 3x = %d: %s", resp.StatusCode, string(b))
	}
	var firstInst struct {
		ID                uuid.UUID  `json:"id"`
		AmountCents       int64      `json:"amount_cents"`
		InstallmentPlanID *uuid.UUID `json:"installment_plan_id"`
		InstallmentNumber *int32     `json:"installment_number"`
		TotalInstallments *int32     `json:"total_installments"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&firstInst)
	resp.Body.Close()
	if firstInst.InstallmentPlanID == nil || firstInst.AmountCents != 3334 {
		t.Fatalf("1ª parcela deveria ter plan_id e 3334 centavos, obteve %+v", firstInst)
	}

	// Verifica que as 3 parcelas estão no ambiente individual de Bruno somando 10000 centavos.
	resp = doReq(t, srv.URL, http.MethodGet, "/api/v1/workspaces/"+brunoPersonalID.String()+"/expenses", nil, brunoCookie)
	var brunoList struct {
		TotalCents int64 `json:"total_cents"`
		Count      int   `json:"count"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&brunoList)
	resp.Body.Close()
	if brunoList.Count != 3 || brunoList.TotalCents != 10000 {
		t.Fatalf("esperava 3 parcelas somando 10000 no ambiente individual de Bruno, obteve %+v", brunoList)
	}

	// Ana tenta excluir o parcelamento individual de Bruno -> 404.
	resp = doReq(t, srv.URL, http.MethodDelete, "/api/v1/installment-plans/"+firstInst.InstallmentPlanID.String(), nil, anaCookie)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("Ana excluindo parcelamento individual de Bruno = %d, queria 404", resp.StatusCode)
	}

	// Bruno exclui o parcelamento inteiro de uma vez (E4-D2) -> 204.
	resp = doReq(t, srv.URL, http.MethodDelete, "/api/v1/installment-plans/"+firstInst.InstallmentPlanID.String(), nil, brunoCookie)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("Bruno excluindo parcelamento inteiro = %d, queria 204", resp.StatusCode)
	}

	// =========================================================================
	// ETAPA 5: Despesas Recorrentes e Assinaturas Mensais (E5-D1 / E5-D2)
	// =========================================================================

	// 23. Bruno cadastra uma assinatura mensal privada ("Spotify Individual", R$ 21,90) no seu ambiente individual.
	resp = doReq(t, srv.URL, http.MethodPost, "/api/v1/workspaces/"+brunoPersonalID.String()+"/recurring-rules", map[string]any{
		"category_id":       catID,
		"payment_method_id": brunoCard.ID,
		"amount_cents":      2190,
		"description":       "Assinatura Spotify Individual",
		"frequency":         "monthly",
		"start_date":        "2026-10-15",
		"notes":             "Assinatura mensal no cartão",
	}, brunoCookie)
	if resp.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("criar assinatura recorrente Bruno = %d: %s", resp.StatusCode, string(b))
	}
	var brunoRec struct {
		ID          uuid.UUID `json:"id"`
		NextDueDate string    `json:"next_due_date"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&brunoRec)
	resp.Body.Close()

	// Ana tenta acessar/gerar/excluir a recorrência individual de Bruno -> 404.
	resp = doReq(t, srv.URL, http.MethodGet, "/api/v1/workspaces/"+brunoPersonalID.String()+"/recurring-rules", nil, anaCookie)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("Ana listando recorrências individuais de Bruno = %d, queria 404", resp.StatusCode)
	}
	resp = doReq(t, srv.URL, http.MethodDelete, "/api/v1/recurring-rules/"+brunoRec.ID.String(), nil, anaCookie)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("Ana excluindo recorrência individual de Bruno = %d, queria 404", resp.StatusCode)
	}

	// 24. Bruno materializa as ocorrências até 2026-11-30 -> gera 2026-10 e 2026-11 (2 lançamentos).
	resp = doReq(t, srv.URL, http.MethodPost, "/api/v1/workspaces/"+brunoPersonalID.String()+"/recurring-rules/generate", map[string]any{
		"up_to_date": "2026-11-30",
	}, brunoCookie)
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("Bruno gerar recorrências = %d: %s", resp.StatusCode, string(b))
	}
	var genRes1 struct {
		GeneratedCount int `json:"generated_count"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&genRes1)
	resp.Body.Close()
	if genRes1.GeneratedCount != 2 {
		t.Fatalf("esperava 2 ocorrências geradas (out e nov), obteve %d", genRes1.GeneratedCount)
	}

	// Idempotência: chamar novamente para o mesmo período gera 0 ocorrências!
	resp = doReq(t, srv.URL, http.MethodPost, "/api/v1/workspaces/"+brunoPersonalID.String()+"/recurring-rules/generate", map[string]any{
		"up_to_date": "2026-11-30",
	}, brunoCookie)
	var genRes2 struct {
		GeneratedCount int `json:"generated_count"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&genRes2)
	resp.Body.Close()
	if genRes2.GeneratedCount != 0 {
		t.Fatalf("2ª geração idempotente deveria gerar 0, gerou %d", genRes2.GeneratedCount)
	}

	// =========================================================================
	// ETAPA 6: Notificações Internas com RLS por Destinatário (E6-D1 / E6-D2)
	// =========================================================================

	// 25. Bruno lista suas recorrências (dispara alerta deduplicado de vencimento se aplicável)
	// e consulta sua caixa de entrada (deve conter settlement_pending enviado por Ana).
	resp = doReq(t, srv.URL, http.MethodGet, "/api/v1/notifications", nil, brunoCookie)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("Bruno GET /notifications = %d", resp.StatusCode)
	}
	var brunoNotifs struct {
		Items []struct {
			ID   uuid.UUID `json:"id"`
			Kind string    `json:"kind"`
		} `json:"items"`
		UnreadCount int64 `json:"unread_count"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&brunoNotifs)
	resp.Body.Close()
	if len(brunoNotifs.Items) == 0 || brunoNotifs.UnreadCount == 0 {
		t.Fatalf("Bruno deveria ter notificações não lidas, obteve %+v", brunoNotifs)
	}
	brunoNotifID := brunoNotifs.Items[0].ID

	// 26. ISOLAMENTO DE NOTIFICAÇÕES (API + RLS direto no banco):
	// Ana tenta marcar como lida uma notificação de Bruno -> 404.
	resp = doReq(t, srv.URL, http.MethodPost, "/api/v1/notifications/"+brunoNotifID.String()+"/read", nil, anaCookie)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("Ana marcando notificação de Bruno como lida = %d, queria 404", resp.StatusCode)
	}

	// Query SQL direta na tabela notification como app_rw com app.user_id = Ana -> 0 linhas para notificações de Bruno.
	var notifLeak int
	err = db.WithUserTx(ctx, rwPool, members[0].user.ID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, "SELECT count(*) FROM notification WHERE id = $1", brunoNotifID).Scan(&notifLeak)
	})
	if err != nil {
		t.Fatalf("query RLS notification: %v", err)
	}
	if notifLeak != 0 {
		t.Fatalf("FALHA DE RLS EM NOTIFICATION: Ana enxergou notificação de Bruno (count=%d)", notifLeak)
	}

	// 27. Ana consulta suas notificações (deve ter collective_expense_added e settlement_confirmed) e marca todas como lidas.
	resp = doReq(t, srv.URL, http.MethodGet, "/api/v1/notifications", nil, anaCookie)
	var anaNotifs struct {
		UnreadCount int64 `json:"unread_count"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&anaNotifs)
	resp.Body.Close()
	if anaNotifs.UnreadCount < 2 {
		t.Fatalf("Ana deveria ter pelo menos 2 notificações não lidas, tem %d", anaNotifs.UnreadCount)
	}

	resp = doReq(t, srv.URL, http.MethodPost, "/api/v1/notifications/read-all", nil, anaCookie)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("Ana POST /notifications/read-all = %d", resp.StatusCode)
	}
	resp.Body.Close()

	resp = doReq(t, srv.URL, http.MethodGet, "/api/v1/notifications", nil, anaCookie)
	_ = json.NewDecoder(resp.Body).Decode(&anaNotifs)
	resp.Body.Close()
	if anaNotifs.UnreadCount != 0 {
		t.Fatalf("após read-all, unread_count de Ana deveria ser 0, é %d", anaNotifs.UnreadCount)
	}

	// =========================================================================
	// ETAPA 7: Relatórios Mensais e Exportação CSV / PDF (E7-D1 / E7-D2)
	// =========================================================================

	// 28. Isolamento de relatórios individuais: Ana tenta acessar resumo, CSV ou PDF do ambiente individual de Bruno -> 404.
	for _, suffix := range []string{"/reports/summary", "/reports/export.csv", "/reports/export.pdf"} {
		r := doReq(t, srv.URL, http.MethodGet, "/api/v1/workspaces/"+brunoPersonalID.String()+suffix+"?from=2026-11-01&to=2026-11-30", nil, anaCookie)
		if r.StatusCode != http.StatusNotFound {
			t.Fatalf("Ana acessando %s individual de Bruno = %d, queria 404", suffix, r.StatusCode)
		}
	}

	// 29. Resumo do ambiente coletivo em novembro/2026:
	// Despesa 1: 16000 bruto - 4000 estornado = 12000 líquido
	// Despesa 2: 10000 líquido
	// Total líquido coletivo = 22000 centavos.
	resp = doReq(t, srv.URL, http.MethodGet, "/api/v1/workspaces/"+collectiveID.String()+"/reports/summary?from=2026-11-01&to=2026-11-30", nil, anaCookie)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /reports/summary coletivo = %d", resp.StatusCode)
	}
	var repSum struct {
		TotalGrossCents    int64 `json:"total_gross_cents"`
		TotalRefundedCents int64 `json:"total_refunded_cents"`
		TotalNetCents      int64 `json:"total_net_cents"`
		ExpenseCount       int   `json:"expense_count"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&repSum)
	resp.Body.Close()
	if repSum.TotalGrossCents != 26000 || repSum.TotalRefundedCents != 4000 || repSum.TotalNetCents != 22000 || repSum.ExpenseCount != 2 {
		t.Fatalf("relatório coletivo inesperado: %+v", repSum)
	}

	// 30. Exportação CSV e PDF do ambiente coletivo.
	resp = doReq(t, srv.URL, http.MethodGet, "/api/v1/workspaces/"+collectiveID.String()+"/reports/export.csv?from=2026-11-01&to=2026-11-30", nil, anaCookie)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /reports/export.csv = %d", resp.StatusCode)
	}
	csvBody, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if !bytes.HasPrefix(csvBody, []byte("\xEF\xBB\xBFdata;descricao;")) {
		t.Fatalf("CSV sem cabeçalho/BOM esperado: %q", string(csvBody[:min(len(csvBody), 40)]))
	}

	resp = doReq(t, srv.URL, http.MethodGet, "/api/v1/workspaces/"+collectiveID.String()+"/reports/export.pdf?from=2026-11-01&to=2026-11-30", nil, anaCookie)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /reports/export.pdf = %d", resp.StatusCode)
	}
	pdfBody, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if !bytes.HasPrefix(pdfBody, []byte("%PDF-1.4\n")) {
		t.Fatal("export.pdf não retornou cabeçalho %PDF-1.4")
	}

	// =========================================================================
	// ETAPA 8: App Android (Token de Dispositivo, Parser e Fila com RLS)
	// =========================================================================

	// 31. Bruno gera um token para seu celular Android.
	resp = doReq(t, srv.URL, http.MethodPost, "/api/v1/devices", map[string]any{
		"device_name": "Pixel 8 Bruno",
	}, brunoCookie)
	if resp.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("Bruno criar device token = %d: %s", resp.StatusCode, string(b))
	}
	var devCreated struct {
		Device struct {
			ID uuid.UUID `json:"id"`
		} `json:"device"`
		PlainToken string `json:"plain_token"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&devCreated)
	resp.Body.Close()

	// 32. Ingestão de notificação bancária do Nubank via Bearer device_token.
	ingestBody, _ := json.Marshal(map[string]any{
		"package_name": "com.nu.production",
		"title":        "Compra no crédito aprovada",
		"text":         "Compra de R$ 49,90 aprovada em Padaria Real para o cartão com final 4321",
		"occurred_on":  "2026-11-23",
		"external_id":  "notif-001",
	})
	ingestReq, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/v1/ingest/bank-notification", bytes.NewReader(ingestBody))
	ingestReq.Header.Set("Content-Type", "application/json")
	ingestReq.Header.Set(httpx.CSRFHeader, "AndroidApp")
	ingestReq.Header.Set("Authorization", "Bearer "+devCreated.PlainToken)
	resp, err = http.DefaultClient.Do(ingestReq)
	if err != nil || resp.StatusCode != http.StatusCreated {
		t.Fatalf("ingest bank notification = %v status=%d", err, resp.StatusCode)
	}
	var importedItem struct {
		ID                uuid.UUID `json:"id"`
		BankCode          string    `json:"bank_code"`
		ParseStatus       string    `json:"parse_status"`
		ParsedAmountCents *int64    `json:"parsed_amount_cents"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&importedItem)
	resp.Body.Close()
	if importedItem.BankCode != "nubank" || importedItem.ParseStatus != "parsed" || importedItem.ParsedAmountCents == nil || *importedItem.ParsedAmountCents != 4990 {
		t.Fatalf("notificação Nubank mal interpretada: %+v", importedItem)
	}

	// 33. ISOLAMENTO DA FILA DE IMPORTAÇÃO (API + RLS direto no banco):
	// Ana tenta aprovar ou descartar o item de Bruno -> 404.
	resp = doReq(t, srv.URL, http.MethodPost, "/api/v1/imports/"+importedItem.ID.String()+"/discard", nil, anaCookie)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("Ana descartando import de Bruno = %d, queria 404", resp.StatusCode)
	}
	var importLeak int
	err = db.WithUserTx(ctx, rwPool, members[0].user.ID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, "SELECT count(*) FROM bank_import_inbox WHERE id = $1", importedItem.ID).Scan(&importLeak)
	})
	if err != nil {
		t.Fatalf("query RLS bank_import_inbox: %v", err)
	}
	if importLeak != 0 {
		t.Fatalf("FALHA DE RLS EM BANK_IMPORT_INBOX: Ana enxergou item de Bruno (count=%d)", importLeak)
	}

	// 34. Bruno aprova a notificação para o seu ambiente individual privado.
	resp = doReq(t, srv.URL, http.MethodPost, "/api/v1/imports/"+importedItem.ID.String()+"/approve", map[string]any{
		"workspace_id": brunoPersonalID,
		"category_id":  catID,
	}, brunoCookie)
	if resp.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("Bruno aprovar import = %d: %s", resp.StatusCode, string(b))
	}
	resp.Body.Close()

	// 35. Bruno revoga o token do dispositivo -> novo envio com aquele token retorna 401.
	resp = doReq(t, srv.URL, http.MethodDelete, "/api/v1/devices/"+devCreated.Device.ID.String(), nil, brunoCookie)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("Bruno revogar device = %d", resp.StatusCode)
	}
	resp.Body.Close()

	ingestReq2, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/v1/ingest/bank-notification", bytes.NewReader(ingestBody))
	ingestReq2.Header.Set("Content-Type", "application/json")
	ingestReq2.Header.Set(httpx.CSRFHeader, "AndroidApp")
	ingestReq2.Header.Set("Authorization", "Bearer "+devCreated.PlainToken)
	resp, err = http.DefaultClient.Do(ingestReq2)
	if err != nil || resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("ingest com token revogado deveria dar 401, deu %d", resp.StatusCode)
	}
	resp.Body.Close()

	_ = hh
}

func getPairDebt(t *testing.T, baseURL string, cookie *http.Cookie, fromID, toID uuid.UUID) int64 {
	t.Helper()
	resp := doReq(t, baseURL, http.MethodGet, "/api/v1/balances", nil, cookie)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /balances = %d", resp.StatusCode)
	}
	defer resp.Body.Close()
	var sum struct {
		Pairwise []struct {
			FromUserID  uuid.UUID `json:"from_user_id"`
			ToUserID    uuid.UUID `json:"to_user_id"`
			AmountCents int64     `json:"amount_cents"`
		} `json:"pairwise"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&sum); err != nil {
		t.Fatalf("decode balances: %v", err)
	}
	for _, p := range sum.Pairwise {
		if p.FromUserID == fromID && p.ToUserID == toID {
			return p.AmountCents
		}
	}
	return 0
}

type wsItem struct {
	ID     uuid.UUID `json:"id"`
	Kind   string    `json:"kind"`
	IsMine bool      `json:"is_mine"`
}

func listWorkspaces(t *testing.T, baseURL string, cookie *http.Cookie) []wsItem {
	t.Helper()
	resp := doReq(t, baseURL, http.MethodGet, "/api/v1/workspaces", nil, cookie)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /workspaces = %d", resp.StatusCode)
	}
	defer resp.Body.Close()
	var out struct {
		Items []wsItem `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decode workspaces: %v", err)
	}
	return out.Items
}

func login(t *testing.T, baseURL, email, password string) *http.Cookie {
	t.Helper()
	resp := doReq(t, baseURL, http.MethodPost, "/api/v1/auth/login", map[string]string{
		"email":    email,
		"password": password,
	}, nil)
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("POST /auth/login (%s) = %d: %s", email, resp.StatusCode, string(b))
	}
	for _, c := range resp.Cookies() {
		if c.Name == identity.CookieName {
			return c
		}
	}
	t.Fatal("cookie de sessão não retornado no login")
	return nil
}

func doReq(t *testing.T, baseURL, method, path string, body any, cookie *http.Cookie) *http.Response {
	t.Helper()
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, baseURL+path, rdr)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if method != http.MethodGet && method != http.MethodHead {
		req.Header.Set(httpx.CSRFHeader, "1")
		req.Header.Set("Origin", "http://localhost:5173")
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	return resp
}
