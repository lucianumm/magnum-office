import { useEffect, useState } from 'react';
import { Search, Save, UserPlus } from 'lucide-react';
import { Button, Empty, Modal } from './components.jsx';
import { kindOf } from '../../app/intimation-text.mjs';
import PublicationText from './PublicationText.jsx';

const ufs = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
const br = key => (key ? key.split('-').reverse().join('/') : '');
const blank = {
  oab: '',
  uf: 'GO',
  nomeAdvogado: '',
  nomeParte: '',
  numeroProcesso: '',
  siglaTribunal: '',
  de: '',
  ate: '',
  meio: '',
};

// A one-off search in the DJEN: any lawyer (OAB or name), party, process or court. The results stay apart
// from the inbox until one is kept.
export default function IntimationSearch({ data, act, onClose }) {
  const [form, setForm] = useState(blank);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [courts, setCourts] = useState([]);
  const [kept, setKept] = useState({});
  useEffect(() => {
    window.advocacia
      .intimationCourts()
      .then(setCourts)
      .catch(() => {});
  }, []);
  const set = key => e => setForm(f => ({ ...f, [key]: e.target.value }));
  async function run(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      setResult(await window.advocacia.searchIntimations(form));
      setKept({});
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }
  const mine = new Set((data.settings.lawyers || []).map(l => `${l.oab}/${l.uf}`));
  return (
    <Modal
      wide
      title="Buscar publicações"
      subtitle="Consulta avulsa ao Diário de Justiça Eletrônico Nacional."
      onClose={onClose}
    >
      <form onSubmit={run}>
        <div className="form-grid">
          <label className="field">
            <span>Número da OAB</span>
            <input value={form.oab} onChange={set('oab')} placeholder="Ex.: 12345" inputMode="numeric" />
          </label>
          <label className="field">
            <span>UF da OAB</span>
            <select value={form.uf} onChange={set('uf')}>
              {ufs.map(u => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Nome do advogado</span>
            <input value={form.nomeAdvogado} onChange={set('nomeAdvogado')} maxLength={160} />
          </label>
          <label className="field">
            <span>Nome da parte</span>
            <input value={form.nomeParte} onChange={set('nomeParte')} maxLength={160} />
          </label>
          <label className="field">
            <span>Número do processo</span>
            <input
              value={form.numeroProcesso}
              onChange={set('numeroProcesso')}
              placeholder="0000000-00.0000.0.00.0000"
            />
          </label>
          <label className="field">
            <span>Tribunal</span>
            <input
              value={form.siglaTribunal}
              onChange={set('siglaTribunal')}
              list="djen-courts"
              placeholder="Ex.: TJGO"
              maxLength={12}
            />
            <datalist id="djen-courts">
              {courts.map(c => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span>De</span>
            <input type="date" value={form.de} onChange={set('de')} />
          </label>
          <label className="field">
            <span>Até</span>
            <input type="date" value={form.ate} onChange={set('ate')} />
          </label>
          <label className="field">
            <span>Meio</span>
            <select value={form.meio} onChange={set('meio')}>
              <option value="">Diário e edital</option>
              <option value="D">Diário</option>
              <option value="E">Edital</option>
            </select>
          </label>
        </div>
        <div className="settings-body notice-body">
          <small className="field-hint muted">
            Informe pelo menos um critério. A pesquisa por OAB ou nome é limitada a 10 mil resultados pela API e conta
            no limite de consultas por minuto; o programa lê até 500 publicações por busca.
          </small>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="form-footer">
          <span />
          <Button type="submit" icon={Search} busy={busy}>
            Buscar
          </Button>
        </div>
      </form>
      {result && (
        <div className="settings-body notice-body">
          <p className="help-text">
            {result.items.length} publicação(ões) mostrada(s) de {result.count} encontrada(s)
            {result.truncated ? '. Refine a busca com datas ou o tribunal para ver o restante' : ''}
            {result.capped ? '. A API limita esta pesquisa a 10 mil resultados' : ''}
            {result.remaining !== null && result.remaining !== undefined
              ? `. Restam ${result.remaining} consultas neste minuto`
              : ''}
            .
          </p>
          {result.items.length ? (
            <ul className="intimation-list">
              {result.items.slice(0, 100).map(i => {
                const kind = kindOf(i.tipo);
                const key = (i.lawyers || []).find(
                  l => form.oab && l.oab.replace(/\D/g, '') === form.oab.replace(/\D/g, ''),
                );
                const asLawyer = key ? `${key.oab}/${key.uf}` : '';
                return (
                  <li key={i.id}>
                    <div className="intimation-head">
                      <time>{br(i.date)}</time>
                      <span className={'kind-tag kind-' + kind.tone}>{kind.label}</span>
                      <strong>{i.processoMascara || i.processo}</strong>
                      <small>{[i.tribunal, i.classe, i.orgao].filter(Boolean).join(' · ')}</small>
                    </div>
                    <PublicationText text={i.texto} open={false} />
                    <div className="row-actions intimation-actions">
                      <Button
                        tone="secondary"
                        icon={Save}
                        disabled={i.kept || kept[i.id]}
                        onClick={() =>
                          act(() => window.advocacia.keepIntimation(i.id), 'Publicação guardada em Intimações.').then(
                            () => setKept(k => ({ ...k, [i.id]: true })),
                          )
                        }
                      >
                        {i.kept || kept[i.id] ? 'Já guardada' : 'Guardar'}
                      </Button>
                      {key && !mine.has(asLawyer) && (
                        <Button
                          tone="ghost"
                          icon={UserPlus}
                          onClick={() =>
                            act(
                              () =>
                                window.advocacia.saveSettings({
                                  lawyers: [
                                    ...(data.settings.lawyers || []),
                                    { name: key.nome, oab: key.oab, uf: key.uf, email: '' },
                                  ],
                                }),
                              'Advogado cadastrado: as publicações dele passam a ser consultadas todo dia.',
                            )
                          }
                        >
                          Cadastrar o advogado do escritório
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty icon={Search} title="Nada encontrado" description="Tente outro período ou outros critérios." />
          )}
        </div>
      )}
    </Modal>
  );
}
