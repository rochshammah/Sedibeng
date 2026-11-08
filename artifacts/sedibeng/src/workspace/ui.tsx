import { type ReactNode } from 'react';
import { Link } from 'wouter';
import { Inbox, Package } from 'lucide-react';

export function firstName(name?: string | null) {
  return (name || '').trim().split(/\s+/)[0] || 'friend';
}

// Setswana "Dumela" (hello) keeps the tone warm and local.
export function greet(name?: string | null) {
  return `Dumela, ${firstName(name)}`;
}

export function timeAgo(iso: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

const avatarColours = ['#2f6b57', '#b4532a', '#3b5b8c', '#7a4f8e', '#9a6b17', '#2b7a78'];

export function Avatar({ name, size = 42 }: { name: string; size?: number }) {
  const initial = (name.trim()[0] || 's').toUpperCase();
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return (
    <span
      className="ws-avatar"
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.42, background: avatarColours[hash % avatarColours.length] }}
    >
      {initial}
    </span>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="ws-page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Card({ title, hint, action, children }: { title?: string; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="ws-card">
      {(title || action) && (
        <div className="ws-card-head">
          <div>
            {title && <h2>{title}</h2>}
            {hint && <p>{hint}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

const statusTone: Record<string, string> = {
  APPROVED: 'good', ACTIVE: 'good', OPEN: 'good', FULFILLED: 'good', RESOLVED: 'good', AVAILABLE: 'good', Open: 'good', Fulfilled: 'good',
  PENDING: 'warn', PENDING_TEACHER_REVIEW: 'warn', AWAITING_TEACHER_APPROVAL: 'warn', PENDING_MODERATION: 'warn', 'Pending moderation': 'warn',
  UNDER_REVIEW: 'warn', PREPARING: 'warn', READY_FOR_HANDOFF: 'warn', New: 'warn', PARTIALLY_MATCHED: 'warn', 'Partially matched': 'warn',
  REJECTED: 'bad', CANCELLED: 'bad', SUSPENDED: 'bad', WITHDRAWN: 'bad', Rejected: 'bad', Cancelled: 'bad', DISMISSED: 'muted', Read: 'muted',
};

export function StatusPill({ status }: { status: string }) {
  return <span className={`ws-pill ws-pill-${statusTone[status] ?? 'muted'}`}>{status.replaceAll('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</span>;
}

export type RowItem = { id: string; title: string; detail: string; status?: string; right?: ReactNode; icon?: ReactNode };

export function ListRows({ items, empty }: { items?: RowItem[]; empty: string }) {
  if (!items?.length) return <p className="ws-muted ws-empty-line">{empty}</p>;
  return (
    <div className="ws-rows">
      {items.map((row) => (
        <article className="ws-row" key={row.id}>
          <span className="ws-row-icon">{row.icon ?? <Package size={17} />}</span>
          <div className="ws-row-copy">
            <b>{row.title}</b>
            <span>{row.detail}</span>
          </div>
          {row.status && <StatusPill status={row.status} />}
          {row.right && <div className="ws-row-actions">{row.right}</div>}
        </article>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, text, action }: { icon?: ReactNode; title: string; text: string; action?: { href: string; label: string } }) {
  return (
    <div className="ws-empty">
      <span className="ws-empty-icon">{icon ?? <Inbox size={26} />}</span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action && <Link href={action.href} className="ws-btn ws-btn-primary">{action.label}</Link>}
    </div>
  );
}

export function StatCards({ counts }: { counts: { label: string; value: number; detail: string }[] }) {
  if (!counts.length) return null;
  return (
    <div className="ws-stats">
      {counts.map((count) => (
        <article className="ws-stat" key={count.label}>
          <strong>{count.value}</strong>
          <span>{count.label}</span>
          <small>{count.detail}</small>
        </article>
      ))}
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'good'; children: ReactNode }) {
  return <div className={`ws-notice ws-notice-${tone}`} role="status">{children}</div>;
}

export function Feedback({ error, success }: { error?: unknown; success?: string }) {
  if (!error && !success) return null;
  return error
    ? <p className="ws-feedback ws-feedback-bad" role="alert">{error instanceof Error ? error.message : String(error)}</p>
    : <p className="ws-feedback ws-feedback-good" role="status">{success}</p>;
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (value: NoInfer<T>) => void; options: { value: NoInfer<T>; label: string; count?: number }[] }) {
  return (
    <div className="ws-segmented" role="tablist">
      {options.map((option) => (
        <button key={option.value} role="tab" aria-selected={value === option.value} className={value === option.value ? 'is-active' : ''} onClick={() => onChange(option.value)}>
          {option.label}{typeof option.count === 'number' && <i>{option.count}</i>}
        </button>
      ))}
    </div>
  );
}

export function SkeletonPosts({ count = 2 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <div className="ws-card ws-skel" key={index} aria-hidden="true">
          <div className="ws-skel-line w40" /><div className="ws-skel-line w80" /><div className="ws-skel-block" /><div className="ws-skel-line w60" />
        </div>
      ))}
    </>
  );
}
