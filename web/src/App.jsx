import { useCallback, useEffect, useRef, useState } from 'react';
import { Power, Skull, Radio, Gauge, TriangleAlert, Workflow as Logo } from 'lucide-react';
import { api } from './api.js';
import { Button } from './components/ui.jsx';
import Builder from './components/Builder.jsx';
import Workflows from './components/Workflows.jsx';
import Runs from './components/Runs.jsx';
import Deliveries from './components/Deliveries.jsx';
import DemoBar from './components/DemoBar.jsx';

const SPEEDS = [1000, 3000, 5000, 10000, 60000];

function useLiveData(engineUp) {
  const [data, setData] = useState({ workflows: null, runs: null, deliveries: null, stats: null });
  const [error, setError] = useState(null);
  const [live, setLive] = useState(false);
  const [version, setVersion] = useState(0);
  const pending = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const [workflows, runs, deliveries, stats] = await Promise.all([
        api('/api/workflows'), api('/api/runs?limit=150'), api('/api/deliveries?limit=60'), api('/api/stats'),
      ]);
      setData({ workflows, runs, deliveries, stats });
      setVersion((v) => v + 1);
      setError(null);
    } catch (e) { setError(e); }
  }, []);

  // Coalesce bursts of SSE events into at most ~3 refreshes/sec.
  const schedule = useCallback(() => {
    if (pending.current) return;
    pending.current = setTimeout(() => { pending.current = null; refresh(); }, 300);
  }, [refresh]);

  useEffect(() => { refresh(); const t = setInterval(refresh, 4000); return () => clearInterval(t); }, [refresh]);

  useEffect(() => {
    if (!engineUp) { setLive(false); return; }    let es, retry, closed = false;
    const connect = () => {
      es = new EventSource('/api/stream');
      es.onopen = () => { setLive(true); refresh(); };
      es.onmessage = () => schedule();
      es.onerror = () => { setLive(false); es.close(); if (!closed) retry = setTimeout(connect, 1500); };
    };
    connect();
    return () => { closed = true; clearTimeout(retry); es?.close(); };
  }, [engineUp, refresh, schedule]);

  return { ...data, error, live, version, refresh };
}

function Stat({ label, value, tone = 'text-stone-900' }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <p className="truncate text-[11px] font-medium uppercase tracking-wide text-stone-400">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold tabular ${tone}`}>{value ?? <span className="text-stone-300">-</span>}</p>
    </div>
  );
}

export default function App() {
  const [sup, setSup] = useState(null);
  const [supErr, setSupErr] = useState(null);
  const [supBusy, setSupBusy] = useState(null);
  const [cfgErr, setCfgErr] = useState(null);
  const [seed, setSeed] = useState(null); // text pushed into the builder from the demo bar

  const pollSup = useCallback(async () => {
    try { setSup(await api('/sup/status')); setSupErr(null); } catch (e) { setSupErr(e); }
  }, []);
  useEffect(() => { pollSup(); const t = setInterval(pollSup, 1000); return () => clearInterval(t); }, [pollSup]);

  const engineUp = !!sup?.running;
  const d = useLiveData(engineUp);
  const s = d.stats;

  async function control(action) {
    setSupBusy(action);
    try { await api(`/sup/${action}`, { method: 'POST' }); await pollSup(); setTimeout(d.refresh, 600); }
    catch (e) { setSupErr(e); }
    finally { setSupBusy(null); }
  }

  async function setSpeed(day_ms) {
    setCfgErr(null);
    try { await api('/api/config', { method: 'PUT', body: { day_ms: Number(day_ms) } }); d.refresh(); }
    catch (e) { setCfgErr(e.message); }
  }

  const active = s ? (s.runs.pending ?? 0) : null;
  const engineDown = sup && !sup.running;

  return (
    <div className="min-h-screen overflow-x-clip">
      <header className="sticky top-0 z-30 border-b border-stone-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-stone-900 text-white"><Logo size={16} /></span>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-stone-900">Workflow Engine</p>
              <p className="text-[11px] text-stone-400">Tech Ahir · durable runs on SQLite</p>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${supErr ? 'bg-red-50 text-red-700' : engineUp ? 'bg-accent-50 text-accent-700' : sup ? 'bg-amber-50 text-amber-800' : 'bg-stone-100 text-stone-500'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${supErr ? 'bg-red-500' : engineUp ? 'bg-accent-500 pulse-dot' : sup ? 'bg-amber-500' : 'bg-stone-400'}`} />
              {supErr ? 'Supervisor unreachable' : !sup ? 'Connecting…' : engineUp ? `Engine up · pid ${sup.pid}` : 'Engine down'}
            </span>
            {engineUp && (
              <span className={`hidden items-center gap-1 text-xs sm:inline-flex ${d.live ? 'text-stone-500' : 'text-stone-400'}`} title="Server-sent events stream">
                <Radio size={12} className={d.live ? 'text-accent-600' : ''} />{d.live ? 'Live' : 'Connecting stream'}
              </span>
            )}
            <label className="flex items-center gap-1.5 text-xs text-stone-500">
              <Gauge size={13} className="text-stone-400" /><span className="hidden sm:inline">1 day =</span>
              <select aria-label="Demo speed: real time per simulated day" disabled={!engineUp || !s} value={s?.day_ms ?? ''} onChange={(e) => setSpeed(e.target.value)}
                className="rounded-md border border-stone-200 bg-white py-1 pl-1.5 pr-6 text-xs text-stone-700 focus:border-accent-500 focus:outline-none disabled:text-stone-300">
                {s && !SPEEDS.includes(s.day_ms) && <option value={s.day_ms}>{s.day_ms / 1000}s</option>}
                {SPEEDS.map((v) => <option key={v} value={v}>{v / 1000}s</option>)}
              </select>
            </label>
            {engineUp
              ? <Button size="sm" variant="danger" icon={Skull} loading={supBusy === 'kill'} onClick={() => control('kill')} title="SIGKILL the engine process (no graceful shutdown)">Kill engine</Button>
              : <Button size="sm" variant="accent" icon={Power} loading={supBusy === 'start'} disabled={!sup} onClick={() => control('start')}>Start engine</Button>}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] space-y-4 px-4 py-5 sm:px-6">
        {supErr && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" /><span>{supErr.message}</span>
          </div>
        )}
        {engineDown && !supErr && (
          <div role="status" className="fade-in flex flex-wrap items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" />
            <span className="min-w-0 flex-1">
              Engine killed{sup.lastExit?.signal ? ` (${sup.lastExit.signal})` : ''}. In-flight runs are frozen in SQLite at their last committed step. Start the engine: it reclaims expired leases and resumes from the saved <code className="font-mono text-xs">step_index</code>. Data below is the last snapshot.
            </span>
          </div>
        )}
        {cfgErr && <p className="text-xs text-red-700">{cfgErr}</p>}

        <div className="grid grid-cols-2 divide-stone-100 overflow-hidden rounded-xl border border-stone-200 bg-white sm:grid-cols-3 sm:divide-x lg:grid-cols-6">
          <Stat label="Workflows" value={d.workflows?.length} />
          <Stat label="Running / queued" value={active} tone="text-sky-700" />
          <Stat label="Waiting" value={s ? s.runs.waiting ?? 0 : null} tone="text-amber-700" />
          <Stat label="Completed" value={s ? s.runs.completed ?? 0 : null} tone="text-accent-700" />
          <Stat label="Failed" value={s ? s.runs.failed ?? 0 : null} tone={s?.runs.failed ? 'text-red-700' : 'text-stone-900'} />
          <Stat label="Deliveries" value={s?.deliveries} />
        </div>

        <DemoBar workflows={d.workflows} engineDown={engineDown} onChanged={d.refresh} onTryText={(text) => setSeed({ text, at: Date.now() })} />

        <div className="grid gap-4 lg:grid-cols-12">
          <div className="min-w-0 space-y-4 lg:col-span-5">
            <Builder onSaved={d.refresh} engineDown={engineDown} seed={seed} />
            <Workflows workflows={d.workflows} error={d.error} onChanged={d.refresh} onRetry={d.refresh} engineDown={engineDown} />
          </div>
          <div className="min-w-0 space-y-4 lg:col-span-7">
            <Runs runs={d.runs} error={d.error} onRetry={d.refresh} version={d.version} />
            <Deliveries deliveries={d.deliveries} total={s?.deliveries} error={d.error} onRetry={d.refresh} />
          </div>
        </div>

        <footer className="pb-6 pt-2 text-center text-[11px] text-stone-400">
          Tasks and messages are simulated (messages are written to the deliveries table, never actually sent). Rule-based parser (no AI).
        </footer>
      </main>
    </div>
  );
}
