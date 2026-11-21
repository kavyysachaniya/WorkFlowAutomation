// One command for local dev: starts the supervisor (which spawns the engine) and the Vite dev server.
// No extra dependencies.
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import net from 'node:net';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const win = process.platform === 'win32';

// Preflight: fail fast with a clear message if a port is taken (usually another `pnpm dev`,
// or an engine left behind by a supervisor that was force-killed).
const PORTS = { 8787: 'supervisor', 8788: 'engine', 5173: 'web (Vite)' };
const canListen = (port, host) => new Promise((resolve) => {
  const s = net.createServer();
  s.once('error', (e) => resolve(e.code === 'EADDRNOTAVAIL' || e.code === 'EAFNOSUPPORT')); // host not available: not a conflict
  s.listen(port, host, () => s.close(() => resolve(true)));
});
const busy = [];
for (const [port, what] of Object.entries(PORTS)) {
  const free = (await canListen(Number(port), '127.0.0.1')) && (await canListen(Number(port), '::1'));
  if (!free) busy.push(`  :${port}  (${what})`);
}
if (busy.length) {
  console.error(`\n[dev] Cannot start: these ports are already in use:\n${busy.join('\n')}\n`);
  console.error('[dev] Another `pnpm dev` (or a leftover engine/Vite process) is probably still running.');
  console.error(win
    ? '[dev] Stop it with Ctrl+C in its terminal, or find it with:  netstat -ano | findstr ":8787 :8788 :5173"  then  taskkill /PID <pid> /T /F\n'
    : '[dev] Stop it with Ctrl+C in its terminal, or find it with:  lsof -i :8787 -i :8788 -i :5173  then  kill <pid>\n');
  process.exit(1);
}

const procs = [
  spawn(process.execPath, [join(root, 'server', 'src', 'supervisor.js')], {
    cwd: root, stdio: 'inherit', env: { ...process.env, NODE_NO_WARNINGS: '1' },
  }),
  spawn(win ? 'pnpm.cmd' : 'pnpm', ['--filter', 'web', 'dev'], { cwd: root, stdio: 'inherit', shell: win }),
];

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const p of procs) {
    if (p.exitCode !== null) continue;
    // On Windows, kill the whole tree (pnpm -> cmd -> node vite, supervisor -> engine).
    if (win) spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
    else p.kill('SIGTERM');
  }
  process.exit(code);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
for (const p of procs) {
  p.on('exit', (code) => {
    if (!stopping) { console.error(`[dev] a process exited (code ${code}); shutting down`); stop(code || 1); }
  });
}
