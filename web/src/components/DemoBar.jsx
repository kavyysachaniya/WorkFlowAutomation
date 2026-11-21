import { useState } from 'react';
import { Sparkles, ShoppingCart, CircleCheck } from 'lucide-react';
import { api } from '../api.js';
import { Button } from './ui.jsx';

export const DEMO_TEXT = 'When a new order arrives, if it is over $500, wait one day, then send a follow-up message';
export const DEMO_NAME = 'High-value order follow-up';

// Fixed demo payloads: 11 orders over $500, 9 at or under. Clearly labelled demo data.
const TOTALS = [1200, 320, 640, 75, 980, 510, 300, 2200, 45, 760, 499, 1500, 88, 905, 250, 600, 150, 1750, 500, 830];
const NAMES = ['Asha', 'Ravi', 'Meera', 'Kabir', 'Isha', 'Arjun', 'Nisha', 'Dev', 'Tara', 'Vikram'];

export default function DemoBar({ workflows, engineDown, onChanged, onTryText }) {
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  const hasDemo = !!workflows?.some((w) => w.name === DEMO_NAME);
  const listensForOrders = !!workflows?.some((w) => w.trigger.event === 'order.placed');

  async function loadDemo() {
    setBusy('load'); setErr(null); setMsg(null);
    try {
      const parsed = await api('/api/parse', { method: 'POST', body: { text: DEMO_TEXT, name: DEMO_NAME } });
      await api('/api/workflows', { method: 'POST', body: parsed.workflow });
      setMsg(`Created "${DEMO_NAME}" from plain English (${parsed.workflow.steps.length} steps). Now fire some orders.`);
      onChanged?.();
    } catch (e) {
      setErr(e.errors ? `${e.message}: ${e.errors.map((x) => x.reason ?? x).join('; ')}` : e.message);
    } finally { setBusy(null); }
  }

  async function fireOrders() {
    setBusy('fire'); setErr(null); setMsg(null);
    try {
      const results = await Promise.all(TOTALS.map((total, i) => api('/api/events', {
        method: 'POST',
        body: { event: 'order.placed', payload: { order_id: `ORD-${1000 + i}`, name: NAMES[i % NAMES.length], email: `${NAMES[i % NAMES.length].toLowerCase()}@example.com`, total } },
      })));
      const runs = results.reduce((n, r) => n + r.runs.filter((x) => x.run_id).length, 0);
      const big = TOTALS.filter((t) => t > 500).length;
      setMsg(`Fired 20 orders → ${runs} runs. ${big} are over $500 (wait 1 day, then follow-up); ${20 - big} skip the branch and complete immediately.`);
      onChanged?.();
    } catch (e) { setErr(e.message); } finally { setBusy(null); }
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-dashed border-stone-300 bg-white px-4 py-3 md:flex-row md:items-center">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-stone-400">
          <Sparkles size={12} />Demo data
        </p>
        <p className="mt-1 text-sm text-stone-700">
          <button type="button" onClick={() => onTryText?.(DEMO_TEXT)} className="text-left underline decoration-stone-300 underline-offset-2 hover:decoration-stone-500" title="Put this sentence in the builder">
            "{DEMO_TEXT}"
          </button>
        </p>
        {msg && <p className="fade-in mt-1 text-xs text-accent-700">{msg}</p>}
        {err && <p className="fade-in mt-1 text-xs text-red-700">{err}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {hasDemo
          ? <span className="inline-flex h-9 items-center gap-1.5 px-1 text-xs text-accent-700"><CircleCheck size={14} />Demo loaded</span>
          : <Button variant="secondary" icon={Sparkles} loading={busy === 'load'} disabled={engineDown || !workflows || !!busy} onClick={loadDemo}>Load demo</Button>}
        <Button variant="primary" icon={ShoppingCart} loading={busy === 'fire'} disabled={engineDown || !listensForOrders || !!busy} onClick={fireOrders}
          title={listensForOrders ? 'Fire 20 order.placed events with varied totals' : 'Load the demo first (no workflow listens for order.placed)'}>
          Fire 20 orders
        </Button>
      </div>
    </section>
  );
}
