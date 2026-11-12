const { Worker } = require('node:worker_threads');
const path = require('node:path');
const fs = require('node:fs/promises');
class PDFTools {
  constructor() {
    this.worker = null;
    this.state = { status: 'idle', progress: 0, message: '', result: null };
    this.folder = null;
  }
  get() {
    return { ...this.state };
  }
  async run(input) {
    if (this.worker) throw new Error('Já existe uma operação de PDF em andamento.');
    const { mode, files, output } = input;
    if (
      !['images', 'split', 'merge', 'archive'].includes(mode) ||
      !Array.isArray(files) ||
      !files.length ||
      files.length > (mode === 'images' ? 50 : mode === 'merge' ? 20 : 1) ||
      !path.isAbsolute(output) ||
      files.some(f => !path.isAbsolute(f) || !(mode === 'images' ? /\.(png|jpe?g)$/i : /\.pdf$/i).test(f))
    )
      throw new Error('Arquivos ou operação inválidos.');
    if (
      mode === 'split' &&
      !(
        (Number.isInteger(input.pagesPerPart) && input.pagesPerPart >= 1 && input.pagesPerPart <= 500) ||
        [0.5, 1, 2, 5, 10, 20, 50].includes(input.limitMB)
      )
    )
      throw new Error('Limite de divisão inválido.');
    if (files.some(f => path.resolve(f).toLowerCase() === path.resolve(output).toLowerCase()))
      throw new Error('Escolha um destino diferente dos originais.');
    this.folder = mode === 'split' ? output : path.dirname(output);
    this.state = {
      status: 'running',
      progress: 0,
      message: 'Preparando os arquivos no seu computador...',
      result: null,
    };
    const worker = new Worker(path.join(__dirname, 'pdf-worker.cjs'), {
      workerData: input,
      resourceLimits: { maxOldGenerationSizeMb: 768 },
    });
    this.worker = worker;
    let cancelled = false;
    try {
      return await new Promise((resolve, reject) => {
        worker.on('message', data => {
          if (data.progress !== undefined)
            this.state = { ...this.state, progress: data.progress, message: data.message };
          if (data.result) {
            this.state = { ...this.state, status: 'done', result: data.result };
            resolve(data.result);
          }
          if (data.error) reject(new Error(data.error));
        });
        worker.on('error', () =>
          reject(
            new Error('Não foi possível processar o arquivo. Ele pode estar inválido ou exceder a memória disponível.'),
          ),
        );
        worker.on('exit', code => {
          if (this.state.status === 'cancelled') {
            cancelled = true;
            resolve(false);
          } else if (code !== 0 || this.state.status !== 'done')
            reject(new Error('O processamento de PDF foi interrompido.'));
        });
      });
    } catch (error) {
      this.state = { ...this.state, status: 'error', message: error.message };
      throw error;
    } finally {
      this.worker = null;
      await worker.terminate();
      if (mode !== 'split') await fs.rm(output + '.partial', { force: true });
      if (cancelled) this.state.message = 'Cancelado. Arquivos já concluídos foram preservados.';
    }
  }
  async cancel() {
    if (this.worker) {
      this.state.status = 'cancelled';
      await this.worker.terminate();
      return true;
    }
    return false;
  }
  stop() {
    return this.worker?.terminate();
  }
}
module.exports = { PDFTools };
