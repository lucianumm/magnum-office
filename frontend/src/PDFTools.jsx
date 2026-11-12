import { useState } from 'react';
import { Files, Image, Scissors, FolderOpen, FileCheck2, ShieldCheck, Monitor, Cpu, ArrowRight } from 'lucide-react';
import { Button, Panel, PageHeading, bytes } from './components.jsx';
import SignPDF from './SignPDF.jsx';
export default function PDFTools({ data, act }) {
  const [limitMB, setLimit] = useState(5),
    [mode, setMode] = useState('size'),
    [pages, setPages] = useState(10);
  const job = data.pdfJob;
  const busy = job.status === 'running';
  const start = operation =>
    act(
      () =>
        window.advocacia.pdfTool({
          mode: operation,
          ...(operation === 'split' ? (mode === 'size' ? { limitMB } : { pagesPerPart: pages }) : {}),
        }),
      'PDF/A concluído.',
    );
  return (
    <>
      <PageHeading title="PDF">
        <span className="pdf-format-badge">Saída em PDF/A-2b</span>
      </PageHeading>
      <div className="pdf-assurances">
        <span>
          <Monitor size={16} />
          Processamento local
        </span>
        <span>
          <ShieldCheck size={16} />
          Originais preservados
        </span>
        <span>
          <Cpu size={16} />
          Pode usar bastante memória
        </span>
      </div>
      <div className="pdf-workspace-grid">
        <Panel title="Imagens em PDF/A" icon={Image} className="pdf-action-card">
          <div className="settings-body">
            <p>Transforme fotos e digitalizações em um documento organizado. Cada imagem ocupa uma página A4.</p>
            <div className="pdf-input-note">PNG ou JPG · até 50 imagens</div>
            <Button icon={ArrowRight} disabled={busy} onClick={() => start('images')}>
              Escolher imagens e converter
            </Button>
          </div>
        </Panel>
        <Panel title="Converter PDF em PDF/A" icon={FileCheck2} className="pdf-action-card">
          <div className="settings-body">
            <p>Crie uma cópia de arquivamento de um PDF existente, com suas páginas renderizadas no novo padrão.</p>
            <div className="pdf-input-note">Um PDF por conversão</div>
            <Button icon={ArrowRight} disabled={busy} onClick={() => start('archive')}>
              Escolher PDF e converter
            </Button>
          </div>
        </Panel>
        <Panel title="Dividir PDF/A" icon={Scissors} className="pdf-action-card">
          <div className="settings-body">
            <p>Separe um documento em arquivos menores. Cada parte também será gerada em PDF/A-2b.</p>
            <div className="pdf-split-controls">
              <label className="field">
                <span>Dividir por</span>
                <select aria-label="Dividir por" value={mode} onChange={e => setMode(e.target.value)}>
                  <option value="size">Tamanho máximo</option>
                  <option value="pages">Número de páginas</option>
                </select>
              </label>
              {mode === 'size' ? (
                <label className="field">
                  <span>Limite por arquivo</span>
                  <select
                    aria-label="Tamanho por parte"
                    value={limitMB}
                    onChange={e => setLimit(Number(e.target.value))}
                  >
                    {[0.5, 1, 2, 5, 10, 20, 50].map(n => (
                      <option key={n} value={n}>
                        {n} MB
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="field">
                  <span>Páginas por parte</span>
                  <input
                    aria-label="Páginas por parte"
                    type="number"
                    min={1}
                    max={500}
                    value={pages}
                    onChange={e => setPages(Number(e.target.value))}
                  />
                </label>
              )}
            </div>
            <small>Uma página maior que o limite é mantida inteira, com aviso.</small>
            <Button icon={ArrowRight} disabled={busy} onClick={() => start('split')}>
              Escolher PDF e dividir
            </Button>
          </div>
        </Panel>
        <Panel title="Juntar PDFs em PDF/A" icon={Files} className="pdf-action-card">
          <div className="settings-body">
            <p>Reúna documentos em uma única cópia. Confira a ordem dos arquivos antes de continuar.</p>
            <div className="pdf-input-note">Até 20 PDFs · ordem da seleção</div>
            <Button icon={ArrowRight} disabled={busy} onClick={() => start('merge')}>
              Escolher PDFs e juntar
            </Button>
          </div>
        </Panel>
        <SignPDF act={act} />
      </div>
      <div className="pdf-preservation-note">
        <ShieldCheck size={21} />
        <div>
          <strong>Guarde os documentos originais</strong>
          <p>
            A conversão gera páginas como imagens, com até 180 dpi. Texto pesquisável, links, formulários e assinaturas
            digitais não são preservados nas cópias. Os originais permanecem intactos.
          </p>
        </div>
      </div>
      <p className="help-text">
        O processamento utiliza CPU e memória e pode deixar o computador lento. Nenhum arquivo é enviado a serviços
        externos. Você pode cancelar. Limites: 100 MB por entrada, 200 MB no total, 2.000 páginas e 400 MB por saída.
      </p>
      {job.status !== 'idle' && (
        <Panel className="pdf-result-panel" title={busy ? 'Preparando seus documentos' : 'Resultado da operação'}>
          <div className="settings-body">
            <p role="status">{job.message}</p>
            {busy && (
              <>
                <progress value={job.progress} max={100} />
                <Button tone="secondary" onClick={() => act(() => window.advocacia.cancelPDF())}>
                  Cancelar processamento
                </Button>
              </>
            )}
            {job.result && (
              <>
                <p>
                  <strong>{job.result.files.length} arquivo(s) gerado(s) em PDF/A-2b.</strong>
                </p>
                {job.result.warnings.map((w, i) => (
                  <p key={i} className="notice amber-notice">
                    {w}
                  </p>
                ))}
                <ul>
                  {job.result.files.map(f => (
                    <li key={f.name}>
                      <FileCheck2 size={17} />
                      <span>
                        {f.name}
                        <small>
                          {f.pages} página(s) · {bytes(f.size)}
                        </small>
                      </span>
                      <span className="pdf-format-badge">PDF/A-2b</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {!busy && (
              <Button tone="secondary" icon={FolderOpen} onClick={() => act(() => window.advocacia.openPDFOutput())}>
                Abrir pasta de destino
              </Button>
            )}
          </div>
        </Panel>
      )}
    </>
  );
}
