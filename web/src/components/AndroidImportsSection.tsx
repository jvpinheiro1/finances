import React, { useState } from 'react';
import {
  AndroidDevice,
  api,
  ApiError,
  BankImportItem,
  Category,
  formatCentsBRL,
  parseBRLToCents,
  Workspace,
} from '../api';

interface AndroidImportsSectionProps {
  workspaces: Workspace[];
  activeWsId: string;
  categories: Category[];
  devices: AndroidDevice[];
  bankImports: BankImportItem[];
  onRefresh: () => Promise<void>;
  onError: (msg: string | null) => void;
}

export function AndroidImportsSection({
  workspaces,
  activeWsId,
  categories,
  devices,
  bankImports,
  onRefresh,
  onError,
}: AndroidImportsSectionProps) {
  const [newDeviceName, setNewDeviceName] = useState('');
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [importAmountOverrides, setImportAmountOverrides] = useState<Record<string, string>>({});
  const [importTargetWs, setImportTargetWs] = useState<Record<string, string>>({});
  const [importCategoryId, setImportCategoryId] = useState<Record<string, string>>({});

  async function handleCreateDevice(e: React.FormEvent) {
    e.preventDefault();
    onError(null);
    try {
      const res = await api.createDevice(newDeviceName);
      setGeneratedToken(res.plain_token);
      setNewDeviceName('');
      await onRefresh();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Erro ao criar token de dispositivo');
    }
  }

  async function handleRevokeDevice(id: string) {
    onError(null);
    try {
      await api.revokeDevice(id);
      await onRefresh();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Erro ao revogar dispositivo');
    }
  }

  async function handleApproveImport(item: BankImportItem) {
    onError(null);
    const personalWs = workspaces.find((w) => w.kind === 'personal');
    const targetWsId = importTargetWs[item.id] || personalWs?.id || activeWsId;
    const catId = importCategoryId[item.id] || categories[0]?.id || '';
    let overrideCents: number | undefined;
    if (item.parse_status === 'needs_review' || importAmountOverrides[item.id]) {
      const parsed = parseBRLToCents(importAmountOverrides[item.id] ?? '');
      if (parsed === null) {
        onError('Informe o valor em R$ para aprovar este item da fila.');
        return;
      }
      overrideCents = parsed;
    }
    try {
      await api.approveImport(item.id, {
        workspace_id: targetWsId,
        category_id: catId,
        amount_cents: overrideCents,
        total_installments: item.parsed_installments,
      });
      await onRefresh();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Erro ao aprovar notificação bancária');
    }
  }

  async function handleDiscardImport(id: string) {
    onError(null);
    try {
      await api.discardImport(id);
      await onRefresh();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Erro ao descartar notificação bancária');
    }
  }

  return (
    <section className="panel" aria-labelledby="android-imports-title">
      <div className="summary-bar">
        <div>
          <h2 id="android-imports-title">
            App Android & Fila Privada de Notificações Bancárias ({bankImports.length} pendentes)
          </h2>
          <p className="subtitle">
            Suporta Nubank, Itaú, Bradesco, Banco do Brasil, Inter, Santander e C6 Bank. Apenas
            você enxerga as notificações capturadas no seu celular (protegidas por RLS).
          </p>
        </div>
        <button type="button" className="btn btn-outline btn-sm" onClick={onRefresh}>
          Atualizar fila
        </button>
      </div>

      <div className="form-grid form-grid-2" style={{ marginTop: '1.25rem' }}>
        <div>
          <h3>Parear Celular Android</h3>
          <form className="form-stack" onSubmit={handleCreateDevice}>
            <div className="field">
              <label htmlFor="dev-name">Nome do aparelho</label>
              <input
                id="dev-name"
                type="text"
                required
                maxLength={80}
                placeholder="Ex.: Samsung S24 / Pixel 8"
                value={newDeviceName}
                onChange={(e) => setNewDeviceName(e.target.value)}
              />
            </div>
            <button type="submit" className="btn btn-primary">
              Gerar Token de Dispositivo
            </button>
          </form>

          {generatedToken && (
            <div
              className="panel"
              style={{ marginTop: '0.85rem', marginBottom: 0, wordBreak: 'break-all' }}
            >
              <strong>Token gerado (copie agora, exibido uma única vez):</strong>
              <p style={{ fontFamily: 'monospace', margin: '0.4rem 0' }}>{generatedToken}</p>
            </div>
          )}

          {devices.length > 0 && (
            <ul className="expense-list" style={{ marginTop: '0.85rem' }}>
              {devices.map((d) => (
                <li key={d.id} className="expense-item" style={{ padding: '0.65rem 0.9rem' }}>
                  <div>
                    <strong>{d.device_name}</strong>{' '}
                    <span className={`badge ${d.revoked_at ? 'badge-neutral' : 'badge-private'}`}>
                      {d.revoked_at ? 'Revogado' : 'Ativo'}
                    </span>
                  </div>
                  {!d.revoked_at && (
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => handleRevokeDevice(d.id)}
                    >
                      Revogar
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3>Fila de Revisão de Notificações Bancárias</h3>
          {bankImports.length === 0 ? (
            <p className="subtitle">Nenhuma notificação pendente de revisão.</p>
          ) : (
            <ul className="expense-list">
              {bankImports.map((item) => {
                const personalWs = workspaces.find((w) => w.kind === 'personal');
                const selectedWs = importTargetWs[item.id] || personalWs?.id || activeWsId;
                const selectedCat = importCategoryId[item.id] || categories[0]?.id || '';
                return (
                  <li key={item.id} className="expense-item" style={{ padding: '0.85rem' }}>
                    <div className="expense-main">
                      <div className="expense-title">
                        <span>{item.merchant_or_title}</span>
                        <span className="badge badge-neutral">{item.bank_code.toUpperCase()}</span>
                        {item.parse_status === 'needs_review' && (
                          <span className="badge">Informar valor manual</span>
                        )}
                      </div>
                      <div className="expense-meta">
                        <span>Data: {item.occurred_on}</span>
                        {item.card_last4 && <span>· Cartão •••• {item.card_last4}</span>}
                        {item.parsed_installments > 1 && (
                          <span>· {item.parsed_installments}x</span>
                        )}
                      </div>

                      <div className="form-grid form-grid-2" style={{ marginTop: '0.5rem' }}>
                        <select
                          aria-label="Ambiente de destino"
                          value={selectedWs}
                          onChange={(e) =>
                            setImportTargetWs((prev) => ({
                              ...prev,
                              [item.id]: e.target.value,
                            }))
                          }
                        >
                          {workspaces.map((w) => (
                            <option key={w.id} value={w.id}>
                              {w.kind === 'personal'
                                ? 'Meu Espaço Individual (Privado)'
                                : 'Espaço da Família (Coletivo)'}
                            </option>
                          ))}
                        </select>

                        <select
                          aria-label="Categoria"
                          value={selectedCat}
                          onChange={(e) =>
                            setImportCategoryId((prev) => ({
                              ...prev,
                              [item.id]: e.target.value,
                            }))
                          }
                        >
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div style={{ marginTop: '0.5rem' }}>
                        {item.parse_status === 'needs_review' ? (
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="Valor R$ 0,00"
                            value={importAmountOverrides[item.id] ?? ''}
                            onChange={(e) =>
                              setImportAmountOverrides((prev) => ({
                                ...prev,
                                [item.id]: e.target.value,
                              }))
                            }
                          />
                        ) : (
                          <strong>{formatCentsBRL(item.parsed_amount_cents ?? 0)}</strong>
                        )}
                      </div>
                    </div>

                    <div className="expense-actions">
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => handleApproveImport(item)}
                      >
                        Aprovar despesa
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => handleDiscardImport(item.id)}
                      >
                        Descartar
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
