import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { ShieldCheck } from 'lucide-react';
import {
  getGetMyVerificationQueryKey, getGetNotificationsQueryKey,
  useGetMyVerification, useGetNotifications, useMarkNotificationRead, useSubmitVerification,
} from '@workspace/api-client-react';
import { ErrorState } from '../components/site';
import { Card, Feedback, ListRows, Notice, PageHeader } from './ui';

export function VerificationCard({ kind }: { kind: 'donor' | 'teacher' }) {
  const client = useQueryClient();
  const verification = useGetMyVerification();
  const submit = useSubmitVerification();
  const form = useForm<{ note: string }>({ defaultValues: { note: '' } });
  const [feedback, setFeedback] = useState<{ ok?: string; error?: unknown }>({});
  const status = verification.data?.[0]?.status;
  const locked = submit.isPending || status === 'PENDING' || status === 'APPROVED';
  return (
    <Card title="Verification" hint={kind === 'donor' ? 'A quick check so schools can trust offers.' : 'A quick check of your school affiliation.'}>
      {status === 'APPROVED' ? <Notice tone="good"><ShieldCheck size={16} /> You’re verified. Thank you!</Notice> : status === 'PENDING' ? <Notice>We’re reviewing your details. We’ll notify you as soon as it’s done.</Notice> : (
        <form className="ws-form" onSubmit={form.handleSubmit((v) => { setFeedback({}); submit.mutate({ data: v }, { onSuccess: () => { setFeedback({ ok: 'Sent for review.' }); void client.invalidateQueries({ queryKey: getGetMyVerificationQueryKey() }); }, onError: (error) => setFeedback({ error }) }); })}>
          {status === 'REJECTED' && <Notice tone="warn">Your last submission wasn’t approved. Add more context and try again.</Notice>}
          <label className="ws-field">Tell us a little about {kind === 'donor' ? 'yourself or your organisation' : 'your role at the school'}
            <textarea className="ws-input" rows={3} maxLength={500} {...form.register('note', { required: true })} data-testid={`input-${kind}-verification-note`} />
          </label>
          <button className="ws-btn ws-btn-primary" disabled={locked} data-testid={`button-submit-${kind}-verification`}>Submit for verification</button>
        </form>
      )}
      <Feedback error={feedback.error} success={feedback.ok} />
    </Card>
  );
}

export function NotificationsPage() {
  const client = useQueryClient();
  const notifications = useGetNotifications();
  const mark = useMarkNotificationRead();
  return (
    <div className="ws-col ws-col-wide">
      <PageHeader title="Notifications" subtitle="Updates about your offers, requests and account." />
      <Card>
        {notifications.isError && <ErrorState onRetry={() => void notifications.refetch()} />}
        <ListRows empty={notifications.isLoading ? 'Loading…' : 'You’re all caught up 🌱'}
          items={(notifications.data ?? []).map((n) => ({
            id: n.id, title: n.title, detail: n.body, status: n.readAt ? 'Read' : 'New',
            right: !n.readAt ? <button className="ws-btn ws-btn-ghost ws-btn-sm" onClick={() => mark.mutate({ id: n.id }, { onSuccess: () => void client.invalidateQueries({ queryKey: getGetNotificationsQueryKey() }) })} data-testid={`button-read-notification-${n.id}`}>Mark read</button> : undefined,
          }))} />
      </Card>
    </div>
  );
}
