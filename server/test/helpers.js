// Shared helpers for the engine integration tests (spawn real engine processes, inspect SQLite).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ENGINE = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'server.js');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const tempDb = (name) => join(tmpdir(), `wf-${name}-${process.pid}-${Date.now()}.db`);
export function removeDb(db) {
  for (const s of ['', '-wal', '-shm']) { try { rmSync(db + s, { force: true }); } catch {} }
}

export function startEngine({ port, db, env = {} }) {
  const p = spawn(process.execPath, [ENGINE], {
    env: { ...process.env, NODE_NO_WARNINGS: '1', PORT: String(port), DB_PATH: db, DAY_MS: '250', LEASE_MS: '800', MAX_CONCURRENCY: '64', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  p.stdout.on('data', (d) => process.env.VERBOSE && process.stdout.write(d));
  p.stderr.on('data', (d) => process.stderr.write(d));
  return p;
}

export const exited = (p) => new Promise((r) => (p.exitCode !== null || p.signalCode ? r() : p.once('exit', r)));

export async function waitHealthy(port) {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return; } catch {}
    await sleep(100);
  }
  throw new Error(`engine on :${port} did not become healthy`);
}

export async function api(port, path, body) {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json();
  if (!r.ok) throw new Error(`${path} ${r.status} ${JSON.stringify(j)}`);
  return j;
}

export function snapshot(db) {
  const d = new DatabaseSync(db, { readOnly: true });
  try {
    const runs = Object.fromEntries(d.prepare('SELECT status, COUNT(*) n FROM runs GROUP BY status').all().map((r) => [r.status, r.n]));
    return { runs, deliveries: d.prepare('SELECT COUNT(*) n FROM deliveries').get().n };
  } finally { d.close(); }
}

export async function waitAllCompleted(db, n, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let snap;
  while (Date.now() < deadline) {
    snap = snapshot(db);
    if ((snap.runs.completed ?? 0) === n) return snap;
    await sleep(200);
  }
  return snap;
}

// 8-step workflow; step indexes:  0 task, 1 email, 2 wait, 3 task, 4 branch, 5 slack (pro only), 6 wait, 7 sms
export const STEPS = [
  { type: 'task', name: 'Create account', duration_ms: 15 },
  { type: 'message', channel: 'email', body: 'Welcome {{name}}' },
  { type: 'wait', amount: 1, unit: 'day' },
  { type: 'task', name: 'Enrich profile', duration_ms: 15 },
  { type: 'branch', condition: { field: 'plan', op: 'eq', value: 'pro' }, skip: 1 },
  { type: 'message', channel: 'slack', body: 'Pro signup: {{name}}' },
  { type: 'wait', amount: 1, unit: 'day' },
  { type: 'message', channel: 'sms', body: 'Day 2 check-in for {{name}}' },
];
const MSG_STEPS = (plan) => (plan === 'pro' ? [1, 5, 7] : [1, 7]);
const LOG_STEPS = (plan) => (plan === 'pro' ? [0, 1, 2, 3, 4, 5, 6, 7] : [0, 1, 2, 3, 4, 6, 7]);

export const payloadFor = (n) => ({ name: `user${n}`, plan: n % 2 ? 'pro' : 'free' });

// Asserts the exactly-once invariants for every run. Returns summary numbers.
export function verifyExactlyOnce(db, workflowId, n) {
  const d = new DatabaseSync(db, { readOnly: true });
  try {
    const runs = d.prepare('SELECT id, status, context_json, lease_owner FROM runs WHERE workflow_id = ?').all(workflowId);
    assert.equal(runs.length, n, 'run count');
    let expected = 0;
    for (const r of runs) {
      assert.equal(r.status, 'completed', `run ${r.id} completed`);
      const plan = JSON.parse(r.context_json).payload.plan;
      const dels = d.prepare('SELECT step_index, COUNT(*) c FROM deliveries WHERE run_id = ? GROUP BY step_index ORDER BY step_index').all(r.id);
      assert.deepEqual(dels.map((x) => x.step_index), MSG_STEPS(plan), `run ${r.id} deliveries`);
      for (const x of dels) assert.equal(x.c, 1, `run ${r.id} step ${x.step_index} delivered exactly once`);
      const logs = d.prepare('SELECT step_index FROM step_log WHERE run_id = ? ORDER BY step_index').all(r.id).map((x) => x.step_index);
      assert.deepEqual(logs, LOG_STEPS(plan), `run ${r.id} step_log`);
      assert.equal(r.lease_owner, null, `run ${r.id} lease released`);
      expected += MSG_STEPS(plan).length;
    }
    const scope = 'FROM deliveries WHERE run_id IN (SELECT id FROM runs WHERE workflow_id = ?)';
    const total = d.prepare(`SELECT COUNT(*) n ${scope}`).get(workflowId).n;
    const distinct = d.prepare(`SELECT COUNT(*) n FROM (SELECT DISTINCT run_id, step_index ${scope})`).get(workflowId).n;
    assert.equal(total, expected, 'total deliveries = expected message steps');
    assert.equal(distinct, total, 'no duplicate (run, step) deliveries');
    const byEngine = d.prepare('SELECT engine, COUNT(*) n FROM step_log WHERE run_id IN (SELECT id FROM runs WHERE workflow_id = ?) GROUP BY engine').all(workflowId);
    return { total, expected, byEngine };
  } finally { d.close(); }
}
