import { useEffect, useRef, useState } from 'react';
import { Wand2, ArrowUp, ArrowDown, Trash2, Plus, Save, Info, X, Zap, FilePlus2 } from 'lucide-react';
import { api, describeStep, opLabel } from '../api.js';
import { Button, Badge, Card, ErrorBox, inputCls } from './ui.jsx';
import { StepIcon, STEP_META } from './steps.jsx';

const EXAMPLES = [
  'When a new order arrives, if it is over $500, wait one day, then send a follow-up message',
  'When a user signs up, create their account, then send a "Welcome aboard, {{name}}" email. Wait 2 days. If plan is pro, send a Slack message "New pro signup: {{name}}". After 1 week send a "How is it going?" email.',
  'When a cart is abandoned, wait 1 hour, then email "You left something behind". Wait 1 day. If total is greater than 100, text "Here is 10% off".',
  'When an order is placed, only if total is greater than 50. Tag the customer as VIP and send a "Thanks for your order" email.',
];

const NEW_STEP = {
  task: { type: 'task', name: 'New task', duration_ms: 300 },
  wait: { type: 'wait', amount: 1, unit: 'day' },
  message: { type: 'message', channel: 'email', body: 'Hello {{name}}' },
  branch: { type: 'branch', condition: { field: 'plan', op: 'eq', value: 'pro' }, skip: 1 },
};
const UNITS = ['second', 'minute', 'hour', 'day', 'week', 'month'];
const OPS = ['eq', 'neq', 'gt', 'lt', 'contains', 'exists'];

function Field({ label, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-stone-400">{label}</span>
      {children}
    </label>
  );
}

function StepEditor({ step, onChange }) {
  const set = (patch) => onChange({ ...step, ...patch });
  const setCond = (patch) => onChange({ ...step, condition: { ...step.condition, ...patch } });
  switch (step.type) {
    case 'task':
      return (
        <div className="grid grid-cols-3 gap-2">
          <Field label="Task name" className="col-span-2"><input className={inputCls} value={step.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Sim. work (ms)"><input type="number" min="0" max="2000" className={inputCls} value={step.duration_ms ?? 0} onChange={(e) => set({ duration_ms: Number(e.target.value) })} /></Field>
        </div>
      );
    case 'wait':
      return (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Amount"><input type="number" min="0.1" step="any" className={inputCls} value={step.amount} onChange={(e) => set({ amount: Number(e.target.value) })} /></Field>
          <Field label="Unit"><select className={inputCls} value={step.unit} onChange={(e) => set({ unit: e.target.value })}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select></Field>
        </div>
      );
    case 'message':
      return (
        <div className="grid grid-cols-3 gap-2">
          <Field label="Channel"><select className={inputCls} value={step.channel} onChange={(e) => set({ channel: e.target.value })}>{['email', 'sms', 'slack'].map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Body · supports {{name}}" className="col-span-2"><input className={inputCls} value={step.body} onChange={(e) => set({ body: e.target.value })} /></Field>
        </div>
      );
    case 'branch':
      return (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Field label="Field"><input className={inputCls} value={step.condition.field} onChange={(e) => setCond({ field: e.target.value })} /></Field>
          <Field label="Operator"><select className={inputCls} value={step.condition.op} onChange={(e) => setCond({ op: e.target.value })}>{OPS.map((o) => <option key={o} value={o}>{opLabel(o)}</option>)}</select></Field>
          <Field label="Value"><input className={inputCls} disabled={step.condition.op === 'exists'} value={step.condition.value ?? ''} onChange={(e) => setCond({ value: e.target.value })} /></Field>
          <Field label="If false, skip"><input type="number" min="1" className={inputCls} value={step.skip} onChange={(e) => set({ skip: Math.max(1, parseInt(e.target.value, 10) || 1) })} /></Field>
        </div>
      );
    default: return null;
  }
}

export default function Builder({ onSaved, engineDown, seed }) {
  const [text, setText] = useState('');
  const textRef = useRef(null);
  useEffect(() => {
    if (!seed) return;
    setText(seed.text);
    setParseErr(null);
    textRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    textRef.current?.focus();
  }, [seed]);
  const [parsing, setParsing] = useState(false);
  const [parseErr, setParseErr] = useState(null);
  const [draft, setDraft] = useState(null);
  const [open, setOpen] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState(null);

  async function parse() {
    setParsing(true); setParseErr(null); setSaveErr(null);
    try {
      const r = await api('/api/parse', { method: 'POST', body: { text } });
      setDraft(r.workflow); setOpen(null);
    } catch (e) {
      setParseErr(e); setDraft(null);
    } finally { setParsing(false); }
  }

  async function save() {
    setSaving(true); setSaveErr(null);
    try {
      await api('/api/workflows', { method: 'POST', body: draft });
      setDraft(null); setText(''); setOpen(null);
      onSaved?.();
    } catch (e) { setSaveErr(e); } finally { setSaving(false); }
  }

  const steps = draft?.steps ?? [];
  const setSteps = (s) => setDraft({ ...draft, steps: s });
  const move = (i, d) => { const s = [...steps]; [s[i], s[i + d]] = [s[i + d], s[i]]; setSteps(s); setOpen(open === i ? i + d : open); };
  const remove = (i) => { setSteps(steps.filter((_, k) => k !== i)); setOpen(null); };
  const add = (type) => { setSteps([...steps, structuredClone(NEW_STEP[type])]); setOpen(steps.length); };

  // Which steps are guarded by a branch (for visual nesting)
  const guarded = new Set();
  steps.forEach((s, i) => { if (s.type === 'branch') for (let k = 1; k <= s.skip; k++) guarded.add(i + k); });

  return (
    <Card title="Workflow builder" icon={Wand2} actions={<Badge tone="neutral" className="gap-1"><Info size={11} />Rule-based parser (no AI)</Badge>}>
      <div className="space-y-3">
        <label htmlFor="wf-text" className="sr-only">Describe a workflow in plain English</label>
        <textarea
          id="wf-text"
          ref={textRef}
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim()) parse(); }}
          placeholder='Describe it in plain English, e.g. "When a user signs up, send a welcome email. Wait 2 days. If plan is pro, send a Slack message."'
          className={`${inputCls} resize-y leading-relaxed`}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" icon={Wand2} loading={parsing} disabled={!text.trim() || engineDown} onClick={parse}>Parse</Button>
          <Button variant="ghost" icon={FilePlus2} onClick={() => { setDraft({ name: 'Untitled workflow', trigger: { event: 'user.signed_up' }, conditions: [], steps: [] }); setParseErr(null); setOpen(null); }}>Build manually</Button>
          <span className="ml-auto hidden text-xs text-stone-400 sm:inline">Ctrl + Enter to parse</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className="py-1 text-xs text-stone-400">Examples:</span>
          {EXAMPLES.map((ex, i) => (
            <button key={i} onClick={() => { setText(ex); setParseErr(null); }} className="rounded-md border border-stone-200 px-2 py-1 text-xs text-stone-600 transition-colors hover:border-stone-300 hover:bg-stone-50">
              {['High-value order', 'Onboarding', 'Abandoned cart', 'VIP order'][i]}
            </button>
          ))}
        </div>

        {engineDown && <p className="text-xs text-amber-700">Engine is down. Parsing and saving need the engine. Start it from the top bar.</p>}

        {parseErr && (
          <ErrorBox title={parseErr.errors ? 'The rule-based parser could not understand this' : parseErr.message}>
            {parseErr.errors && (
              <ul className="space-y-1.5">
                {parseErr.errors.map((e, i) => (
                  <li key={i}>
                    {e.clause && <code className="mr-1.5 rounded bg-red-100 px-1 py-0.5 font-mono text-xs">{e.clause}</code>}
                    <span>{e.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </ErrorBox>
        )}

        {draft && (
          <div className="fade-in space-y-3 rounded-lg border border-stone-200 bg-stone-50/60 p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Name"><input className={inputCls} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
              <Field label="Trigger event"><input className={`${inputCls} font-mono text-xs`} value={draft.trigger.event} onChange={(e) => setDraft({ ...draft, trigger: { event: e.target.value } })} /></Field>
            </div>

            {draft.conditions.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-medium uppercase tracking-wide text-stone-400">Only if</span>
                {draft.conditions.map((c, i) => (
                  <Badge key={i} tone="blue">
                    {c.field} {opLabel(c.op)} {c.op !== 'exists' && String(c.value)}
                    <button aria-label="Remove condition" className="ml-0.5 opacity-60 hover:opacity-100" onClick={() => setDraft({ ...draft, conditions: draft.conditions.filter((_, k) => k !== i) })}><X size={11} /></button>
                  </Badge>
                ))}
              </div>
            )}

            <ol className="space-y-1.5">
              <li className="flex items-center gap-2.5 rounded-lg border border-dashed border-stone-300 bg-white px-2.5 py-2 text-sm">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-stone-900 text-white"><Zap size={14} /></span>
                <span className="text-stone-500">On</span><code className="font-mono text-xs text-stone-800">{draft.trigger.event || '…'}</code>
              </li>
              {steps.map((s, i) => (
                <li key={i} className={`fade-in rounded-lg border bg-white transition-colors ${open === i ? 'border-stone-300' : 'border-stone-200'} ${guarded.has(i) ? 'ml-6' : ''}`}>
                  <div className="flex items-center gap-2.5 px-2.5 py-2">
                    <button className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                      <StepIcon step={s} />
                      <span className="min-w-0">
                        <span className="block text-[11px] font-medium uppercase tracking-wide text-stone-400">{i + 1} · {STEP_META[s.type].label}{s.type === 'message' && ` · ${s.channel} (simulated)`}{s.type === 'task' && ' · simulated work'}</span>
                        <span className="block truncate text-sm text-stone-800">{describeStep(s)}{s.type === 'branch' && <span className="text-stone-400"> · else skip {s.skip}</span>}</span>
                      </span>
                    </button>
                    <div className="flex items-center">
                      <Button size="icon" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} icon={ArrowUp} />
                      <Button size="icon" variant="ghost" aria-label="Move down" disabled={i === steps.length - 1} onClick={() => move(i, 1)} icon={ArrowDown} />
                      <Button size="icon" variant="ghost" aria-label="Delete step" onClick={() => remove(i)} icon={Trash2} />
                    </div>
                  </div>
                  {open === i && <div className="border-t border-stone-100 px-2.5 py-2.5"><StepEditor step={s} onChange={(ns) => setSteps(steps.map((x, k) => (k === i ? ns : x)))} /></div>}
                </li>
              ))}
              {steps.length === 0 && <li className="px-2 py-3 text-center text-xs text-stone-500">No steps yet. Add one below.</li>}
            </ol>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-stone-400">Add</span>
              {Object.keys(NEW_STEP).map((t) => <Button key={t} size="sm" variant="secondary" icon={Plus} onClick={() => add(t)}>{STEP_META[t].label}</Button>)}
            </div>

            {saveErr && (
              <ErrorBox title={saveErr.message}>
                {saveErr.errors && <ul className="list-inside list-disc">{saveErr.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
              </ErrorBox>
            )}
            <div className="flex justify-end gap-2 border-t border-stone-200 pt-3">
              <Button variant="ghost" onClick={() => { setDraft(null); setSaveErr(null); }}>Discard</Button>
              <Button variant="accent" icon={Save} loading={saving} disabled={!steps.length || engineDown} onClick={save}>Save workflow</Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
