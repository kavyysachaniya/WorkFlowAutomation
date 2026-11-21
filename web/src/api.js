export async function api(path, { method = 'GET', body } = {}) {
  let r;
  try {
    r = await fetch(path, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error('Cannot reach the supervisor on :8787. Is `pnpm dev` running?'), { network: true });
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status, errors: j.errors, engineDown: !!j.engine_down });
  return j;
}

export const shortId = (id) => (id ? id.slice(0, 8) : '');

export function ago(ts, now = Date.now()) {
  const s = Math.round((now - ts) / 1000);
  if (s < 2) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return new Date(ts).toLocaleTimeString();
}

export function until(ts, now = Date.now()) {
  const ms = ts - now;
  if (ms <= 0) return 'due';
  return ms < 10_000 ? `in ${(ms / 1000).toFixed(1)}s` : `in ${Math.round(ms / 1000)}s`;
}

export function describeStep(s) {
  switch (s.type) {
    case 'task': return s.name;
    case 'wait': return `Wait ${s.amount} ${s.unit}${s.amount === 1 ? '' : 's'}`;
    case 'message': return s.body;
    case 'branch': return `If ${s.condition.field} ${opLabel(s.condition.op)}${s.condition.op === 'exists' ? '' : ` ${s.condition.value}`}`;
    default: return s.type;
  }
}

export const opLabel = (op) => ({ eq: 'is', neq: 'is not', gt: '>', lt: '<', contains: 'contains', exists: 'exists' }[op] ?? op);
