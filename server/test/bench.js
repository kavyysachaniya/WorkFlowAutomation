// Throughput benchmark (not part of `pnpm test`): one engine process, N runs of a 4-step
// workflow (task, message, branch, message), events fired over HTTP while the engine works.
// Usage: pnpm bench            (N=2000)
//        node test/bench.js 5000
import { DatabaseSync } from 'node:sqlite';
import { startEngine, waitHealthy, api, waitAllCompleted, sleep, tempDb, removeDb } from './helpers.js';

const N = Number(process.argv[2] || 2000);
const PORT = 8950 + (process.pid % 40);
const DB = tempDb('bench');

const CONC = process.env.MAX_CONCURRENCY || '64';
console.log(`engine MAX_CONCURRENCY=${CONC}, tick 250ms`);
const engine = startEngine({ port: PORT, db: DB, env: { MAX_CONCURRENCY: CONC } });
try {
  await waitHealthy(PORT);
  await api(PORT, '/api/workflows', {
    name: 'bench', trigger: { event: 'bench.event' }, conditions: [],
    steps: [
      { type: 'task', name: 'Process order' },
      { type: 'message', channel: 'email', body: 'Order {{n}} received' },
      { type: 'branch', condition: { field: 'total', op: 'gt', value: 500 }, skip: 1 },
      { type: 'message', channel: 'slack', body: 'Big order {{n}}' },
    ],
  });

  const t0 = performance.now();
  for (let i = 0; i < N; i += 50) {
    await Promise.all(Array.from({ length: Math.min(50, N - i) }, (_, k) => i + k).map((n) =>
      api(PORT, '/api/events', { event: 'bench.event', event_id: `b-${n}`, payload: { n, total: n % 2 ? 900 : 100 } })));
  }
  const tFired = performance.now();
  const final = await waitAllCompleted(DB, N, 300_000);
  const tDone = performance.now();
  await sleep(50);

  const d = new DatabaseSync(DB, { readOnly: true });
  const steps = d.prepare('SELECT COUNT(*) n FROM step_log').get().n;
  const dels = d.prepare('SELECT COUNT(*) n FROM deliveries').get().n;
  const distinct = d.prepare('SELECT COUNT(*) n FROM (SELECT DISTINCT run_id, step_index FROM deliveries)').get().n;
  d.close();

  const secs = (tDone - t0) / 1000;
  const expectedDels = N + Math.floor(N / 2);
  console.log(`runs:        ${final.runs.completed}/${N} completed`);
  console.log(`ingest:      ${N} events over HTTP in ${((tFired - t0) / 1000).toFixed(2)}s (${Math.round(N / ((tFired - t0) / 1000))}/s)`);
  console.log(`end-to-end:  ${secs.toFixed(2)}s from first event to last run completed`);
  console.log(`throughput:  ${Math.round(N / secs)} runs/s, ${Math.round(steps / secs)} steps/s (each step = 1 SQLite transaction)`);
  console.log(`deliveries:  ${dels} (expected ${expectedDels}), duplicates: ${dels - distinct}`);
  if (final.runs.completed !== N || dels !== expectedDels || dels !== distinct) process.exitCode = 1;
} finally {
  engine.kill('SIGKILL');
  await sleep(200);
  removeDb(DB);
}
