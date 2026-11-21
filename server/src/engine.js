import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

export const UNIT_DAYS = { second: 1 / 86400, minute: 1 / 1440, hour: 1 / 24, day: 1, week: 7, month: 30 };
export const OPS = ['eq', 'neq', 'gt', 'lt', 'contains', 'exists'];
export const CHANNELS = ['email', 'sms', 'slack'];
const TERMINAL = new Set(['completed', 'failed']);

// ---------- validation ----------
function validCond(c, where, errors) {
  if (!c || typeof c.field !== 'string' || !c.field) errors.push(`${where}: condition needs a field`);
  else if (!OPS.includes(c.op)) errors.push(`${where}: unknown operator "${c?.op}"`);
}

export function validateWorkflow(def) {
  const errors = [];
  if (!def || typeof def !== 'object') return { errors: ['Body must be a workflow object'] };
  if (!def.name || typeof def.name !== 'string') errors.push('name is required');
  if (!def.trigger?.event || typeof def.trigger.event !== 'string') errors.push('trigger.event is required');
  const conditions = def.conditions ?? [];
  if (!Array.isArray(conditions)) errors.push('conditions must be an array');
  else conditions.forEach((c, i) => validCond(c, `conditions[${i}]`, errors));
  if (!Array.isArray(def.steps) || def.steps.length === 0) errors.push('at least one step is required');
  else def.steps.forEach((s, i) => {
    const w = `steps[${i}]`;
    switch (s?.type) {
      case 'task': if (!s.name) errors.push(`${w}: task needs a name`); break;
      case 'wait':
        if (!(Number(s.amount) > 0)) errors.push(`${w}: wait amount must be > 0`);
        if (!UNIT_DAYS[s.unit]) errors.push(`${w}: unknown unit "${s.unit}"`);
        break;
      case 'message':
        if (!s.body) errors.push(`${w}: message needs a body`);
        if (!CHANNELS.includes(s.channel)) errors.push(`${w}: unknown channel "${s.channel}"`);
        break;
      case 'branch':
        validCond(s.condition, w, errors);
        if (!Number.isInteger(s.skip) || s.skip < 1) errors.push(`${w}: branch skip must be an integer >= 1`);
        break;
      default: errors.push(`${w}: unknown step type "${s?.type}"`);
    }
  });
  return { errors };
}

// ---------- helpers ----------
const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const norm = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v);

export function evalCond(c, payload) {
  const a = getPath(payload, c.field);
  const b = c.value;
  switch (c.op) {
    case 'exists': return a !== undefined && a !== null && a !== '';
    case 'eq': return String(norm(a)) === String(norm(b));
    case 'neq': return String(norm(a)) !== String(norm(b));
    case 'gt': return Number(a) > Number(b);
    case 'lt': return Number(a) < Number(b);
    case 'contains': return String(norm(a) ?? '').includes(String(norm(b)));
    default: return false;
  }
}

export const render = (tpl, payload) =>
  String(tpl).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, p) => { const v = getPath(payload, p); return v == null ? '' : String(v); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- engine ----------
export function createEngine({ db, owner = `engine-${process.pid}-${randomUUID().slice(0, 6)}`, leaseMs = 3000, maxConcurrency = 64, tickMs = 250, defaultDayMs = 3000, log = console.log } = {}) {
  const events = new EventEmitter();
  events.setMaxListeners(0);
  const inflight = new Set();
  let timer = null;
  const startedAt = Date.now();

  const q = {
    getRun: db.prepare('SELECT * FROM runs WHERE id = ?'),
    getWf: db.prepare('SELECT * FROM workflows WHERE id = ?'),
    claim: db.prepare(`UPDATE runs SET lease_owner = ?, lease_expires = ?
      WHERE id IN (SELECT id FROM runs WHERE status IN ('pending','waiting') AND wake_at <= ?
        AND (lease_owner IS NULL OR lease_expires < ?) ORDER BY wake_at LIMIT ?)
      RETURNING id`),
    logStep: db.prepare('INSERT INTO step_log(run_id, step_index, type, result, at, engine) VALUES (?,?,?,?,?,?)'),
    deliver: db.prepare('INSERT INTO deliveries(run_id, step_index, channel, body, created_at) VALUES (?,?,?,?,?)'),
    advance: db.prepare(`UPDATE runs SET step_index = ?, status = ?, wake_at = ?, lease_owner = ?, lease_expires = ?, updated_at = ?, error = ? WHERE id = ?`),
    getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    setSetting: db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
  };

  const emit = (e) => events.emit('event', { ...e, at: Date.now() });

  function getConfig() {
    const v = q.getSetting.get('day_ms');
    return { day_ms: v ? Number(v.value) : defaultDayMs };
  }
  function setConfig({ day_ms }) {
    const n = Number(day_ms);
    if (!Number.isFinite(n) || n < 50 || n > 86_400_000) throw Object.assign(new Error('day_ms must be between 50 and 86400000'), { status: 422 });
    q.setSetting.run('day_ms', String(Math.round(n)));
    emit({ type: 'config', ...getConfig() });
    return getConfig();
  }

  function tx(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const out = fn(); db.exec('COMMIT'); return out; }
    catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
  }

  function createWorkflow(def) {
    const { errors } = validateWorkflow(def);
    if (errors.length) throw Object.assign(new Error('Invalid workflow'), { status: 422, errors });
    const wf = { name: def.name, trigger: { event: def.trigger.event }, conditions: def.conditions ?? [], steps: def.steps };
    const id = randomUUID();
    db.prepare('INSERT INTO workflows(id, name, definition_json, enabled, created_at) VALUES (?,?,?,1,?)')
      .run(id, wf.name, JSON.stringify(wf), Date.now());
    emit({ type: 'workflow.created', workflow_id: id });
    return { id, ...wf };
  }

  function listWorkflows() {
    return db.prepare('SELECT * FROM workflows WHERE enabled = 1 ORDER BY created_at DESC').all()
      .map((r) => ({ id: r.id, created_at: r.created_at, ...JSON.parse(r.definition_json) }));
  }

  function archiveWorkflow(id) {
    const r = db.prepare('UPDATE workflows SET enabled = 0 WHERE id = ?').run(id);
    emit({ type: 'workflow.archived', workflow_id: id });
    return r.changes > 0;
  }

  // Fire a trigger event; one run per matching workflow. event_id is an idempotency key.
  function fireEvent({ event, payload = {}, event_id = null }) {
    if (!event || typeof event !== 'string') throw Object.assign(new Error('event is required'), { status: 422 });
    const now = Date.now();
    const created = [];
    const ins = db.prepare(`INSERT OR IGNORE INTO runs(id, workflow_id, event_id, status, step_index, context_json, wake_at, created_at, updated_at)
      VALUES (?,?,?,'pending',0,?,?,?,?)`);
    let matched = 0;
    tx(() => {
      for (const wf of listWorkflows()) {
        if (wf.trigger.event !== event) continue;
        if (!wf.conditions.every((c) => evalCond(c, payload))) continue;
        matched++;
        const id = randomUUID();
        const r = ins.run(id, wf.id, event_id, JSON.stringify({ event, payload }), now, now, now);
        created.push({ workflow_id: wf.id, run_id: r.changes ? id : null, duplicate: !r.changes });
      }
    });
    for (const c of created) if (c.run_id) emit({ type: 'run.created', run_id: c.run_id, workflow_id: c.workflow_id });
    return { matched, runs: created };
  }

  // Executes one step + advances the run in ONE transaction. Returns { release } or null if we lost the lease.
  function commitStep(runId, idx, def, ctx) {
    const evts = [];
    const res = tx(() => {
      const cur = q.getRun.get(runId);
      if (!cur || cur.lease_owner !== owner || cur.step_index !== idx || TERMINAL.has(cur.status)) return null;
      const now = Date.now();
      const steps = def.steps;
      const step = steps[idx];
      const finish = (next, extra = {}) => {
        if (next >= steps.length && !extra.waitUntil) {
          q.advance.run(next, 'completed', now, null, null, now, null, runId);
          evts.push({ type: 'run.completed', run_id: runId });
          return { release: true };
        }
        if (extra.waitUntil) {
          q.advance.run(next, 'waiting', extra.waitUntil, null, null, now, null, runId);
          return { release: true };
        }
        q.advance.run(next, 'pending', now, owner, now + leaseMs, now, null, runId);
        return { release: false };
      };

      if (!step) return finish(idx); // e.g. woke up after a trailing wait

      let result, next = idx + 1, waitUntil = null;
      switch (step.type) {
        case 'task': result = `simulated task done: ${step.name}`; break;
        case 'message': {
          const body = render(step.body, ctx.payload);
          q.deliver.run(runId, idx, step.channel, body, now);
          result = `${step.channel}: ${body}`;
          evts.push({ type: 'delivery', run_id: runId, step_index: idx, channel: step.channel, body });
          break;
        }
        case 'wait': {
          const ms = Math.max(20, Math.round(Number(step.amount) * UNIT_DAYS[step.unit] * getConfig().day_ms));
          waitUntil = now + ms;
          result = `wait ${step.amount} ${step.unit}${Number(step.amount) === 1 ? '' : 's'} (${ms}ms demo)`;
          break;
        }
        case 'branch': {
          const pass = evalCond(step.condition, ctx.payload);
          if (!pass) next = idx + 1 + step.skip;
          result = pass ? 'true, continue' : `false, skip ${step.skip}`;
          break;
        }
        default: throw new Error(`unknown step type ${step.type}`);
      }
      q.logStep.run(runId, idx, step.type, result, now, owner);
      evts.push({ type: 'step', run_id: runId, step_index: idx, step_type: step.type, result });
      return finish(next, { waitUntil });
    });
    for (const e of evts) emit(e);
    if (res) emit({ type: 'run.updated', run_id: runId });
    return res;
  }

  function failRun(runId, error) {
    const now = Date.now();
    db.prepare(`UPDATE runs SET status='failed', error=?, lease_owner=NULL, lease_expires=NULL, updated_at=? WHERE id=? AND lease_owner=?`)
      .run(error, now, runId, owner);
    emit({ type: 'run.failed', run_id: runId, error });
  }

  async function processRun(id) {
    for (;;) {
      const run = q.getRun.get(id);
      if (!run || run.lease_owner !== owner || TERMINAL.has(run.status)) return;
      const wf = q.getWf.get(run.workflow_id);
      if (!wf) return failRun(id, 'workflow not found');
      const def = JSON.parse(wf.definition_json);
      const ctx = JSON.parse(run.context_json);
      const step = def.steps[run.step_index];
      // Simulated work happens OUTSIDE the transaction; its effects are committed atomically below.
      if (step?.type === 'task' && step.duration_ms) await sleep(Math.min(Number(step.duration_ms), 2000));
      const res = commitStep(id, run.step_index, def, ctx);
      if (!res || res.release) return;
    }
  }

  function tick() {
    const room = maxConcurrency - inflight.size;
    if (room <= 0) return;
    const now = Date.now();
    let ids;
    try { ids = q.claim.all(owner, now + leaseMs, now, now, room).map((r) => r.id); }
    catch (e) { log('claim failed', e.message); return; }
    for (const id of ids) {
      if (inflight.has(id)) continue;
      inflight.add(id);
      processRun(id)
        .catch((e) => {
          // Lock contention (another engine holds the write lock) is transient: leave the lease
          // to expire and the run is retried. Only genuine step errors fail the run.
          if (/database is locked|SQLITE_BUSY/i.test(`${e.message} ${e.code ?? ''}`)) { log('busy, will retry', id); return; }
          log('run error', id, e.message);
          try { failRun(id, e.message); } catch {}
        })
        .finally(() => inflight.delete(id));
    }
  }

  function start() {
    const now = Date.now();
    const r = db.prepare(`UPDATE runs SET lease_owner = NULL, lease_expires = NULL
      WHERE lease_owner IS NOT NULL AND lease_expires < ? AND status IN ('pending','waiting')`).run(now);
    const resumable = db.prepare(`SELECT COUNT(*) n FROM runs WHERE status IN ('pending','waiting')`).get().n;
    log(`[engine ${owner}] boot: reclaimed ${r.changes} expired leases, ${resumable} runs resumable`);
    emit({ type: 'engine.boot', owner, reclaimed: r.changes, resumable });
    timer = setInterval(tick, tickMs);
    tick();
  }
  function stop() { clearInterval(timer); timer = null; }

  function stats() {
    const byStatus = Object.fromEntries(db.prepare('SELECT status, COUNT(*) n FROM runs GROUP BY status').all().map((r) => [r.status, r.n]));
    const deliveries = db.prepare('SELECT COUNT(*) n FROM deliveries').get().n;
    const leased = db.prepare('SELECT COUNT(*) n FROM runs WHERE lease_owner IS NOT NULL').get().n;
    return { owner, pid: process.pid, uptime_ms: Date.now() - startedAt, inflight: inflight.size, leased, runs: byStatus, deliveries, ...getConfig() };
  }

  function listRuns({ limit = 100, workflow_id } = {}) {
    const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const where = workflow_id ? 'WHERE r.workflow_id = ?' : '';
    const rows = db.prepare(`SELECT r.*, w.name AS workflow_name, w.definition_json,
        (SELECT result FROM step_log s WHERE s.run_id = r.id ORDER BY step_index DESC LIMIT 1) AS last_result
      FROM runs r JOIN workflows w ON w.id = r.workflow_id ${where} ORDER BY r.created_at DESC, r.id LIMIT ${lim}`)
      .all(...(workflow_id ? [workflow_id] : []));
    return rows.map(({ definition_json, context_json, ...r }) => ({
      ...r, total_steps: JSON.parse(definition_json).steps.length, payload: JSON.parse(context_json).payload,
    }));
  }

  function getRun(id) {
    const r = q.getRun.get(id);
    if (!r) return null;
    const wf = q.getWf.get(r.workflow_id);
    return {
      ...r, context: JSON.parse(r.context_json), context_json: undefined,
      workflow: wf ? { id: wf.id, name: wf.name, ...JSON.parse(wf.definition_json) } : null,
      steps: db.prepare('SELECT * FROM step_log WHERE run_id = ? ORDER BY step_index').all(id),
      deliveries: db.prepare('SELECT * FROM deliveries WHERE run_id = ? ORDER BY step_index').all(id),
    };
  }

  function listDeliveries({ limit = 50 } = {}) {
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 500);
    return db.prepare(`SELECT d.*, w.name AS workflow_name FROM deliveries d JOIN runs r ON r.id = d.run_id
      JOIN workflows w ON w.id = r.workflow_id ORDER BY d.id DESC LIMIT ${lim}`).all();
  }

  return { owner, events, start, stop, tick, createWorkflow, listWorkflows, archiveWorkflow, fireEvent, listRuns, getRun, listDeliveries, stats, getConfig, setConfig };
}
