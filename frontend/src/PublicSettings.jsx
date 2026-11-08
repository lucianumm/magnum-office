import { useState } from 'react';
import { Globe, RefreshCw, Save, ExternalLink } from 'lucide-react';
import { Button, Panel, Toggle, dateTime } from './components.jsx';

// Public consultations: everything starts turned off and says what leaves the computer.
export default function PublicSettings({ data, act }) {
  const s = data.settings;
  const [form, setForm] = useState({
    datajudEnabled: s.datajudEnabled,
    djenEnabled: s.djenEnabled,
    datajudKey: s.datajudKey || '',
  });
  const lawyers = (s.lawyers || []).filter(l => l.oab && l.uf);
  const save = () => act(() => window.advocacia.saveSettings(form), 'Consultas públicas salvas.');
  const indices = data.indices;
  return (
    <>
      <Panel title="Consultas públicas" icon={Globe}>
        <div className="settings-body">
          <p className="help-text">
            Estas consultas usam serviços públicos do CNJ e do Banco Central. Elas vêm desligadas, funcionam só com o
            programa aberto ou na bandeja e enviam apenas o mínimo descrito em cada uma. Nenhum nome de cliente sai do
            computador.
          </p>
          <Toggle
            checked={form.datajudEnabled}
            onChange={v => setForm(f => ({ ...f, datajudEnabled: v }))}
            title="Andamentos pelo DataJud (CNJ)"
            description="Envia ao CNJ apenas o número dos processos com número CNJ válido. Uma vez por dia confere os processos em andamento e avisa quando há movimento novo. Os dados chegam com atraso, não incluem processos em segredo de justiça e não substituem a intimação oficial."
          />
          <label className="field">
            <span>Chave pública do DataJud</span>
            <input
              value={form.datajudKey}
              maxLength={300}
              placeholder="Deixe em branco para usar a chave conhecida pelo sistema"
              onChange={e => setForm(f => ({ ...f, datajudKey: e.target.value }))}
            />
            <small>
              O CNJ publica e pode trocar esta chave.{' '}
              <button className="text-link" onClick={() => act(() => window.advocacia.openLink('datajudKey'))}>
                Ver a chave atual <ExternalLink size={12} />
              </button>
            </small>
          </label>
          <small className="field-hint muted">
            Última consulta: {s.lastDatajudCheck ? dateTime(s.lastDatajudCheck) : 'nunca'}
            {s.datajudError && <span className="danger-text"> · {s.datajudError}</span>}
          </small>
          <div className="section-divider" />
          <Toggle
            checked={form.djenEnabled}
            onChange={v => setForm(f => ({ ...f, djenEnabled: v }))}
            title="Intimações pelo Diário de Justiça Eletrônico Nacional"
            description="Envia ao CNJ apenas o número e a UF da OAB dos advogados do escritório. Uma vez por dia busca as comunicações publicadas e as mostra em Intimações, com atalho para calcular o prazo. Confira sempre no sistema do tribunal."
          />
          <small className="field-hint muted">
            {lawyers.length
              ? `Advogados consultados: ${lawyers.map(l => `${l.name} (OAB ${l.oab}/${l.uf})`).join(', ')}.`
              : 'Cadastre os advogados com OAB em Configurações → Escritório.'}{' '}
            Última consulta: {s.lastDjenCheck ? dateTime(s.lastDjenCheck) : 'nunca'}
            {s.djenError && <span className="danger-text"> · {s.djenError}</span>}
          </small>
          <div className="section-divider" />
          <div className="toggle-row">
            <span>
              <strong>Índices do Banco Central</strong>
              <small>
                IPCA, INPC, IGP-M, IPCA-E, Selic e Taxa Legal, baixados só quando você pede, em Ferramentas → Débitos.
                Envia apenas o código da série e as datas.{' '}
                {indices?.updatedAt ? `Atualizados em ${dateTime(indices.updatedAt)}.` : 'Ainda não baixados.'}
              </small>
            </span>
            <Button
              tone="secondary"
              icon={RefreshCw}
              onClick={() => act(() => window.advocacia.updateIndices({}), 'Índices atualizados.')}
            >
              Atualizar índices
            </Button>
          </div>
        </div>
      </Panel>
      <div className="settings-save">
        <Button icon={Save} onClick={save}>
          Salvar consultas públicas
        </Button>
      </div>
    </>
  );
}
