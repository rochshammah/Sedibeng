import { useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, ExternalLink, Flag, Inbox, Plus, ShieldCheck, Users } from 'lucide-react';
import {
  type AdminSchool, type AssistanceRequest, type SchoolInput,
  getGetAdminDashboardQueryKey, getGetAdminVerificationDetailQueryKey, getGetRequestsQueryKey, getListAdminReportsQueryKey, getListAdminSchoolsQueryKey, getListAdminUsersQueryKey, getListVerificationQueueQueryKey,
  useAccessVerificationDocument, useAdminUpdateUserStatus, useCreateAdminSchool, useDecideReport, useDecideVerification, useGetAdminDashboard, useGetAdminVerificationDetail, useGetAuthSession, useGetRequests,
  useListAdminReports, useListAdminSchools, useListAdminUsers, useListVerificationQueue, useModerateRequest, useUpdateAdminSchool,
} from '@workspace/api-client-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { ErrorState } from '../components/site';
import { documentLabels } from './teacher-verification';
import { Avatar, Card, Feedback, ListRows, Notice, PageHeader, Segmented, StatCards, StatusPill, greet } from './ui';

function useRefreshAdmin() {
  const client = useQueryClient();
  return () => {
    for (const key of [getListAdminUsersQueryKey(), getListVerificationQueueQueryKey(), getListAdminReportsQueryKey(), getGetRequestsQueryKey(), getGetAdminDashboardQueryKey(), getListAdminSchoolsQueryKey()]) void client.invalidateQueries({ queryKey: key });
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

const stageLabel: Record<string, string> = { IDENTITY: 'Identity check', PROFESSIONAL: 'Professional check' };
const auditLabel: Record<string, string> = {
  VERIFICATION_SUBMITTED: 'Submitted', VERIFICATION_APPROVED: 'Approved', VERIFICATION_REJECTED: 'Rejected',
  VERIFICATION_INFO_REQUESTED: 'More information requested', VERIFICATION_EXPIRED: 'Marked expired', VERIFICATION_DOCUMENT_ACCESSED: 'Document opened',
};

function VerificationReview({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { toast } = useToast();
  const refresh = useRefreshAdmin();
  const client = useQueryClient();
  const detail = useGetAdminVerificationDetail(id ?? '', { query: { enabled: !!id, queryKey: getGetAdminVerificationDetailQueryKey(id ?? '') } });
  const decide = useDecideVerification();
  const access = useAccessVerificationDocument();
  const [feedback, setFeedback] = useState('');
  const [note, setNote] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [error, setError] = useState<unknown>(null);
  const data = detail.data;
  const record = data?.record;
  const isTeacher = record?.type === 'TEACHER';
  const schoolUnconfirmed = isTeacher && record?.stage === 'PROFESSIONAL' && data?.school && data.school.status !== 'ACTIVE';

  const reset = () => { setFeedback(''); setNote(''); setExpiresAt(''); setError(null); };
  const close = () => { reset(); onClose(); };

  const open = (docId: string) => {
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    access.mutate({ id: docId }, {
      onSuccess: (result) => { if (tab) tab.location.href = result.url; void client.invalidateQueries({ queryKey: getGetAdminVerificationDetailQueryKey(id ?? '') }); },
      onError: (e) => { tab?.close(); setError(e); },
    });
  };

  const submit = (decision: 'APPROVE' | 'REJECT' | 'REQUEST_INFO' | 'EXPIRE') => {
    setError(null);
    if ((decision === 'REJECT' || decision === 'REQUEST_INFO') && feedback.trim().length < 5) {
      setError(new Error('Please explain your decision so the applicant knows what to do next.'));
      return;
    }
    decide.mutate({ id: id!, data: { decision, feedback: feedback.trim() || null, note: note.trim() || null, expiresAt: decision === 'APPROVE' && expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : null } }, {
      onSuccess: () => { toast({ title: { APPROVE: 'Approved', REJECT: 'Rejected', REQUEST_INFO: 'More information requested', EXPIRE: 'Marked as expired' }[decision] }); refresh(); close(); },
      onError: setError,
    });
  };

  return (
    <Dialog open={!!id} onOpenChange={(openState) => { if (!openState) close(); }}>
      <DialogContent className="ws-dialog ws-dialog-wide">
        <DialogHeader>
          <DialogTitle>{record ? `${record.userName} · ${record.stage ? stageLabel[record.stage] : 'Donor verification'}` : 'Verification'}</DialogTitle>
          <DialogDescription>Review the evidence, then decide. Applicants see your message, never your private note.</DialogDescription>
        </DialogHeader>
        {detail.isLoading || !data || !record ? <p className="ws-muted">Loading…</p> : (
          <div className="ws-form">
            <dl className="ws-kv">
              <dt>Applicant</dt><dd>{data.applicant.name} · {data.applicant.email}</dd>
              <dt>Status</dt><dd><StatusPill status={record.status} /></dd>
              {data.school && <><dt>School</dt><dd>{data.school.name}, {data.school.district} <StatusPill status={data.school.status} /></dd></>}
              <dt>Their note</dt><dd>{record.applicantNote || 'None'}</dd>
              {record.feedback && <><dt>Last message</dt><dd>{record.feedback}</dd></>}
              {data.privateNotes && <><dt>Private note</dt><dd>{data.privateNotes}</dd></>}
            </dl>
            {schoolUnconfirmed && <Notice tone="warn">This school isn’t confirmed in the directory yet. Confirm it under People → Schools first, then approve.</Notice>}

            {isTeacher && (
              <div>
                <b>Evidence</b>
                {data.documents.length === 0 ? <p className="ws-muted">No documents on file.</p> : (
                  <ul className="ws-docs">
                    {data.documents.map((doc) => (
                      <li key={doc.id}><span><b>{documentLabels[doc.documentType] ?? doc.documentType}</b><small>{doc.originalFilename} · {Math.max(1, Math.round(doc.sizeBytes / 1024))} KB{doc.recordId && doc.recordId !== record.id ? ' · earlier submission' : ''}</small></span>
                        <button className="ws-btn ws-btn-ghost ws-btn-sm" onClick={() => open(doc.id)} disabled={access.isPending} data-testid={`button-open-doc-${doc.id}`}><ExternalLink size={14} />Open</button></li>
                    ))}
                  </ul>
                )}
                <p className="ws-fine">Links open for about a minute and every view is recorded.</p>
              </div>
            )}

            <div>
              <b>History</b>
              <ul className="ws-timeline">
                {data.history.map((item) => (
                  <li key={item.id}><StatusPill status={item.status} /><span>{item.stage ? stageLabel[item.stage] : record.type === 'DONOR' ? 'Donor verification' : 'Earlier check (before two-step verification)'}</span><small>{new Date(item.submittedAt).toLocaleDateString()}{item.reviewerName ? ` · reviewed by ${item.reviewerName}` : ''}{item.feedback ? ` · “${item.feedback}”` : ''}</small></li>
                ))}
              </ul>
              {data.audit.length > 0 && <details><summary className="ws-muted">Activity log ({data.audit.length})</summary>
                <ul className="ws-timeline">{data.audit.map((entry, index) => <li key={index}><span>{auditLabel[entry.action] ?? entry.action}</span><small>{entry.actorName ?? 'System'} · {new Date(entry.createdAt).toLocaleString()}</small></li>)}</ul></details>}
            </div>

            {(record.status === 'PENDING' || record.status === 'VERIFIED') && (
              <>
                <label className="ws-field">Message to the applicant <span className="ws-muted">(required to reject or ask for more)</span>
                  <textarea className="ws-input" rows={3} maxLength={1000} value={feedback} onChange={(e) => setFeedback(e.target.value)} data-testid="input-decision-feedback" /></label>
                <label className="ws-field">Private note <span className="ws-muted">(only administrators see this)</span>
                  <textarea className="ws-input" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
                {record.status === 'PENDING' && isTeacher && <label className="ws-field">Valid until <span className="ws-muted">(optional, e.g. licence expiry)</span><input className="ws-input" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} /></label>}
                <Feedback error={error} />
                <div className="ws-decisions">
                  {record.status === 'PENDING' ? (<>
                    <button className="ws-btn ws-btn-primary" disabled={decide.isPending} onClick={() => submit('APPROVE')} data-testid="button-decision-approve">Approve</button>
                    {isTeacher && <button className="ws-btn ws-btn-ghost" disabled={decide.isPending} onClick={() => submit('REQUEST_INFO')} data-testid="button-decision-info">Ask for more information</button>}
                    <button className="ws-btn ws-btn-danger" disabled={decide.isPending} onClick={() => submit('REJECT')} data-testid="button-decision-reject">Reject</button>
                  </>) : <button className="ws-btn ws-btn-danger" disabled={decide.isPending} onClick={() => submit('EXPIRE')} data-testid="button-decision-expire">Mark as expired</button>}
                </div>
              </>
            )}
            {record.status !== 'PENDING' && record.status !== 'VERIFIED' && <Feedback error={error} />}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function AdminVerifications() {
  const [tab, setTab] = useState<'PENDING' | 'ALL'>('PENDING');
  const queue = useListVerificationQueue({ scope: tab === 'PENDING' ? 'pending' : 'all' });
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = queue.data ?? [];
  return (
    <div className="ws-col ws-col-wide">
      <PageHeader title="Verifications" subtitle="Review identity and professional evidence before teachers can publish." />
      <Segmented value={tab} onChange={setTab} options={[{ value: 'PENDING', label: 'To review' }, { value: 'ALL', label: 'Everything' }]} />
      {queue.isError ? <ErrorState onRetry={() => void queue.refetch()} /> : (
        <Card><ListRows empty={queue.isLoading ? 'Loading…' : tab === 'PENDING' ? 'The verification queue is clear 🎉' : 'Nothing here yet.'}
          items={rows.map((v) => ({
            id: v.id, title: `${v.userName} · ${v.stage ? stageLabel[v.stage] : 'Donor verification'}`, status: v.status,
            detail: `${v.schoolName ? `${v.schoolName} · ` : ''}${v.stage ? `${v.documentCount} file${v.documentCount === 1 ? '' : 's'} · ` : ''}submitted ${v.submittedAt.slice(0, 10)}${v.applicantNote ? ` · “${v.applicantNote}”` : ''}`,
            right: <button className="ws-btn ws-btn-primary ws-btn-sm" onClick={() => setOpenId(v.id)} data-testid={`button-review-${v.id}`}>{v.status === 'PENDING' ? 'Review' : 'Open'}</button>,
          }))} /></Card>
      )}
      <VerificationReview id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

const conditionText: Record<string, string> = { NEW: 'New only', GENTLY_USED: 'Gently used is fine', ANY: 'Any condition' };

export function AdminModeration() {
  const { toast } = useToast();
  const requests = useGetRequests({});
  const moderate = useModerateRequest();
  const refresh = useRefreshAdmin();
  const [dialog, setDialog] = useState<{ request: AssistanceRequest; decision: 'REJECT' | 'REQUEST_CHANGES' } | null>(null);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState<unknown>(null);
  const pending = (requests.data ?? []).filter((r) => r.status === 'Pending moderation');

  const run = (id: string, decision: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES', message?: string) => {
    setError(null);
    moderate.mutate({ id, data: { decision, feedback: message?.trim() || null } }, {
      onSuccess: () => { toast({ title: decision === 'APPROVE' ? 'Published to donors' : decision === 'REJECT' ? 'Request rejected' : 'Changes requested' }); setDialog(null); setFeedback(''); refresh(); },
      onError: setError,
    });
  };

  return (
    <div className="ws-col ws-col-wide">
      <PageHeader title="Request moderation" subtitle="Approve requests before donors see them. Look out for learner names, photos or home addresses." />
      <Card><ListRows empty="No requests are waiting for review."
        items={pending.map((r) => ({
          id: r.id, title: r.title, status: r.status,
          detail: `${r.schoolContext} · ${r.quantity} ${r.unit} · ${r.category}${r.size ? ` · ${r.size}` : ''}${r.conditionRequirement ? ` · ${conditionText[r.conditionRequirement] ?? r.conditionRequirement}` : ''}${r.requiredBy ? ` · needed by ${r.requiredBy}` : ''}`,
          right: <>
            <button className="ws-btn ws-btn-primary ws-btn-sm" disabled={moderate.isPending} onClick={() => run(r.id, 'APPROVE')} data-testid={`button-approve-${r.id}`}>Approve</button>
            <button className="ws-btn ws-btn-ghost ws-btn-sm" onClick={() => { setError(null); setDialog({ request: r, decision: 'REQUEST_CHANGES' }); }} data-testid={`button-changes-${r.id}`}>Request changes</button>
            <button className="ws-btn ws-btn-danger ws-btn-sm" onClick={() => { setError(null); setDialog({ request: r, decision: 'REJECT' }); }}>Reject</button>
          </>,
        }))} /></Card>
      <Dialog open={!!dialog} onOpenChange={(openState) => { if (!openState) { setDialog(null); setFeedback(''); setError(null); } }}>
        <DialogContent className="ws-dialog">
          <DialogHeader>
            <DialogTitle>{dialog?.decision === 'REJECT' ? 'Reject request' : 'Request changes'}</DialogTitle>
            <DialogDescription>{dialog?.request.title}. The teacher will see your message.</DialogDescription>
          </DialogHeader>
          <div className="ws-form">
            <label className="ws-field">What should they change?<textarea className="ws-input" rows={4} maxLength={1000} value={feedback} onChange={(e) => setFeedback(e.target.value)} data-testid="input-moderation-feedback" /></label>
            <Feedback error={error} />
            <button className={`ws-btn ${dialog?.decision === 'REJECT' ? 'ws-btn-danger' : 'ws-btn-primary'}`} disabled={moderate.isPending || feedback.trim().length < 5} onClick={() => dialog && run(dialog.request.id, dialog.decision, feedback)} data-testid="button-confirm-moderation">{dialog?.decision === 'REJECT' ? 'Reject request' : 'Send to teacher'}</button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const schoolTypes: Record<string, string> = { PRIMARY: 'Primary', JUNIOR_SECONDARY: 'Junior secondary', SENIOR_SECONDARY: 'Senior secondary', SPECIAL_NEEDS: 'Special needs', OTHER: 'Other' };
const schoolStatusText: Record<string, string> = { ACTIVE: 'Active', SUSPENDED: 'Inactive', PENDING_REVIEW: 'Waiting to be confirmed' };
const blankSchool: SchoolInput = { name: '', schoolType: null, district: 'Gaborone', area: '', generalLocation: '', status: 'ACTIVE' };

function SchoolDirectory() {
  const { toast } = useToast();
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | 'PENDING_REVIEW' | 'ACTIVE' | 'SUSPENDED'>('');
  const schools = useListAdminSchools({ ...(search.trim() ? { search: search.trim() } : {}), ...(status ? { status } : {}) });
  const create = useCreateAdminSchool();
  const update = useUpdateAdminSchool();
  const [editing, setEditing] = useState<AdminSchool | 'new' | null>(null);
  const [form, setForm] = useState<SchoolInput>(blankSchool);
  const [error, setError] = useState<unknown>(null);
  const done = () => { void client.invalidateQueries({ queryKey: getListAdminSchoolsQueryKey() }); setEditing(null); setError(null); toast({ title: 'School saved' }); };

  const openEdit = (school: AdminSchool | 'new') => {
    setError(null); setEditing(school);
    setForm(school === 'new' ? blankSchool : { name: school.name, schoolType: (school.schoolType as SchoolInput['schoolType']) ?? null, district: school.district, area: school.area ?? '', generalLocation: school.generalLocation ?? '', status: school.status });
  };
  const save = () => {
    setError(null);
    if (editing === 'new') create.mutate({ data: form }, { onSuccess: done, onError: setError });
    else if (editing) update.mutate({ id: editing.id, data: form }, { onSuccess: done, onError: setError });
  };
  const quick = (school: AdminSchool, next: SchoolInput['status']) => update.mutate({ id: school.id, data: { name: school.name, schoolType: (school.schoolType as SchoolInput['schoolType']) ?? null, district: school.district, area: school.area, generalLocation: school.generalLocation, status: next } }, { onSuccess: done });

  return (
    <>
      <div className="ws-filters-row">
        <input className="ws-input" type="search" placeholder="Search schools" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search schools" data-testid="input-school-search" />
        <select className="ws-input" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Filter by status">
          <option value="">All</option><option value="ACTIVE">Active</option><option value="PENDING_REVIEW">Waiting to be confirmed</option><option value="SUSPENDED">Inactive</option>
        </select>
        <button className="ws-btn ws-btn-primary" onClick={() => openEdit('new')} data-testid="button-add-school"><Plus size={16} />Add school</button>
      </div>
      <Card><ListRows empty={schools.isLoading ? 'Loading…' : 'No schools match.'}
        items={(schools.data ?? []).map((school) => ({
          id: school.id, title: school.name, status: school.status === 'SUSPENDED' ? 'Inactive' : school.status === 'PENDING_REVIEW' ? 'Pending' : 'Active',
          icon: <Building2 size={17} />,
          detail: `${school.schoolType ? `${schoolTypes[school.schoolType] ?? school.schoolType} · ` : ''}${[school.area, school.district].filter(Boolean).join(', ')} · ${school.teacherCount} teacher${school.teacherCount === 1 ? '' : 's'}`,
          right: <>
            {school.status === 'PENDING_REVIEW' && <button className="ws-btn ws-btn-primary ws-btn-sm" onClick={() => quick(school, 'ACTIVE')} data-testid={`button-confirm-school-${school.id}`}>Confirm</button>}
            <button className="ws-btn ws-btn-ghost ws-btn-sm" onClick={() => openEdit(school)}>Edit</button>
          </>,
        }))} /></Card>
      <Dialog open={!!editing} onOpenChange={(openState) => { if (!openState) setEditing(null); }}>
        <DialogContent className="ws-dialog">
          <DialogHeader><DialogTitle>{editing === 'new' ? 'Add a school' : 'Edit school'}</DialogTitle><DialogDescription>General location only. Never exact addresses.</DialogDescription></DialogHeader>
          <div className="ws-form">
            <label className="ws-field">School name<input className="ws-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-school-name" /></label>
            <label className="ws-field">Type<select className="ws-input" value={form.schoolType ?? ''} onChange={(e) => setForm({ ...form, schoolType: (e.target.value || null) as SchoolInput['schoolType'] })}><option value="">Not set</option>{Object.entries(schoolTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <div className="ws-grid-2">
              <label className="ws-field">District<input className="ws-input" value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} data-testid="input-school-district" /></label>
              <label className="ws-field">Area<input className="ws-input" value={form.area ?? ''} onChange={(e) => setForm({ ...form, area: e.target.value })} data-testid="input-school-area" /></label>
            </div>
            <label className="ws-field">General location <span className="ws-muted">(optional)</span><input className="ws-input" value={form.generalLocation ?? ''} onChange={(e) => setForm({ ...form, generalLocation: e.target.value })} /></label>
            <label className="ws-field">Status<select className="ws-input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as SchoolInput['status'] })}>{Object.entries(schoolStatusText).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <Feedback error={error} />
            <button className="ws-btn ws-btn-primary" disabled={create.isPending || update.isPending || form.name.trim().length < 2 || form.district.trim().length < 2} onClick={save} data-testid="button-save-school">Save school</button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AdminUsers() {
  const users = useListAdminUsers();
  const setStatus = useAdminUpdateUserStatus();
  const refresh = useRefreshAdmin();
  const [tab, setTab] = useState<'people' | 'schools'>('people');
  return (
    <div className="ws-col ws-col-wide">
      <PageHeader title="People & schools" subtitle={tab === 'people' ? 'Everyone with an account.' : 'The directory teachers choose their school from.'} action={tab === 'people' ? <span className="ws-muted"><Users size={14} /> {users.data?.length ?? 0}</span> : undefined} />
      <Segmented value={tab} onChange={setTab} options={[{ value: 'people', label: 'People' }, { value: 'schools', label: 'Schools' }]} />
      {tab === 'schools' ? <SchoolDirectory /> : (
        <Card><ListRows empty="No users to show."
          items={(users.data ?? []).map((u) => ({
            id: u.id, title: u.name, status: u.status, detail: `${u.email} · ${u.role.toLowerCase()}`,
            icon: <Avatar name={u.name} size={36} />,
            right: <button className="ws-btn ws-btn-ghost ws-btn-sm" onClick={() => setStatus.mutate({ id: u.id, data: { status: u.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED' } }, { onSuccess: refresh })}>{u.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend'}</button>,
          }))} /></Card>
      )}
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
