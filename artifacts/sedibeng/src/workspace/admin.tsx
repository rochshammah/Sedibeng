import { useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Flag, Inbox, ShieldCheck, Users } from 'lucide-react';
import {
  getGetAdminDashboardQueryKey, getGetRequestsQueryKey, getListAdminReportsQueryKey, getListAdminUsersQueryKey, getListVerificationQueueQueryKey,
  useAdminUpdateUserStatus, useDecideReport, useDecideVerification, useGetAdminDashboard, useGetAuthSession, useGetRequests,
  useListAdminReports, useListAdminUsers, useListVerificationQueue, useModerateRequest,
} from '@workspace/api-client-react';
import { ErrorState } from '../components/site';
import { Avatar, Card, ListRows, PageHeader, Segmented, StatCards, greet } from './ui';

function useRefreshAdmin() {
  const client = useQueryClient();
  return () => {
    for (const key of [getListAdminUsersQueryKey(), getListVerificationQueueQueryKey(), getListAdminReportsQueryKey(), getGetRequestsQueryKey(), getGetAdminDashboardQueryKey()]) void client.invalidateQueries({ queryKey: key });
  };
}

export function AdminHome() {
  const user = useGetAuthSession().data?.user;
  const dash = useGetAdminDashboard();
  const queue = useListVerificationQueue();
  const reports = useListAdminReports();
  const requests = useGetRequests({});
  const pendingVerifications = (queue.data ?? []).filter((v) => v.status === 'PENDING').length;
  const pendingRequests = (requests.data ?? []).filter((r) => r.status === 'Pending moderation').length;
  const openReports = (reports.data ?? []).filter((r) => r.status === 'OPEN' || r.status === 'UNDER_REVIEW').length;
  if (dash.isError) return <ErrorState onRetry={() => void dash.refetch()} />;
  const tiles = [
    { href: '/admin/verifications', icon: ShieldCheck, label: 'Verifications', value: pendingVerifications, hint: 'waiting for review' },
    { href: '/admin/moderation', icon: Inbox, label: 'Requests', value: pendingRequests, hint: 'waiting for approval' },
    { href: '/admin/reports', icon: Flag, label: 'Reports', value: openReports, hint: 'open concerns' },
  ];
  return (
    <div className="ws-col ws-col-wide">
      <section className="ws-card ws-hello"><Avatar name={user?.name || 'Admin'} size={48} /><div><h1>{greet(user?.name)} 👋</h1><p>Here’s what needs a look today.</p></div></section>
      <div className="ws-tiles">
        {tiles.map((tile) => (
          <Link key={tile.href} href={tile.href} className="ws-tile"><tile.icon size={22} /><strong>{tile.value}</strong><b>{tile.label}</b><small>{tile.hint}</small></Link>
        ))}
      </div>
      <StatCards counts={dash.data?.counts ?? []} />
    </div>
  );
}

export function AdminVerifications() {
  const queue = useListVerificationQueue();
  const decide = useDecideVerification();
  const refresh = useRefreshAdmin();
  const [tab, setTab] = useState<'PENDING' | 'ALL'>('PENDING');
  const all = queue.data ?? [];
  const shown = tab === 'PENDING' ? all.filter((v) => v.status === 'PENDING') : all;
  return (
    <div className="ws-col ws-col-wide">
      <PageHeader title="Verifications" subtitle="Check donors and teachers before they can give or post." />
      <Segmented value={tab} onChange={setTab} options={[{ value: 'PENDING', label: 'To review', count: all.filter((v) => v.status === 'PENDING').length }, { value: 'ALL', label: 'Everything', count: all.length }]} />
      <Card><ListRows empty="The verification queue is clear 🎉"
        items={shown.map((v) => ({
          id: v.id, title: v.userName, status: v.status,
          detail: `${v.type.toLowerCase()} · submitted ${v.submittedAt.slice(0, 10)} · ${v.applicantNote || 'No note provided'}`,
          right: v.status === 'PENDING' ? <>
            <button className="ws-btn ws-btn-primary ws-btn-sm" onClick={() => decide.mutate({ id: v.id, data: { decision: 'APPROVE' } }, { onSuccess: refresh })}>Approve</button>
            <button className="ws-btn ws-btn-danger ws-btn-sm" onClick={() => decide.mutate({ id: v.id, data: { decision: 'REJECT' } }, { onSuccess: refresh })}>Decline</button>
          </> : undefined,
        }))} /></Card>
    </div>
  );
}

export function AdminModeration() {
  const requests = useGetRequests({});
  const moderate = useModerateRequest();
  const refresh = useRefreshAdmin();
  const pending = (requests.data ?? []).filter((r) => r.status === 'Pending moderation');
  return (
    <div className="ws-col ws-col-wide">
      <PageHeader title="Request moderation" subtitle="Approve requests before donors see them. Look out for any learner details." />
      <Card><ListRows empty="No requests are waiting for review."
        items={pending.map((r) => ({
          id: r.id, title: r.title, status: r.status, detail: `${r.schoolContext} · ${r.quantity} ${r.unit} · ${r.category}`,
          right: <>
            <button className="ws-btn ws-btn-primary ws-btn-sm" onClick={() => moderate.mutate({ id: r.id, data: { decision: 'APPROVE' } }, { onSuccess: refresh })}>Approve</button>
            <button className="ws-btn ws-btn-danger ws-btn-sm" onClick={() => moderate.mutate({ id: r.id, data: { decision: 'REJECT' } }, { onSuccess: refresh })}>Reject</button>
          </>,
        }))} /></Card>
    </div>
  );
}

export function AdminUsers() {
  const users = useListAdminUsers();
  const setStatus = useAdminUpdateUserStatus();
  const refresh = useRefreshAdmin();
  return (
    <div className="ws-col ws-col-wide">
      <PageHeader title="People" subtitle="Everyone with an account." action={<span className="ws-muted"><Users size={14} /> {users.data?.length ?? 0}</span>} />
      <Card><ListRows empty="No users to show."
        items={(users.data ?? []).map((u) => ({
          id: u.id, title: u.name, status: u.status, detail: `${u.email} · ${u.role.toLowerCase()}`,
          icon: <Avatar name={u.name} size={36} />,
          right: <button className="ws-btn ws-btn-ghost ws-btn-sm" onClick={() => setStatus.mutate({ id: u.id, data: { status: u.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED' } }, { onSuccess: refresh })}>{u.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend'}</button>,
        }))} /></Card>
    </div>
  );
}

export function AdminReports() {
  const reports = useListAdminReports();
  const decide = useDecideReport();
  const refresh = useRefreshAdmin();
  return (
    <div className="ws-col ws-col-wide">
      <PageHeader title="Reports" subtitle="Concerns raised by the community." />
      <Card><ListRows empty="No reports waiting for review."
        items={(reports.data ?? []).map((r) => ({
          id: r.id, title: r.reason, status: r.status, detail: `${r.targetType.toLowerCase()} · ${r.details || 'No extra detail'}`,
          right: r.status === 'OPEN' || r.status === 'UNDER_REVIEW' ? <>
            <button className="ws-btn ws-btn-primary ws-btn-sm" onClick={() => decide.mutate({ id: r.id, data: { decision: 'RESOLVED' } }, { onSuccess: refresh })}>Resolve</button>
            <button className="ws-btn ws-btn-ghost ws-btn-sm" onClick={() => decide.mutate({ id: r.id, data: { decision: 'DISMISSED' } }, { onSuccess: refresh })}>Dismiss</button>
          </> : undefined,
        }))} /></Card>
    </div>
  );
}
