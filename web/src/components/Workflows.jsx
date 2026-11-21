import { useState } from 'react';
import { Workflow, Play, Layers, Archive, ChevronDown } from 'lucide-react';
import { api, describeStep, opLabel } from '../api.js';
import { Button, Badge, Card, Empty, ErrorBox, Skeleton, inputCls } from './ui.jsx';
import { StepIcon } from './steps.jsx';

const NAMES = ['Asha', 'Ravi', 'Meera', 'Kabir', 'Isha', 'Arjun', 'Nisha', 'Dev'];
const defaultPayload = (wf) => {
  const p = { name: 'Asha', email: 'asha@example.com', plan: 'pro' };
  for (const c of [...wf.conditions, ...wf.steps.filter((s) => s.type === 'branch').map((s) => s.condition)]) {
    if (!(c.field in p)) p[c.field] = c.op === 'gt' ? Number(c.value) + 50 : c.op === 'lt' ? Number(c.value) - 1 : c.value ?? true;
  }
  return JSON.stringify(p, null, 2);
};

function WorkflowRow({ wf, onChanged, engineDown }) {
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState(() => defaultPayload(wf));
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  async function fire(count) {
    let parsed;
    try { parsed = JSON.parse(payload); } catch { setErr('Payload is not valid JSON'); setOpen(true); return; }
    setBusy(count); setErr(null); setMsg(null);
    try {
      let runs = 0, matched = 0;
      const batch = Array.from({ length: count }, (_, i) => {
        const p = count === 1 ? parsed : { ...parsed, name: `${NAMES[i % NAMES.length]} ${i + 1}`, plan: i % 2 ? 'free' : parsed.plan ?? 'pro' };
        return api('/api/events', { method: 'POST', body: { event: wf.trigger.event, payload: p } });
      });
      for (const r of await Promise.all(batch)) { matched = Math.max(matched, r.matched); runs += r.runs.filter((x) => x.run_id).length; }
      setMsg(runs ? `Started ${runs} run${runs > 1 ? 's' : ''}${matched > 1 ? ` across ${matched} workflows listening on this event` : ''}` : 'Event fired, but no workflow conditions matched this payload');
      onChanged?.();
    } catch (e) { setErr(e.message); } finally { setBusy(null); }
  }

  async function archive() {
    setBusy('archive'); setErr(null);
    try { await api(`/api/workflows/${wf.id}`, { method: 'DELETE' }); onChanged?.(); }
    catch (e) { setErr(e.message); setBusy(null); }
  }

  return (
    <li className="fade-in px-4 py-3">
      <div className="flex flex-wrap items-start gap-3">
        <button onClick={() => setOpen(!open)} className="group min-w-0 flex-1 text-left" aria-expanded={open}>
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-stone-900">{wf.name}</span>
            <ChevronDown size={14} className={`shrink-0 text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] text-stone-600">{wf.trigger.event}</code>
            {wf.conditions.map((c, i) => <Badge key={i} tone="blue">{c.field} {opLabel(c.op)} {c.op !== 'exists' && String(c.value)}</Badge>)}
            <span className="text-xs text-stone-400">{wf.steps.length} steps</span>
          </div>
        </button>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="primary" icon={Play} loading={busy === 1} disabled={!!busy || engineDown} onClick={() => fire(1)}>Fire</Button>
          <Button size="sm" variant="secondary" icon={Layers} loading={busy === 25} disabled={!!busy || engineDown} onClick={() => fire(25)} title="Fire 25 events with varied demo payloads">×25</Button>
          <Button size="icon" variant="ghost" aria-label="Archive workflow" title="Archive" loading={busy === 'archive'} disabled={!!busy || engineDown} onClick={archive} icon={Archive} />
        </div>
      </div>
      {msg && <p className="fade-in mt-2 text-xs text-accent-700">{msg}</p>}
      {err && <p className="fade-in mt-2 text-xs text-red-700">{err}</p>}
      {open && (
        <div className="fade-in mt-3 grid gap-3 md:grid-cols-2">
          <ol className="space-y-1">
            {wf.steps.map((s, i) => (
              <li key={i} className="flex items-center gap-2 text-sm">
                <StepIcon step={s} size={12} />
                <span className="truncate text-stone-700">{describeStep(s)}</span>
              </li>
            ))}
          </ol>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-stone-400">Demo event payload (JSON)</span>
            <textarea rows={5} value={payload} onChange={(e) => setPayload(e.target.value)} className={`${inputCls} font-mono text-xs`} spellCheck={false} />
          </label>
        </div>
      )}
    </li>
  );
}

export default function Workflows({ workflows, error, onChanged, onRetry, engineDown }) {
  return (
    <Card title="Workflows" icon={Workflow} bodyClass="p-0" actions={workflows && <span className="text-xs text-stone-400 tabular">{workflows.length} active</span>}>
      {error && !workflows ? <div className="p-4"><ErrorBox title="Could not load workflows" onRetry={onRetry}>{error.message}</ErrorBox></div>
        : !workflows ? <Skeleton rows={3} />
        : workflows.length === 0 ? <Empty icon={Workflow} title="No workflows yet">Describe one in the builder or pick an example, then fire its trigger event.</Empty>
        : <ul className="divide-y divide-stone-100">{workflows.map((wf) => <WorkflowRow key={wf.id} wf={wf} onChanged={onChanged} engineDown={engineDown} />)}</ul>}
    </Card>
  );
}
