import { Cog, Clock, Mail, MessageSquare, Smartphone, GitBranch } from 'lucide-react';

export const STEP_META = {
  task: { icon: Cog, label: 'Task', tone: 'text-stone-600 bg-stone-100' },
  wait: { icon: Clock, label: 'Wait', tone: 'text-amber-700 bg-amber-50' },
  message: { icon: Mail, label: 'Message', tone: 'text-accent-700 bg-accent-50' },
  branch: { icon: GitBranch, label: 'Branch', tone: 'text-sky-700 bg-sky-50' },
};

export const CHANNEL_ICON = { email: Mail, sms: Smartphone, slack: MessageSquare };

export function StepIcon({ step, size = 14 }) {
  const meta = STEP_META[step.type] ?? STEP_META.task;
  const Icon = step.type === 'message' ? CHANNEL_ICON[step.channel] ?? Mail : meta.icon;
  return (
    <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${meta.tone}`}>
      <Icon size={size} />
    </span>
  );
}
