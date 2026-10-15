// This runtime executes local student code. Browser-side checks are inspectable;
// this prototype is not a tamper-resistant assessment service.
const PYODIDE_VERSION = '314.0.2';
const WHEEL_SHA256 = '074e99919ddc271a0e955c90dac57a0aab5569db5bcf3ae0941b75e11b8a5e69';
const OUTPUT_LIMIT = 100000;
let pyodide;
let execute;
let busy = false;
let nativeOutput = null;
let phase = 'idle';
const send = data => self.postMessage(data);
function nativeWrite(stream, text) {
  if (!nativeOutput || phase !== 'student') return;
  const room = OUTPUT_LIMIT - nativeOutput.length;
  if (room > 0) {
    const piece = (String(text) + '\n').slice(0, room);
    nativeOutput[stream] += piece;
    nativeOutput.length += piece.length;
  }
}
async function checkedFetch(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Runtime asset unavailable');
  return response;
}
const HARNESS = `
import builtins as _runner_builtins
import contextlib as _runner_contextlib
import json as _runner_json
import math as _runner_math
import numbers as _runner_numbers
import traceback as _runner_traceback

class _RunnerCapture:
    def __init__(self, budget):
        self.budget = budget
        self.parts = []
    def write(self, value):
        value = str(value)
        room = max(0, 100000 - self.budget[0])
        if room:
            piece = value[:room]
            self.parts.append(piece)
            self.budget[0] += len(piece)
        return len(value)
    def flush(self):
        pass
    def isatty(self):
        return False
    def getvalue(self):
        return ''.join(self.parts)

class _RunnerDiscard:
    def write(self, value):
        return len(str(value))
    def flush(self):
        pass

def _runner_execute(code, checks_code=None):
    budget = [0]
    stdout, stderr = _RunnerCapture(budget), _RunnerCapture(budget)
    ns = {'__name__': '__main__', '__builtins__': dict(vars(_runner_builtins))}
    result = {'ok': True, 'stdout': '', 'stderr': ''}
    try:
        with _runner_contextlib.redirect_stdout(stdout), _runner_contextlib.redirect_stderr(stderr):
            exec(compile(code, '<student>', 'exec'), ns, ns)
    except BaseException as error:
        result.update(ok=False, infrastructure=False,
                      error=''.join(_runner_traceback.format_exception(type(error), error, error.__traceback__))[-12000:])
    result.update(stdout=stdout.getvalue(), stderr=stderr.getvalue())
    if result['ok'] and checks_code is not None:
        try:
            # Teacher source and incidental teacher output never enter error output.
            from js import __runner_checks_phase
            __runner_checks_phase()
            checks_ns = {'__name__': '__checks__', '__builtins__': dict(vars(_runner_builtins))}
            sink = _RunnerDiscard()
            with _runner_contextlib.redirect_stdout(sink), _runner_contextlib.redirect_stderr(sink):
                exec(compile(checks_code, '<checks>', 'exec'), checks_ns, checks_ns)
                rows = checks_ns['run_checks'](ns)
                if not isinstance(rows, (list, tuple)) or len(rows) > 1000:
                    raise ValueError('Invalid checks')
                checks = []
                for row in rows:
                    if not isinstance(row, dict):
                        raise ValueError('Invalid check')
                    points = row.get('points')
                    if isinstance(points, bool) or not isinstance(points, _runner_numbers.Real):
                        raise ValueError('Invalid points')
                    points = float(points)
                    if not _runner_math.isfinite(points) or points < 0:
                        raise ValueError('Invalid points')
                    label, detail = row.get('label', ''), row.get('detail', '')
                    if not isinstance(label, str) or not isinstance(detail, str):
                        raise ValueError('Invalid feedback')
                    checks.append({'label': label[:1000], 'points': points,
                                   'passed': row.get('passed') is True, 'detail': detail[:4000]})
                score = sum(row['points'] for row in checks if row['passed'])
                total = sum(row['points'] for row in checks)
                if not _runner_math.isfinite(score) or not _runner_math.isfinite(total):
                    raise ValueError('Invalid total')
            result.update(checks=checks, score=score, total=total)
        except BaseException:
            result.update(ok=False, infrastructure=True,
                          error='Kontrol sistemi çalıştırılamadı. Yeniden deneyin.')
    ns.clear()
    return _runner_json.dumps(result, ensure_ascii=False, allow_nan=False)
`;
async function initialize() {
  send({kind: 'status', state: 'loading', message: 'Python ve PyTorch yükleniyor…'});
  const manifestURL = new URL('./runtime/build-manifest.json', self.location.href);
  const manifest = await (await checkedFetch(manifestURL)).json();
  if (manifest.configuration?.pyodide?.version !== PYODIDE_VERSION || manifest.wheel?.sha256 !== WHEEL_SHA256) {
    throw new Error('Unexpected runtime version');
  }
  const base = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
  const {loadPyodide} = await import(base + 'pyodide.mjs');
  pyodide = await loadPyodide({indexURL: base,
    stdout: text => nativeWrite('stdout', text), stderr: text => nativeWrite('stderr', text)});
  await pyodide.loadPackage(['micropip', 'numpy', 'pillow', 'typing-extensions', 'sympy', 'networkx', 'jinja2', 'fsspec']);
  await pyodide.runPythonAsync('import micropip\nawait micropip.install("filelock==3.32.0")');
  const filename = manifest.wheel.filename;
  if (typeof filename !== 'string' || !/^torch-[A-Za-z0-9_.+-]+\.whl$/.test(filename)) throw new Error('Invalid wheel');
  const wheelURL = new URL(filename, manifestURL);
  const bytes = await (await checkedFetch(wheelURL)).arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  if (hash !== WHEEL_SHA256) throw new Error('Runtime checksum mismatch');
  await pyodide.loadPackage(wheelURL.href);
  await pyodide.runPythonAsync('import torch\ntorch.set_num_threads(1)');
  pyodide.runPython(HARNESS);
  execute = true;
  send({kind: 'ready'});
}
self.onmessage = async ({data}) => {
  if (busy) return;
  busy = true;
  try {
    if (data.action === 'init') {
      if (!pyodide) await initialize();
      else send({kind: 'ready'});
    } else if (data.action === 'run' || data.action === 'grade') {
      if (!execute) throw new Error('Runtime not ready');
      nativeOutput = {stdout: '', stderr: '', length: 0};
      phase = 'student';
      // run_checks starts after student execution. Native callbacks are silenced
      // for teacher checks by the marker below, while Python streams use a sink.
      self.__runner_checks_phase = () => { phase = 'checks'; };
      let result;
      const run = pyodide.globals.get('_runner_execute');
      try {
        const encoded = data.action === 'grade'
          ? run(String(data.code), String(data.checksCode))
          : run(String(data.code));
        result = JSON.parse(encoded);
      } finally {
        run.destroy();
        delete self.__runner_checks_phase;
      }
      const remaining = Math.max(0, OUTPUT_LIMIT - result.stdout.length - result.stderr.length);
      result.stdout += nativeOutput.stdout.slice(0, remaining);
      result.stderr += nativeOutput.stderr.slice(0, Math.max(0, remaining - nativeOutput.stdout.length));
      send({kind: 'result', id: data.id, result});
    }
  } catch (error) {
    // Never serialize Python exception stacks from the teacher harness.
    send({kind: 'failure', id: data.id, message: 'Python ortamı çalıştırılamadı. Yeniden deneyin.'});
  } finally {
    nativeOutput = null;
    phase = 'idle';
    busy = false;
  }
};
