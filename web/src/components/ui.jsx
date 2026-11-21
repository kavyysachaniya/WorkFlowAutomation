import { LoaderCircle, TriangleAlert, Inbox } from 'lucide-react';

export function Card({ title, icon: Icon, actions, children, className = '', bodyClass = '' }) {
  return (
    <section className={`min-w-0 rounded-xl border border-stone-200 bg-white ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-stone-900">
            {Icon && <Icon size={15} className="text-stone-400" />}
            {title}
          </h2>
          {actions && <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={bodyClass || 'p-4'}>{children}</div>
    </section>
  );
}

const VARIANTS = {
  primary: 'bg-stone-900 text-white hover:bg-stone-800 disabled:bg-stone-300',
  accent: 'bg-accent-600 text-white hover:bg-accent-700 disabled:bg-stone-300',
  secondary: 'border border-stone-200 bg-white text-stone-700 hover:bg-stone-50 hover:border-stone-300 disabled:text-stone-300',
  ghost: 'text-stone-500 hover:bg-stone-100 hover:text-stone-800 disabled:text-stone-300',
  danger: 'border border-red-200 bg-white text-red-700 hover:bg-red-50 disabled:text-stone-300 disabled:border-stone-200',
};

export function Button({ variant = 'secondary', size = 'md', loading, icon: Icon, children, className = '', ...props }) {
  const sz = size === 'sm' ? 'h-7 px-2.5 text-xs gap-1.5' : size === 'icon' ? 'h-7 w-7 justify-center' : 'h-9 px-3.5 text-sm gap-2';
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={`inline-flex shrink-0 items-center rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 disabled:cursor-not-allowed ${sz} ${VARIANTS[variant]} ${className}`}
    >
      {loading ? <LoaderCircle size={14} className="animate-spin" /> : Icon && <Icon size={size === 'md' ? 15 : 14} />}
      {children}
    </button>
  );
}

const TONES = {
  neutral: 'bg-stone-100 text-stone-600',
  accent: 'bg-accent-50 text-accent-700 ring-1 ring-inset ring-accent-100',
  amber: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-100',
  blue: 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-100',
  red: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-100',
};
export function Badge({ tone = 'neutral', children, className = '' }) {
  return <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${TONES[tone]} ${className}`}>{children}</span>;
}

export function ErrorBox({ title = 'Something went wrong', children, onRetry }) {
  return (
    <div role="alert" className="fade-in flex gap-3 rounded-lg border border-red-200 bg-red-50/60 p-3 text-sm text-red-800">
      <TriangleAlert size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        {children && <div className="mt-1 text-red-700/90">{children}</div>}
      </div>
      {onRetry && <Button size="sm" variant="secondary" onClick={onRetry}>Retry</Button>}
    </div>
  );
}

export function Empty({ icon: Icon = Inbox, title, children }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <div className="mb-3 rounded-full bg-stone-100 p-2.5 text-stone-400"><Icon size={18} /></div>
      <p className="text-sm font-medium text-stone-700">{title}</p>
      {children && <p className="mt-1 max-w-xs text-xs text-stone-500">{children}</p>}
    </div>
  );
}

export function Skeleton({ rows = 4 }) {
  return (
    <div className="space-y-2 p-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="h-9 animate-pulse rounded-md bg-stone-100" style={{ opacity: 1 - i * 0.15 }} />)}
    </div>
  );
}

export const inputCls = 'w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-sm text-stone-800 placeholder:text-stone-400 transition-colors focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100';
