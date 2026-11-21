import { useEffect, useState } from 'react';
import { Send, Mail } from 'lucide-react';
import { shortId, ago } from '../api.js';
import { Card, Empty, ErrorBox, Skeleton } from './ui.jsx';
import { CHANNEL_ICON } from './steps.jsx';

export default function Deliveries({ deliveries, total, error, onRetry }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 2000); return () => clearInterval(t); }, []);

  return (
    <Card title="Deliveries" icon={Send} bodyClass="p-0"
      actions={<span className="text-xs text-stone-400 tabular" title="deliveries has UNIQUE(run_id, step_index)">{total ?? 0} total · unique per (run, step)</span>}>
      {error && !deliveries ? <div className="p-4"><ErrorBox title="Could not load deliveries" onRetry={onRetry}>{error.message}</ErrorBox></div>
        : !deliveries ? <Skeleton rows={4} />
        : deliveries.length === 0 ? <Empty icon={Send} title="Nothing delivered yet">Message steps write here inside the same transaction that advances the run. Simulated, nothing is actually sent.</Empty>
        : (
          <ul className="max-h-[420px] divide-y divide-stone-100 overflow-auto">
            {deliveries.map((d) => {
              const Icon = CHANNEL_ICON[d.channel] ?? Mail;
              return (
                <li key={d.id} className="fade-in flex items-start gap-3 px-4 py-2.5">
                  <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-50 text-accent-700"><Icon size={12} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-stone-800">{d.body}</p>
                    <p className="mt-0.5 truncate text-[11px] text-stone-400">
                      <span className="uppercase">{d.channel}</span> · run <span className="font-mono">{shortId(d.run_id)}</span> · step {d.step_index} · {d.workflow_name}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] text-stone-400 tabular">{ago(d.created_at, now)}</span>
                </li>
              );
            })}
          </ul>
        )}
    </Card>
  );
}
