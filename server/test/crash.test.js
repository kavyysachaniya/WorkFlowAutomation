// Crash-safety test: start 200 runs, SIGKILL the engine mid-flight (three times), restart,
// and assert every run completes with exactly one delivery per (run, message step).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startEngine, exited, waitHealthy, api, snapshot, waitAllCompleted, verifyExactlyOnce, sleep, tempDb, removeDb, STEPS, payloadFor } from './helpers.js';

const N = 200;
const PORT = 8791 + (process.pid % 50);

test('200 runs survive three SIGKILLs with exactly-once deliveries', async (t) => {
  const DB = tempDb('crash');
  t.after(() => removeDb(DB));

  let engine = startEngine({ port: PORT, db: DB });
  t.after(() => engine.kill('SIGKILL'));
  await waitHealthy(PORT);
  const wf = await api(PORT, '/api/workflows', { name: 'crash test', trigger: { event: 'user.signed_up' }, conditions: [], steps: STEPS });

  for (let i = 0; i < N; i += 25) {
    await Promise.all(Array.from({ length: 25 }, (_, k) => i + k).map((n) =>
      api(PORT, '/api/events', { event: 'user.signed_up', event_id: `evt-${n}`, payload: payloadFor(n) })));
  }
  // Re-firing the same event id must not create a new run.
  const dup = await api(PORT, '/api/events', { event: 'user.signed_up', event_id: 'evt-0', payload: payloadFor(0) });
  assert.equal(dup.runs[0].duplicate, true);

  const kills = [];
  for (const [round, delay] of [120, 300, 450].entries()) {
    await sleep(delay);
    engine.kill('SIGKILL');
    await exited(engine);
    const snap = snapshot(DB);
    kills.push(snap);
    console.log(`  kill #${round + 1}:`, JSON.stringify(snap));
    engine = startEngine({ port: PORT, db: DB });
    await waitHealthy(PORT);
  }
  assert.ok((kills[0].runs.completed ?? 0) < N, 'first kill must land mid-flight (some runs unfinished)');

  const final = await waitAllCompleted(DB, N);
  console.log('  final:', JSON.stringify(final));
  assert.equal(final.runs.completed, N, 'every run completes');
  assert.equal(Object.keys(final.runs).length, 1, 'no failed/stuck runs');

  const { total, expected } = verifyExactlyOnce(DB, wf.id, N);
  console.log(`  verified ${N} runs, ${total} deliveries (expected ${expected}), 0 duplicates`);
});
