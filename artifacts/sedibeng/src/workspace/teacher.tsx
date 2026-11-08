import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { ArrowLeft, ClipboardList, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import {
  type AssistanceRequest, type RequestInput,
  getGetNotificationsQueryKey, getGetOrdersQueryKey, getGetRequestQueryKey, getGetRequestsQueryKey, getGetSponsorshipsQueryKey, getGetTeacherDashboardQueryKey,
  useCreateRequest, useDecideSponsorship, useDeleteRequest, useGetAuthSession, useGetOrders, useGetRequest, useGetRequests, useGetSponsorships,
  useGetTeacherDashboard, useGetTeacherProfile, useListSchools, useUpdateOrderStatus, useUpdateRequest,
} from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
import { ErrorState } from '../components/site';
import { VerificationCard } from './common';
import { useIsVerified } from './feed';
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
  const { verified, loading } = useIsVerified();
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

      {!loading && !verified && <Notice tone="warn"><ShieldCheck size={16} /> Your school verification isn’t complete yet. You can draft requests, but they’re only published once you’re verified. <Link href="/teacher/me">Finish verification</Link></Notice>}

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

type Bucket = 'all' | 'pending' | 'live' | 'closed';
const bucketOf = (status: string): Bucket => (status === 'Pending moderation' ? 'pending' : ['Open', 'Partially matched', 'Matched'].includes(status) ? 'live' : 'closed');

export function TeacherRequests() {
  const client = useQueryClient();
  const { toast } = useToast();
  const profile = useGetTeacherProfile();
  const requests = useGetRequests({});
  const remove = useDeleteRequest();
  const [bucket, setBucket] = useState<Bucket>('all');

  const mine = useMemo(() => (requests.data ?? []).filter((r) => profile.data?.schoolName && r.schoolContext.includes(profile.data.schoolName)), [requests.data, profile.data]);
  const shown = bucket === 'all' ? mine : mine.filter((r) => bucketOf(r.status) === bucket);
  const count = (b: Bucket) => mine.filter((r) => bucketOf(r.status) === b).length;

  return (
    <div className="ws-col ws-col-wide">
      <PageHeader title="Requests" subtitle="Everything your school has asked for." action={<Link href="/teacher/requests/new" className="ws-btn ws-btn-primary"><Plus size={16} />Post a need</Link>} />
      <Segmented value={bucket} onChange={setBucket} options={[{ value: 'all', label: 'All', count: mine.length }, { value: 'live', label: 'Live', count: count('live') }, { value: 'pending', label: 'In review', count: count('pending') }, { value: 'closed', label: 'Closed', count: count('closed') }]} />
      {requests.isError ? <ErrorState onRetry={() => void requests.refetch()} /> : !requests.isLoading && mine.length === 0 ? (
        <EmptyState icon={<ClipboardList size={26} />} title="No requests yet" text="Share what your school needs and donors will see it in their feed." action={{ href: '/teacher/requests/new', label: 'Post your first need' }} />
      ) : (
        <Card><ListRows empty={requests.isLoading ? 'Loading requests…' : 'Nothing in this tab.'}
          items={shown.map((r) => ({
            id: r.id, title: r.title, status: r.status, detail: `${r.quantity} ${r.unit} · ${r.location}`,
            right: ['Pending moderation', 'Rejected'].includes(r.status) ? <>
              <Link href={`/teacher/requests/${r.id}/edit`} className="ws-btn ws-btn-ghost ws-btn-sm"><Pencil size={14} />Edit</Link>
              {r.status === 'Pending moderation' && <button className="ws-btn ws-btn-danger ws-btn-sm" onClick={() => { if (confirm(`Cancel “${r.title}”?`)) remove.mutate({ id: r.id }, { onSuccess: () => { toast({ title: 'Request cancelled' }); void client.invalidateQueries({ queryKey: getGetRequestsQueryKey() }); void client.invalidateQueries({ queryKey: getGetTeacherDashboardQueryKey() }); } }); }}><Trash2 size={14} />Cancel</button>}
            </> : undefined,
          }))} /></Card>
      )}
    </div>
  );
}

const emptyRequest: RequestInput = { schoolId: '', title: '', category: '', item: '', description: '', specifications: '', quantity: 1, unit: 'items', priority: 'STANDARD', schoolContext: '' };
const categorySuggestions = ['School shoes', 'Books & stationery', 'Bags', 'Uniforms'];

export function TeacherRequestForm() {
  const { id } = useParams<{ id?: string }>();
  const editing = !!id;
  const client = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const profile = useGetTeacherProfile();
  const schools = useListSchools({});
  const existing = useGetRequest(id ?? '', { query: { enabled: editing, queryKey: getGetRequestQueryKey(id ?? '') } });
  const create = useCreateRequest();
  const update = useUpdateRequest();
  const [error, setError] = useState<unknown>(null);
  const form = useForm<RequestInput>({ defaultValues: emptyRequest });

  useEffect(() => {
    if (editing && existing.data) {
      const r: AssistanceRequest = existing.data;
      form.reset({ schoolId: profile.data?.schoolId || '', title: r.title, category: r.category, item: r.item, description: r.description, specifications: r.specifications, quantity: r.quantity, unit: r.unit, priority: r.priority.toUpperCase() as RequestInput['priority'], schoolContext: r.schoolContext });
    }
  }, [editing, existing.data, profile.data?.schoolId, form]);
  useEffect(() => { if (!editing && profile.data?.schoolId && !form.getValues('schoolId')) form.setValue('schoolId', profile.data.schoolId); }, [editing, profile.data?.schoolId, form]);

  const finish = () => {
    toast({ title: editing ? 'Request updated' : 'Request submitted 🎉', description: editing ? undefined : 'We’ll review it and publish it to donors shortly.' });
    void client.invalidateQueries({ queryKey: getGetRequestsQueryKey() });
    void client.invalidateQueries({ queryKey: getGetTeacherDashboardQueryKey() });
    navigate('/teacher/requests');
  };
  const submit = form.handleSubmit((values) => {
    setError(null);
    if (editing) update.mutate({ id: id!, data: values }, { onSuccess: finish, onError: setError });
    else create.mutate({ data: values }, { onSuccess: finish, onError: setError });
  });

  return (
    <div className="ws-col ws-col-wide">
      <Link href="/teacher/requests" className="ws-back"><ArrowLeft size={15} />Back to requests</Link>
      <PageHeader title={editing ? 'Edit request' : 'Post a need'} subtitle="Describe what your school needs. Please don’t include any learner’s name or personal details." />
      <Card>
        <form className="ws-form ws-grid-2" onSubmit={submit}>
          <label className="ws-field ws-span">School
            <select className="ws-input" {...form.register('schoolId')} data-testid="select-request-school">
              <option value="">Choose a school</option>
              {(schools.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name} · {s.district}</option>)}
            </select>
          </label>
          <label className="ws-field ws-span">Headline<input className="ws-input" placeholder="e.g. 30 exercise books for Grade 4" {...form.register('title')} data-testid="input-request-title" /></label>
          <label className="ws-field">Category<input className="ws-input" list="ws-categories" {...form.register('category')} data-testid="input-request-category" /><datalist id="ws-categories">{categorySuggestions.map((c) => <option key={c} value={c} />)}</datalist></label>
          <label className="ws-field">Item<input className="ws-input" {...form.register('item')} data-testid="input-request-item" /></label>
          <label className="ws-field">Quantity<input className="ws-input" type="number" min={1} {...form.register('quantity', { valueAsNumber: true })} data-testid="input-request-quantity" /></label>
          <label className="ws-field">Unit<input className="ws-input" {...form.register('unit')} data-testid="input-request-unit" /></label>
          <label className="ws-field">How urgent is it?
            <select className="ws-input" {...form.register('priority')}><option value="STANDARD">Standard</option><option value="HIGH">High</option><option value="ESSENTIAL">Urgent</option></select>
          </label>
          <label className="ws-field ws-span">Why it’s needed<textarea className="ws-input" rows={3} {...form.register('description')} data-testid="input-request-description" /></label>
          <label className="ws-field ws-span">Specifications <span className="ws-muted">(sizes, colours…)</span><textarea className="ws-input" rows={2} {...form.register('specifications')} data-testid="input-request-specifications" /></label>
          <label className="ws-field ws-span">About the school <span className="ws-muted">(optional context)</span><textarea className="ws-input" rows={2} {...form.register('schoolContext')} data-testid="input-request-schoolContext" /></label>
          <div className="ws-span"><Feedback error={error} /></div>
          <div className="ws-form-actions ws-span">
            <button className="ws-btn ws-btn-primary" disabled={create.isPending || update.isPending} data-testid="button-save-request">{editing ? 'Save changes' : 'Submit request'}</button>
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
      <VerificationCard kind="teacher" />
    </div>
  );
}
