// One command for local dev: starts the supervisor (which spawns the engine) and the Vite dev server.
// No extra dependencies.
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const win = process.platform === 'win32';

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
