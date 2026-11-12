import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { ArrowLeft, ClipboardList, Pencil, Plus, Send, ShieldCheck, Trash2 } from 'lucide-react';
import {
  type OwnRequest, type RequestInput,
  getGetMyRequestsQueryKey, getGetNotificationsQueryKey, getGetOrdersQueryKey, getGetRequestsQueryKey, getGetSponsorshipsQueryKey, getGetTeacherDashboardQueryKey,
  useCreateRequest, useDecideSponsorship, useDeleteRequest, useGetAuthSession, useGetMyRequests, useGetOrders, useGetSponsorships,
  useGetTeacherDashboard, useGetTeacherProfile, useGetTeacherVerification, useSubmitRequest, useUpdateOrderStatus, useUpdateRequest,
} from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
import { ErrorState } from '../components/site';
import { TeacherVerificationPanel } from './teacher-verification';
import { Avatar, Card, EmptyState, Feedback, ListRows, Notice, PageHeader, Segmented, StatCards, greet } from './ui';

export function TeacherHome() {
  const client = useQueryClient();
  const user = useGetAuthSession().data?.user;
  const dash = useGetTeacherDashboard();
  const profile = useGetTeacherProfile();
  const offers = useGetSponsorships();
  const orders = useGetOrders();
  const decide = useDecideSponsorship();
  const updateOrder = useUpdateOrderStatus();
  const verification = useGetTeacherVerification();
  const refreshAll = () => {
    void client.invalidateQueries({ queryKey: getGetSponsorshipsQueryKey() });
    void client.invalidateQueries({ queryKey: getGetOrdersQueryKey() });
    void client.invalidateQueries({ queryKey: getGetTeacherDashboardQueryKey() });
  };

  const pending = (offers.data ?? []).filter((o) => o.status === 'PENDING_TEACHER_REVIEW');
  const toStart = (orders.data ?? []).filter((o) => o.status === 'AWAITING_TEACHER_APPROVAL');
  const toFinish = (orders.data ?? []).filter((o) => o.status === 'READY_FOR_HANDOFF');
  const nothing = !pending.length && !toStart.length && !toFinish.length;

  if (dash.isError) return <ErrorState onRetry={() => void dash.refetch()} />;

  return (
    <div className="ws-col ws-col-wide">
      <section className="ws-card ws-hello">
        <Avatar name={user?.name || 'Sedibeng'} size={48} />
        <div>
          <h1>{greet(user?.name)} 👋</h1>
          <p>{profile.data ? `${profile.data.schoolName} · ${profile.data.district}` : 'Here’s how your school’s requests are doing.'}</p>
        </div>
      </section>

      {verification.data && !verification.data.eligible && (
        <Notice tone="warn"><ShieldCheck size={16} /> You’ve completed {[verification.data.identity, verification.data.professional].filter((stage) => stage.status === 'VERIFIED').length} of 2 verification steps. You can save drafts now, and send requests for review once both are confirmed. <Link href="/teacher/me">Continue verification</Link></Notice>
      )}

      <StatCards counts={dash.data?.counts ?? []} />

      <Card title="Needs your attention" hint="The quickest things to do next.">
        {nothing ? <p className="ws-muted ws-empty-line">You’re all caught up ☕ Nothing is waiting on you right now.</p> : (
          <ListRows empty=""
            items={[
              ...pending.map((o) => ({
                id: `o-${o.id}`, title: `${o.donorName} offered ${o.quantity}`, detail: `For “${o.requestTitle}”`, status: o.status,
                right: <>
                  <button className="ws-btn ws-btn-primary ws-btn-sm" onClick={() => decide.mutate({ id: o.id, data: { decision: 'APPROVE' } }, { onSuccess: refreshAll })}>Approve</button>
                  <button className="ws-btn ws-btn-ghost ws-btn-sm" onClick={() => decide.mutate({ id: o.id, data: { decision: 'REJECT' } }, { onSuccess: refreshAll })}>Decline</button>
                </>,
              })),
              ...toStart.map((o) => ({
                id: `s-${o.id}`, title: o.requestTitle, detail: `${o.quantity} · ready to prepare`, status: o.status,
                right: <button className="ws-btn ws-btn-primary ws-btn-sm" onClick={() => updateOrder.mutate({ id: o.id, data: { status: 'PREPARING' } }, { onSuccess: refreshAll })}>Begin preparation</button>,
              })),
              ...toFinish.map((o) => ({
                id: `f-${o.id}`, title: o.requestTitle, detail: `${o.quantity} · donor says it’s ready`, status: o.status,
                right: <button className="ws-btn ws-btn-primary ws-btn-sm" onClick={() => updateOrder.mutate({ id: o.id, data: { status: 'FULFILLED' } }, { onSuccess: refreshAll })}>Mark received</button>,
              })),
            ]} />
        )}
      </Card>
    </div>
  );
}

type Bucket = 'all' | 'live' | 'review' | 'attention' | 'closed';
const bucketOf = (status: string): Bucket => {
  if (status === 'Pending moderation') return 'review';
  if (['Draft', 'Needs changes', 'Rejected'].includes(status)) return 'attention';
  if (['Open', 'Partially matched', 'Matched'].includes(status)) return 'live';
  return 'closed';
};
const canEdit = (status: string) => ['Draft', 'Pending moderation', 'Needs changes', 'Rejected'].includes(status);
const canSendForReview = (status: string) => ['Draft', 'Needs changes', 'Rejected'].includes(status);
const canCancel = (status: string) => ['Draft', 'Pending moderation', 'Needs changes'].includes(status);

export function TeacherRequests() {
  const client = useQueryClient();
  const { toast } = useToast();
  const requests = useGetMyRequests();
  const verification = useGetTeacherVerification();
  const remove = useDeleteRequest();
  const submit = useSubmitRequest();
  const [bucket, setBucket] = useState<Bucket>('all');

  const mine = requests.data ?? [];
  const shown = bucket === 'all' ? mine : mine.filter((r) => bucketOf(r.status) === bucket);
  const count = (b: Bucket) => mine.filter((r) => bucketOf(r.status) === b).length;
  const eligible = verification.data?.eligible ?? false;
  const refresh = () => {
    void client.invalidateQueries({ queryKey: getGetMyRequestsQueryKey() });
    void client.invalidateQueries({ queryKey: getGetRequestsQueryKey() });
    void client.invalidateQueries({ queryKey: getGetTeacherDashboardQueryKey() });
  };

  return (
    <div className="ws-col ws-col-wide">
      <PageHeader title="Requests" subtitle="Everything you’ve asked for." action={<Link href="/teacher/requests/new" className="ws-btn ws-btn-primary"><Plus size={16} />Post a need</Link>} />
      <Segmented value={bucket} onChange={setBucket} options={[
        { value: 'all', label: 'All', count: mine.length }, { value: 'live', label: 'Live', count: count('live') },
        { value: 'review', label: 'In review', count: count('review') }, { value: 'attention', label: 'Needs you', count: count('attention') },
        { value: 'closed', label: 'Closed', count: count('closed') },
      ]} />
      {requests.isError ? <ErrorState onRetry={() => void requests.refetch()} /> : !requests.isLoading && mine.length === 0 ? (
        <EmptyState icon={<ClipboardList size={26} />} title="No requests yet" text="Share what your school needs and donors will see it in their feed." action={{ href: '/teacher/requests/new', label: 'Post your first need' }} />
      ) : (
        <Card><ListRows empty={requests.isLoading ? 'Loading requests…' : 'Nothing in this tab.'}
          items={shown.map((r) => ({
            id: r.id, title: r.title, status: r.status,
            detail: `${r.quantity} ${r.unit}${r.size ? ` · ${r.size}` : ''} · ${r.location}${r.moderationFeedback && ['Needs changes', 'Rejected', 'Draft'].includes(r.status) ? ` — Reviewer: “${r.moderationFeedback}”` : ''}`,
            right: <>
              {canSendForReview(r.status) && <button className="ws-btn ws-btn-primary ws-btn-sm" disabled={!eligible || submit.isPending} title={eligible ? undefined : 'Finish both verification steps first'}
                onClick={() => submit.mutate({ id: r.id }, { onSuccess: () => { toast({ title: 'Sent for review', description: 'We’ll publish it once it’s approved.' }); refresh(); }, onError: (e) => toast({ title: 'Couldn’t send it yet', description: e instanceof Error ? e.message : undefined, variant: 'destructive' }) })} data-testid={`button-send-${r.id}`}><Send size={14} />Send for review</button>}
              {canEdit(r.status) && <Link href={`/teacher/requests/${r.id}/edit`} className="ws-btn ws-btn-ghost ws-btn-sm"><Pencil size={14} />Edit</Link>}
              {canCancel(r.status) && <button className="ws-btn ws-btn-danger ws-btn-sm" onClick={() => { if (confirm(`Cancel “${r.title}”?`)) remove.mutate({ id: r.id }, { onSuccess: () => { toast({ title: 'Request cancelled' }); refresh(); } }); }}><Trash2 size={14} />Cancel</button>}
            </>,
          }))} /></Card>
      )}
    </div>
  );
}

const categories = ['School shoes', 'School uniforms', 'School bags', 'Stationery', 'Exercise books', 'Textbooks', 'Learning materials', 'Other educational essentials'];
const emptyRequest: RequestInput = { schoolId: '', title: '', category: categories[0], item: '', description: '', specifications: '', size: '', conditionRequirement: null, requiredBy: '', teacherPrivateNotes: '', quantity: 1, unit: 'items', priority: 'STANDARD', schoolContext: '' };
const fromOwn = (r: OwnRequest, schoolId: string): RequestInput => ({
  schoolId, title: r.title, category: r.category, item: r.item, description: r.description, specifications: r.specifications, size: r.size ?? '',
  conditionRequirement: (r.conditionRequirement as RequestInput['conditionRequirement']) ?? null, requiredBy: r.requiredBy ?? '', teacherPrivateNotes: r.teacherPrivateNotes ?? '',
  quantity: r.quantity, unit: r.unit, priority: r.priority.toUpperCase() as RequestInput['priority'], schoolContext: r.schoolContext,
});

export function TeacherRequestForm() {
  const { id } = useParams<{ id?: string }>();
  const editing = !!id;
  const client = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const profile = useGetTeacherProfile();
  const verification = useGetTeacherVerification();
  const mine = useGetMyRequests();
  const create = useCreateRequest();
  const update = useUpdateRequest();
  const [error, setError] = useState<unknown>(null);
  const form = useForm<RequestInput>({ defaultValues: emptyRequest });
  const existing = editing ? mine.data?.find((r) => r.id === id) : undefined;
  const eligible = verification.data?.eligible ?? false;
  const schoolId = profile.data?.schoolId ?? '';

  useEffect(() => { if (existing && schoolId) form.reset(fromOwn(existing, schoolId)); }, [existing, schoolId, form]);

  const finish = (sent: boolean) => {
    toast({ title: sent ? 'Sent for review 🎉' : 'Draft saved', description: sent ? 'We’ll publish it to donors once it’s approved.' : 'You can send it for review any time.' });
    void client.invalidateQueries({ queryKey: getGetMyRequestsQueryKey() });
    void client.invalidateQueries({ queryKey: getGetRequestsQueryKey() });
    void client.invalidateQueries({ queryKey: getGetTeacherDashboardQueryKey() });
    navigate('/teacher/requests');
  };
  const save = (sendForReview: boolean) => form.handleSubmit((values) => {
    setError(null);
    const data: RequestInput = {
      ...values, schoolId, submit: sendForReview,
      size: values.size?.trim() || null, specifications: values.specifications?.trim() || null,
      requiredBy: values.requiredBy || null, teacherPrivateNotes: values.teacherPrivateNotes?.trim() || null,
      conditionRequirement: values.conditionRequirement || null,
      schoolContext: values.schoolContext?.trim() || `${profile.data?.schoolName ?? 'School'} · ${profile.data?.district ?? ''}`,
    };
    const options = { onSuccess: () => finish(sendForReview), onError: setError };
    if (editing) update.mutate({ id: id!, data }, options);
    else create.mutate({ data }, options);
  });
  const busy = create.isPending || update.isPending;
  const categoryOptions = existing && !categories.includes(existing.category) ? [existing.category, ...categories] : categories;

  return (
    <div className="ws-col ws-col-wide">
      <Link href="/teacher/requests" className="ws-back"><ArrowLeft size={15} />Back to requests</Link>
      <PageHeader title={editing ? 'Edit request' : 'Post a need'} subtitle="Tell donors what your school needs. Please don’t include any learner’s name, photo or home address." />
      {existing?.moderationFeedback && ['Needs changes', 'Rejected', 'Draft'].includes(existing.status) && (
        <div className="ws-feedback-box" role="note"><b>Message from the reviewer</b><p>{existing.moderationFeedback}</p></div>
      )}
      {verification.data && !eligible && (
        <Notice tone="warn"><ShieldCheck size={16} /> You can save this as a draft now. Once both verification steps are approved you’ll be able to send it for review. <Link href="/teacher/me">Continue verification</Link></Notice>
      )}
      <Card>
        <form className="ws-form ws-grid-2" onSubmit={(event) => { event.preventDefault(); void save(eligible)(); }}>
          {profile.data && <p className="ws-muted ws-span">For <b>{profile.data.schoolName}</b>, {profile.data.district}</p>}
          <label className="ws-field ws-span">Headline<input className="ws-input" placeholder="e.g. 30 exercise books for Grade 4" {...form.register('title')} data-testid="input-request-title" /></label>
          <label className="ws-field">Category
            <select className="ws-input" {...form.register('category')} data-testid="select-request-category">{categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          </label>
          <label className="ws-field">Item<input className="ws-input" placeholder="e.g. A4 exercise books" {...form.register('item')} data-testid="input-request-item" /></label>
          <label className="ws-field">How many?<input className="ws-input" type="number" min={1} {...form.register('quantity', { valueAsNumber: true })} data-testid="input-request-quantity" /></label>
          <label className="ws-field">Unit<input className="ws-input" placeholder="books, pairs, sets…" {...form.register('unit')} data-testid="input-request-unit" /></label>
          <label className="ws-field">Size <span className="ws-muted">(if it matters)</span><input className="ws-input" placeholder="e.g. Sizes 4–6, A4" {...form.register('size')} data-testid="input-request-size" /></label>
          <label className="ws-field">Condition
            <select className="ws-input" {...form.register('conditionRequirement', { setValueAs: (v) => v || null })} data-testid="select-request-condition"><option value="">No preference</option><option value="NEW">New only</option><option value="GENTLY_USED">Gently used is fine</option><option value="ANY">Any condition</option></select>
          </label>
          <label className="ws-field">How urgent is it?
            <select className="ws-input" {...form.register('priority')} data-testid="select-request-priority"><option value="STANDARD">Standard</option><option value="HIGH">High</option><option value="ESSENTIAL">Urgent</option></select>
          </label>
          <label className="ws-field">Needed by <span className="ws-muted">(optional)</span><input className="ws-input" type="date" min={new Date().toISOString().slice(0, 10)} {...form.register('requiredBy')} data-testid="input-request-requiredBy" /></label>
          <label className="ws-field ws-span">Why it’s needed<textarea className="ws-input" rows={3} {...form.register('description')} data-testid="input-request-description" /></label>
          <label className="ws-field ws-span">Specifications <span className="ws-muted">(colours, brand, anything donors should know)</span><textarea className="ws-input" rows={2} {...form.register('specifications')} data-testid="input-request-specifications" /></label>
          <label className="ws-field ws-span">Private note for reviewers <span className="ws-muted">(never shown to donors)</span><textarea className="ws-input" rows={2} maxLength={1000} {...form.register('teacherPrivateNotes')} data-testid="input-request-privateNotes" /></label>
          <div className="ws-span"><Feedback error={error} /></div>
          <div className="ws-form-actions ws-span">
            {eligible && <button type="submit" className="ws-btn ws-btn-primary" disabled={busy} data-testid="button-send-request"><Send size={15} />{busy ? 'Saving…' : 'Send for review'}</button>}
            <button type="button" className={`ws-btn ${eligible ? 'ws-btn-ghost' : 'ws-btn-primary'}`} disabled={busy} onClick={() => void save(false)()} data-testid="button-save-draft">Save draft</button>
            <Link href="/teacher/requests" className="ws-btn ws-btn-ghost">Cancel</Link>
          </div>
        </form>
      </Card>
    </div>
  );
}

export function TeacherOffers() {
  const client = useQueryClient();
  const offers = useGetSponsorships();
  const decide = useDecideSponsorship();
  const [tab, setTab] = useState<'review' | 'all'>('review');
  const all = offers.data ?? [];
  const review = all.filter((o) => o.status === 'PENDING_TEACHER_REVIEW');
  const shown = tab === 'review' ? review : all;
  const refresh = () => { void client.invalidateQueries({ queryKey: getGetSponsorshipsQueryKey() }); void client.invalidateQueries({ queryKey: getGetOrdersQueryKey() }); void client.invalidateQueries({ queryKey: getGetNotificationsQueryKey() }); };
  return (
    <div className="ws-col ws-col-wide">
      <PageHeader title="Offers" subtitle="Donors who want to help with your requests." />
      <Segmented value={tab} onChange={setTab} options={[{ value: 'review', label: 'Needs review', count: review.length }, { value: 'all', label: 'All offers', count: all.length }]} />
      <Card><ListRows empty={tab === 'review' ? 'No offers are waiting for your decision.' : 'No offers yet. They’ll appear when donors respond to your requests.'}
        items={shown.map((o) => ({
          id: o.id, title: `${o.donorName} offered ${o.quantity}`, detail: `For “${o.requestTitle}” · ${new Date(o.createdAt).toLocaleDateString()}`, status: o.status,
          right: o.status === 'PENDING_TEACHER_REVIEW' ? <>
            <button className="ws-btn ws-btn-primary ws-btn-sm" onClick={() => decide.mutate({ id: o.id, data: { decision: 'APPROVE' } }, { onSuccess: refresh })}>Approve</button>
            <button className="ws-btn ws-btn-ghost ws-btn-sm" onClick={() => decide.mutate({ id: o.id, data: { decision: 'REJECT' } }, { onSuccess: refresh })}>Decline</button>
          </> : undefined,
        }))} /></Card>
    </div>
  );
}

export function TeacherHandoffs() {
  const client = useQueryClient();
  const orders = useGetOrders();
  const updateOrder = useUpdateOrderStatus();
  const refresh = () => { void client.invalidateQueries({ queryKey: getGetOrdersQueryKey() }); void client.invalidateQueries({ queryKey: getGetTeacherDashboardQueryKey() }); };
  return (
    <div className="ws-col ws-col-wide">
      <PageHeader title="Handoffs" subtitle="Follow each approved offer until the goods reach your school." />
      <Card><ListRows empty="No handoffs yet. Approve an offer and it will appear here."
        items={(orders.data ?? []).map((o) => ({
          id: o.id, title: o.requestTitle, status: o.status, detail: `${o.quantity} · ${o.generalArea || 'Area not set'}`,
          right: o.status === 'AWAITING_TEACHER_APPROVAL' ? <button className="ws-btn ws-btn-primary ws-btn-sm" onClick={() => updateOrder.mutate({ id: o.id, data: { status: 'PREPARING' } }, { onSuccess: refresh })}>Begin preparation</button>
            : o.status === 'READY_FOR_HANDOFF' ? <button className="ws-btn ws-btn-primary ws-btn-sm" onClick={() => updateOrder.mutate({ id: o.id, data: { status: 'FULFILLED' } }, { onSuccess: refresh })}>Mark received</button> : undefined,
        }))} /></Card>
    </div>
  );
}

export function TeacherMe() {
  const user = useGetAuthSession().data?.user;
  const profile = useGetTeacherProfile();
  return (
    <div className="ws-col ws-col-wide">
      <PageHeader title="Me" />
      <Card>
        <div className="ws-profile">
          <Avatar name={user?.name || 'Sedibeng'} size={64} />
          <div>
            <h2>{user?.name}</h2><p className="ws-muted">{user?.email}</p>
            {profile.data && <p className="ws-muted">{profile.data.position ? `${profile.data.position} · ` : ''}{profile.data.schoolName}, {profile.data.district}{profile.data.area ? ` · ${profile.data.area}` : ''}</p>}
          </div>
        </div>
      </Card>
      <TeacherVerificationPanel />
    </div>
  );
}
