// Supervisor: owns the public port, spawns the engine as a child process, proxies /api/*,
// and exposes /sup/kill (SIGKILL) and /sup/start for the crash demo.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const ENGINE_PORT = Number(process.env.ENGINE_PORT || 8788);
const AUTO_RESTART = process.env.AUTO_RESTART === '1';

let child = null;
const state = { starts: 0, kills: 0, lastExit: null, startedAt: null };

function startEngine() {
  if (child) return false;
  child = spawn(process.execPath, [join(here, 'server.js')], {
    env: { ...process.env, PORT: String(ENGINE_PORT) },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  state.starts++;
  state.startedAt = Date.now();
  const me = child;
  me.on('exit', (code, signal) => {
    if (child === me) child = null;
    state.lastExit = { code, signal, at: Date.now() };
    console.log(`[supervisor] engine exited code=${code} signal=${signal}`);
    if (AUTO_RESTART) setTimeout(startEngine, 1000);
  });
  return true;
}

function killEngine() {
  if (!child) return Promise.resolve(false);
  const c = child;
  const exited = new Promise((r) => c.once('exit', () => r(true)));
  c.kill('SIGKILL'); // hard kill: no cleanup, no graceful shutdown
  state.kills++;
  return exited;
}

const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const status = () => ({ running: !!child, pid: child?.pid ?? null, ...state, auto_restart: AUTO_RESTART });

http.createServer((req, res) => {
  if (req.url === '/sup/status' && req.method === 'GET') return json(res, 200, status());
  if (req.url === '/sup/kill' && req.method === 'POST') {
    return void killEngine().then((ok) => json(res, ok ? 200 : 409, { ok, ...status(), error: ok ? undefined : 'Engine is not running' }));
  }
  if (req.url === '/sup/start' && req.method === 'POST') { const ok = startEngine(); return json(res, ok ? 200 : 409, { ok, ...status(), error: ok ? undefined : 'Engine is already running' }); }
  if (!req.url.startsWith('/api/')) return json(res, 404, { error: 'Not found' });
  if (!child) return json(res, 503, { error: 'Engine is down', engine_down: true });

  const up = http.request({ host: '127.0.0.1', port: ENGINE_PORT, method: req.method, path: req.url, headers: req.headers }, (ur) => {
    res.writeHead(ur.statusCode, ur.headers);
    ur.pipe(res);
  });
  up.on('error', () => { if (!res.headersSent) json(res, 503, { error: 'Engine is down or still starting', engine_down: true }); else res.destroy(); });
  res.on('close', () => { if (!res.writableEnded) up.destroy(); });
  req.pipe(up);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`[supervisor] http://127.0.0.1:${PORT} -> engine :${ENGINE_PORT}`);
  startEngine();
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { child?.kill(); process.exit(0); });
process.on('exit', () => child?.kill());
