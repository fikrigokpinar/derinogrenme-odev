const INITIALIZATION_TIMEOUT = 120000;
const EXECUTION_TIMEOUT = 90000;
const failure = (error, extra = {}) => ({ok: false, stdout: '', stderr: '', error, infrastructure: true, ...extra});

export class PythonRunner {
  constructor({onStatus = () => {}} = {}) {
    this.onStatus = onStatus;
    this.worker = null;
    this.ready = false;
    this.pending = null;
    this.nextId = 0;
    this.timer = null;
  }
  status(state, message) {
    try { this.onStatus({state, message}); } catch { /* UI callbacks must not break execution. */ }
  }
  run(code) { return this.request('run', code); }
  grade(code, checksCode) { return this.request('grade', code, checksCode); }
  request(action, code, checksCode) {
    if (this.pending) return Promise.resolve(failure('Başka bir işlem sürüyor.'));
    if (typeof code !== 'string' || (action === 'grade' && typeof checksCode !== 'string')) {
      return Promise.resolve(failure('Geçersiz çalıştırma isteği.'));
    }
    return new Promise(resolve => {
      this.pending = {id: ++this.nextId, action, code, checksCode, resolve};
      if (this.ready && this.worker) this.execute();
      else this.initialize();
    });
  }
  initialize() {
    this.resetWorker();
    this.status('loading', 'Python ve PyTorch yükleniyor…');
    try {
      const worker = new Worker(new URL('./runtime-worker.js', import.meta.url), {type: 'module'});
      this.worker = worker;
      worker.onmessage = ({data}) => {
        if (this.worker !== worker) return;
        if (data.kind === 'status') this.status(data.state, data.message);
        else if (data.kind === 'ready') {
          this.ready = true;
          this.status('ready', 'Python ve PyTorch hazır.');
          if (this.pending) this.execute();
        } else if (data.kind === 'result' && data.id === this.pending?.id) {
          this.finish(data.result);
        } else if (data.kind === 'failure') {
          this.abort(failure(data.message || 'Python ortamı çalıştırılamadı.'));
        }
      };
      worker.onerror = event => {
        event.preventDefault();
        if (this.worker === worker) this.abort(failure('Python ortamı beklenmedik biçimde kapandı. Yeniden deneyin.'));
      };
      worker.onmessageerror = () => {
        if (this.worker === worker) this.abort(failure('Python ortamından sonuç alınamadı. Yeniden deneyin.'));
      };
      this.setDeadline(INITIALIZATION_TIMEOUT, 'Python ortamı yüklenirken süre aşıldı. Yeniden deneyin.');
      worker.postMessage({action: 'init'});
    } catch {
      this.abort(failure('Python çalışma ortamı başlatılamadı. Yeniden deneyin.'));
    }
  }
  execute() {
    const pending = this.pending;
    if (!pending || !this.worker) return;
    this.status(pending.action === 'grade' ? 'grading' : 'running', pending.action === 'grade' ? 'Kod ve kontroller çalıştırılıyor…' : 'Kod çalıştırılıyor…');
    this.setDeadline(EXECUTION_TIMEOUT, 'Çalıştırma süre sınırını aştı. Kodunuzu kontrol edip yeniden deneyin.');
    this.worker.postMessage({action: pending.action, id: pending.id, code: pending.code, checksCode: pending.checksCode});
  }
  setDeadline(milliseconds, message) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.abort(failure(message)), milliseconds);
  }
  finish(result) {
    clearTimeout(this.timer);
    this.timer = null;
    const pending = this.pending;
    this.pending = null;
    this.status(result.ok ? 'ready' : 'error', result.ok ? 'İşlem tamamlandı.' : result.infrastructure ? 'İşlem tamamlanamadı. Ayrıntılar çıktı alanında.' : 'Kod hata verdi. Ayrıntılar çıktı alanında.');
    pending?.resolve(result);
  }
  abort(result) {
    this.resetWorker();
    this.finish(result);
  }
  resetWorker() {
    clearTimeout(this.timer);
    this.timer = null;
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
  }
  cancel() {
    if (!this.pending) return;
    this.resetWorker();
    this.finish(failure('İşlem iptal edildi.', {cancelled: true}));
    this.status('cancelled', 'İşlem iptal edildi. Sonraki işlem ortamı yeniden başlatır.');
  }
  dispose() {
    this.cancel();
    this.resetWorker();
  }
}
