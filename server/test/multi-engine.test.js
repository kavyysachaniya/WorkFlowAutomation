// Multi-engine safety: two engine processes share one SQLite file and compete for the same runs.
// Lease claiming must ensure exactly one delivery per (run, message step).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startEngine, exited, waitHealthy, api, snapshot, waitAllCompleted, verifyExactlyOnce, sleep, tempDb, removeDb, STEPS, payloadFor } from './helpers.js';

const N = 200;
const base = 8850 + (process.pid % 50) * 2;

test('two engines on one DB: 200 runs, exactly-once deliveries, both engines do work', async (t) => {
  const DB = tempDb('multi');
  t.after(() => removeDb(DB));
  const ports = [base, base + 1];
  // Small batches (MAX_CONCURRENCY) so neither engine can claim everything in one tick.
  const engines = ports.map((port) => startEngine({ port, db: DB, env: { MAX_CONCURRENCY: '16' } }));
  t.after(() => engines.forEach((e) => e.kill('SIGKILL')));
  await Promise.all(ports.map(waitHealthy));

  const wf = await api(ports[0], '/api/workflows', { name: 'multi-engine test', trigger: { event: 'user.signed_up' }, conditions: [], steps: STEPS });

  // Fire events at both engines, alternating.
  for (let i = 0; i < N; i += 20) {
    await Promise.all(Array.from({ length: 20 }, (_, k) => i + k).map((n) =>
      api(ports[n % 2], '/api/events', { event: 'user.signed_up', event_id: `evt-${n}`, payload: payloadFor(n) })));
  }
  await sleep(300);
  console.log('  mid-flight:', JSON.stringify(snapshot(DB)));

  const final = await waitAllCompleted(DB, N);
  console.log('  final:', JSON.stringify(final));
  assert.equal(final.runs.completed, N, 'every run completes');
  assert.equal(Object.keys(final.runs).length, 1, 'no failed/stuck runs');

  const { total, expected, byEngine } = verifyExactlyOnce(DB, wf.id, N);
  console.log(`  verified ${N} runs, ${total} deliveries (expected ${expected}), 0 duplicates`);
  console.log('  steps executed per engine:', JSON.stringify(byEngine));
  assert.equal(byEngine.length, 2, 'both engines executed steps');
  for (const e of byEngine) assert.ok(e.n > 50, `engine ${e.engine} did a meaningful share (${e.n} steps)`);

  // Phase 2: kill one engine while the other keeps running; the survivor must finish
  // the victim's leased runs after the lease expires, still exactly once.
  const wf2 = await api(ports[1], '/api/workflows', { name: 'takeover test', trigger: { event: 'user.upgraded' }, conditions: [], steps: STEPS });
  await Promise.all(Array.from({ length: N }, (_, n) =>
    api(ports[n % 2], '/api/events', { event: 'user.upgraded', event_id: `up-${n}`, payload: payloadFor(n) })));
  await sleep(200);
  engines[0].kill('SIGKILL');
  await exited(engines[0]);
  console.log('  killed engine A mid-flight:', JSON.stringify(snapshot(DB)));
  const final2 = await waitAllCompleted(DB, 2 * N);
  assert.equal(final2.runs.completed, 2 * N, 'survivor completes every run');
  const r2 = verifyExactlyOnce(DB, wf2.id, N);
  console.log(`  takeover verified: ${r2.total} deliveries (expected ${r2.expected}), 0 duplicates`);
});
