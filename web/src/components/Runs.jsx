import { useEffect, useState, Fragment } from 'react';
import { Activity, ChevronRight, CircleCheck, CircleDashed, Clock, CircleX, LoaderCircle, Lock, SkipForward } from 'lucide-react';
import { api, shortId, ago, until, describeStep } from '../api.js';
import { Badge, Card, Empty, ErrorBox, Skeleton } from './ui.jsx';
import { StepIcon } from './steps.jsx';

const FILTERS = ['all', 'active', 'waiting', 'completed', 'failed'];

function runState(r, now) {
  if (r.status === 'completed') return { label: 'Completed', tone: 'accent', icon: CircleCheck };
  if (r.status === 'failed') return { label: 'Failed', tone: 'red', icon: CircleX };
  if (r.status === 'waiting' && r.wake_at > now) return { label: 'Waiting', tone: 'amber', icon: Clock };
  if (r.lease_owner) return { label: 'Running', tone: 'blue', icon: LoaderCircle, spin: true };
  return { label: 'Queued', tone: 'neutral', icon: CircleDashed };
}

function Timeline({ runId, version }) {
  const [run, setRun] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let alive = true;
    api(`/api/runs/${runId}`).then((r) => { if (alive) { setRun(r); setErr(null); } }).catch((e) => alive && setErr(e));
    return () => { alive = false; };
  }, [runId, version]);

  if (err && !run) return <div className="p-3"><ErrorBox title="Could not load run">{err.message}</ErrorBox></div>;
  if (!run) return <div className="flex items-center gap-2 p-4 text-xs text-stone-500"><LoaderCircle size={14} className="animate-spin" />Loading timeline…</div>;
  const steps = run.workflow?.steps ?? [];
  const log = new Map(run.steps.map((s) => [s.step_index, s]));
  const done = run.status === 'completed' || run.status === 'failed';

  return (
    <div className="grid gap-4 px-4 py-4 md:grid-cols-[1fr_220px]">
      <ol className="relative">
        {steps.map((s, i) => {
          const entry = log.get(i);
          const isCurrent = !done && i === run.step_index;
          const skipped = !entry && (done || i < run.step_index);
          const state = entry ? 'done' : skipped ? 'skipped' : isCurrent ? 'current' : 'pending';
          return (
            <li key={i} className="relative flex gap-3 pb-3 last:pb-0">
              {i < steps.length - 1 && <span className="absolute left-[13px] top-8 h-[calc(100%-1.5rem)] w-px bg-stone-200" />}
              <span className={state === 'pending' || state === 'skipped' ? 'opacity-40' : ''}><StepIcon step={s} size={12} /></span>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-sm ${state === 'skipped' ? 'text-stone-400 line-through' : 'text-stone-800'}`}>{describeStep(s)}</span>
                  {state === 'done' && <CircleCheck size={13} className="text-accent-600" />}
                  {state === 'skipped' && <Badge><SkipForward size={10} />skipped by branch</Badge>}
                  {state === 'current' && (run.status === 'waiting' && run.wake_at > Date.now()
                    ? <Badge tone="amber"><Clock size={10} />wakes {until(run.wake_at)}</Badge>
                    : <Badge tone="blue">next</Badge>)}
                </div>
                {entry && <p className="mt-0.5 truncate font-mono text-[11px] text-stone-500">{entry.result} · {new Date(entry.at).toLocaleTimeString()}</p>}
              </div>
            </li>
          );
        })}
      </ol>
      <dl className="space-y-2 rounded-lg bg-stone-50 p-3 text-xs">
        <div><dt className="text-stone-400">Run ID</dt><dd className="break-all font-mono text-stone-700">{run.id}</dd></div>
        <div><dt className="text-stone-400">Saved step_index</dt><dd className="font-mono text-stone-700">{run.step_index} / {steps.length}</dd></div>
        <div><dt className="text-stone-400">Lease</dt><dd className="font-mono text-stone-700">{run.lease_owner ? `${run.lease_owner} · exp ${until(run.lease_expires)}` : 'none'}</dd></div>
        <div><dt className="text-stone-400">Payload</dt><dd><pre className="overflow-x-auto font-mono text-[11px] text-stone-700">{JSON.stringify(run.context.payload, null, 1)}</pre></dd></div>
        {run.error && <div><dt className="text-red-500">Error</dt><dd className="text-red-700">{run.error}</dd></div>}
      </dl>
    </div>
  );
}

export default function Runs({ runs, error, onRetry, version }) {
  const [filter, setFilter] = useState('all');
  const [openId, setOpenId] = useState(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);

  const shown = (runs ?? []).filter((r) => {
    if (filter === 'all') return true;
    if (filter === 'active') return r.status === 'pending' || (r.status === 'waiting' && r.wake_at <= now);
    if (filter === 'waiting') return r.status === 'waiting' && r.wake_at > now;
    return r.status === filter;
  });

  const tabs = (
    <div className="flex max-w-full overflow-x-auto rounded-lg bg-stone-100 p-0.5" role="tablist">
      {FILTERS.map((f) => (
        <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
          className={`rounded-md px-2 py-1 text-xs font-medium capitalize transition-colors ${filter === f ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-800'}`}>{f}</button>
      ))}
    </div>
  );

  return (
    <Card title="Live runs" icon={Activity} bodyClass="p-0" actions={tabs}>
      {error && !runs ? <div className="p-4"><ErrorBox title="Could not load runs" onRetry={onRetry}>{error.message}</ErrorBox></div>
        : !runs ? <Skeleton rows={6} />
        : shown.length === 0 ? <Empty icon={Activity} title={runs.length ? `No ${filter} runs` : 'No runs yet'}>{runs.length ? 'Try another filter.' : 'Fire a trigger event from a workflow to start a run.'}</Empty>
        : (
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 z-10 bg-white text-[11px] uppercase tracking-wide text-stone-400 shadow-[0_1px_0_#f5f5f4]">
                <tr>
                  <th className="py-2 pl-4 pr-2 font-medium">Run</th>
                  <th className="hidden px-2 py-2 font-medium md:table-cell">Workflow</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 font-medium">Progress</th>
                  <th className="hidden px-2 py-2 font-medium sm:table-cell">Last step</th>
                  <th className="hidden py-2 pl-2 pr-4 text-right font-medium sm:table-cell">Updated</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const st = runState(r, now);
                  const pct = Math.min(100, Math.round((r.step_index / r.total_steps) * 100));
                  const isOpen = openId === r.id;
                  return (
                    <Fragment key={r.id}>
                      <tr onClick={() => setOpenId(isOpen ? null : r.id)} className={`cursor-pointer border-t border-stone-100 transition-colors hover:bg-stone-50 ${isOpen ? 'bg-stone-50' : ''}`}>
                        <td className="py-2.5 pl-4 pr-2">
                          <span className="flex items-center gap-1.5 font-mono text-xs text-stone-700">
                            <ChevronRight size={13} className={`text-stone-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                            {shortId(r.id)}
                            {r.lease_owner && r.status !== 'completed' && <Lock size={11} className="text-stone-400" aria-label="Leased" />}
                          </span>
                        </td>
                        <td className="hidden max-w-[180px] truncate px-2 py-2.5 text-stone-600 md:table-cell">{r.workflow_name}</td>
                        <td className="px-2 py-2.5">
                          <Badge tone={st.tone}><st.icon size={11} className={st.spin ? 'animate-spin' : ''} />{st.label}</Badge>
                          {st.label === 'Waiting' && <span className="ml-1.5 hidden text-[11px] text-stone-400 tabular lg:inline">{until(r.wake_at, now)}</span>}
                        </td>
                        <td className="px-2 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-14 overflow-hidden rounded-full bg-stone-100 sm:w-20">
                              <div className={`h-full rounded-full transition-all duration-500 ${r.status === 'completed' ? 'bg-accent-500' : r.status === 'failed' ? 'bg-red-400' : 'bg-stone-400'}`} style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-[11px] text-stone-400 tabular">{Math.min(r.step_index, r.total_steps)}/{r.total_steps}</span>
                          </div>
                        </td>
                        <td className="hidden max-w-[220px] truncate px-2 py-2.5 font-mono text-[11px] text-stone-500 sm:table-cell">{r.last_result ?? 'none'}</td>
                        <td className="hidden whitespace-nowrap py-2.5 pl-2 pr-4 text-right text-xs text-stone-400 tabular sm:table-cell">{ago(r.updated_at, now)}</td>
                      </tr>
                      {isOpen && <tr className="bg-white"><td colSpan={6} className="border-t border-stone-100 p-0"><Timeline runId={r.id} version={version} /></td></tr>}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
    </Card>
  );
}
