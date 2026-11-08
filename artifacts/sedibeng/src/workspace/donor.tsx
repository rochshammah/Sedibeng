import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Bookmark, HandHeart, Package, Pencil, Plus, Search, ShieldCheck, Trash2, X } from 'lucide-react';
import {
  type FeedPost, type InventoryInput, type InventoryItem,
  getGetDonorDashboardQueryKey, getGetInventoryQueryKey, getGetMyReportsQueryKey, getGetMyVerificationQueryKey, getGetNotificationsQueryKey, getGetOrdersQueryKey,
  useCreateInventory, useDeleteInventory, useGetAuthSession, useGetDonorDashboard, useGetInventory, useGetMyReports, useGetMyVerification,
  useGetNotifications, useGetOrders, useGetSavedRequests, useGetSponsorships, useMarkNotificationRead, useSubmitVerification, useUpdateInventory, useUpdateOrderStatus,
} from '@workspace/api-client-react';
import { ErrorState } from '../components/site';
import { RequestDetailPage } from '../pages/pages';
import { VerificationCard } from './common';
import { FeedPostCard, OfferDialog, useFeed, useIsVerified, useToggleSave, type FeedFilters } from './feed';
import { Avatar, Card, EmptyState, Feedback, ListRows, Notice, PageHeader, Segmented, SkeletonPosts, StatCards, greet } from './ui';

const chips: { label: string; filters: FeedFilters }[] = [
  { label: 'All', filters: {} },
  { label: 'Urgent', filters: { priority: 'Essential' } },
  { label: 'School shoes', filters: { category: 'School shoes' } },
  { label: 'Books & stationery', filters: { category: 'Books & stationery' } },
  { label: 'Bags', filters: { category: 'Bags' } },
  { label: 'Uniforms', filters: { category: 'Uniforms' } },
];

function useDebounced<T>(value: T, delay = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const id = setTimeout(() => setDebounced(value), delay); return () => clearTimeout(id); }, [value, delay]);
  return debounced;
}

export function DonorHome() {
  const user = useGetAuthSession().data?.user;
  const dash = useGetDonorDashboard();
  const { verified, loading: verifyLoading } = useIsVerified();
  const [chip, setChip] = useState(0);
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search.trim());
  const filters = useMemo<FeedFilters>(() => ({ ...chips[chip].filters, search: debounced || undefined }), [chip, debounced]);
  const feed = useFeed(filters);
  const toggleSave = useToggleSave();
  const [offering, setOffering] = useState<FeedPost | null>(null);
  const sentinel = useRef<HTMLDivElement | null>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = feed;

  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasNextPage) return;
    const observer = new IntersectionObserver((entries) => { if (entries[0]?.isIntersecting && !isFetchingNextPage) void fetchNextPage(); }, { rootMargin: '500px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const posts = feed.data?.pages.flatMap((page) => page.items) ?? [];
  const open = posts.filter((post) => post.status === 'Open' || post.status === 'Partially matched').length;

  return (
    <div className="ws-split">
      <div className="ws-col">
        <section className="ws-card ws-hello">
          <Avatar name={user?.name || 'Sedibeng'} size={48} />
          <div>
            <h1>{greet(user?.name)} 👋</h1>
            <p>{open > 0 ? `${open}${hasNextPage ? '+' : ''} school ${open === 1 && !hasNextPage ? 'need is' : 'needs are'} waiting for a helping hand.` : 'Here’s what schools need this week.'}</p>
          </div>
          <Link href="/donor/goods" className="ws-btn ws-btn-soft ws-btn-sm">List goods</Link>
        </section>

        {!verifyLoading && !verified && (
          <Notice tone="warn"><ShieldCheck size={16} /> Your account is waiting for verification, so you can browse and save but not offer yet. <Link href="/donor/me">See status</Link></Notice>
        )}

        <div className="ws-filters">
          <label className="ws-search"><Search size={16} /><input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items, schools or areas" aria-label="Search requests" data-testid="input-feed-search" />{search && <button onClick={() => setSearch('')} aria-label="Clear search"><X size={14} /></button>}</label>
          <div className="ws-chips" role="tablist" aria-label="Filter requests">
            {chips.map((item, index) => <button key={item.label} role="tab" aria-selected={chip === index} className={chip === index ? 'is-active' : ''} onClick={() => setChip(index)}>{item.label}</button>)}
          </div>
        </div>

        {feed.isLoading ? <SkeletonPosts count={2} />
          : feed.isError ? <ErrorState onRetry={() => void feed.refetch()} />
          : posts.length === 0 ? <EmptyState title="Nothing here yet" text={debounced || chip ? 'No requests match that. Try a different search or filter.' : 'New school requests will show up here as soon as teachers post them.'} action={chip || debounced ? undefined : { href: '/donor/goods', label: 'List goods you can give' }} />
          : <>
              {posts.map((post) => <FeedPostCard key={post.id} post={post} onOffer={setOffering} onToggleSave={toggleSave} />)}
              <div ref={sentinel} />
              {isFetchingNextPage && <SkeletonPosts count={1} />}
              {hasNextPage && !isFetchingNextPage && <button className="ws-btn ws-btn-soft ws-center" onClick={() => void fetchNextPage()}>Load more</button>}
              {!hasNextPage && <p className="ws-end">You’re all caught up 🌱</p>}
            </>}
      </div>

      <aside className="ws-rail">
        <Card title="Your giving"><StatCards counts={dash.data?.counts ?? []} />{!dash.data?.counts?.length && <p className="ws-muted">Your offers will show up here.</p>}</Card>
        <Card title="Quick links">
          <div className="ws-quick">
            <Link href="/donor/saved"><Bookmark size={16} />Saved requests</Link>
            <Link href="/donor/activity"><HandHeart size={16} />Offers & handoffs</Link>
            <Link href="/donor/goods"><Package size={16} />My goods</Link>
          </div>
        </Card>
        <p className="ws-fine">Goods only. No money changes hands, and learners are never named or contacted.</p>
      </aside>
      <OfferDialog post={offering} onClose={() => setOffering(null)} />
    </div>
  );
}

export function DonorSaved() {
  const saved = useGetSavedRequests();
  const toggleSave = useToggleSave();
  const [offering, setOffering] = useState<FeedPost | null>(null);
  const items = (saved.data ?? []).filter((post) => post.isSaved);
  return (
    <div className="ws-col ws-col-narrow">
      <PageHeader title="Saved" subtitle="Requests you’re keeping an eye on." />
      {saved.isLoading ? <SkeletonPosts count={2} />
        : saved.isError ? <ErrorState onRetry={() => void saved.refetch()} />
        : items.length === 0 ? <EmptyState icon={<Bookmark size={26} />} title="Nothing saved yet" text="Tap Save on any request to come back to it later." action={{ href: '/donor', label: 'Browse the feed' }} />
        : items.map((post) => <FeedPostCard key={post.id} post={post} onOffer={setOffering} onToggleSave={toggleSave} />)}
      <OfferDialog post={offering} onClose={() => setOffering(null)} />
    </div>
  );
}

export function DonorRequest() {
  return <div className="ws-col ws-col-wide ws-legacy"><RequestDetailPage backHref="/donor" backLabel="Back to feed" /></div>;
}

const goodsDefaults: InventoryInput = { title: '', category: '', item: '', description: '', specifications: '', quantityAvailable: 1, unit: 'items', district: '', area: '' };

export function DonorGoods() {
  const client = useQueryClient();
  const inventory = useGetInventory();
  const create = useCreateInventory();
  const update = useUpdateInventory();
  const remove = useDeleteInventory();
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [feedback, setFeedback] = useState<{ ok?: string; error?: unknown }>({});
  const form = useForm<InventoryInput>({ defaultValues: goodsDefaults });
  const refresh = () => { void client.invalidateQueries({ queryKey: getGetInventoryQueryKey() }); void client.invalidateQueries({ queryKey: getGetDonorDashboardQueryKey() }); };

  const close = () => { setShowForm(false); setEditing(null); form.reset(goodsDefaults); };
  const save = form.handleSubmit((values) => {
    setFeedback({});
    const done = () => { setFeedback({ ok: editing ? 'Listing updated.' : 'Goods added. Teachers can now see you have these.' }); close(); refresh(); };
    const fail = (error: unknown) => setFeedback({ error });
    if (editing) update.mutate({ id: editing.id, data: values }, { onSuccess: done, onError: fail });
    else create.mutate({ data: values }, { onSuccess: done, onError: fail });
  });
  const edit = (item: InventoryItem) => {
    setEditing(item); setShowForm(true);
    form.reset({ title: item.title, category: item.category, item: item.item, description: item.description, specifications: item.specifications || '', quantityAvailable: item.quantityAvailable, unit: item.unit, district: item.district, area: item.area || '' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const fields = ['title', 'category', 'item', 'quantityAvailable', 'unit', 'district', 'area'] as const;
  const labels: Record<string, string> = { title: 'Title', category: 'Category', item: 'Item', quantityAvailable: 'Quantity', unit: 'Unit', district: 'District', area: 'Area (optional)' };

  return (
    <div className="ws-col ws-col-wide">
      <PageHeader title="My goods" subtitle="What you have available to give." action={!showForm && <button className="ws-btn ws-btn-primary" onClick={() => setShowForm(true)} data-testid="button-add-goods"><Plus size={16} />Add goods</button>} />
      <Feedback error={feedback.error} success={feedback.ok} />
      {showForm && (
        <Card title={editing ? 'Edit listing' : 'Add goods'} action={<button className="ws-icon-btn" onClick={close} aria-label="Close form"><X size={18} /></button>}>
          <form className="ws-form ws-grid-2" onSubmit={save}>
            {fields.map((key) => (
              <label className="ws-field" key={key}>{labels[key]}
                <input className="ws-input" type={key === 'quantityAvailable' ? 'number' : 'text'} {...form.register(key, key === 'quantityAvailable' ? { valueAsNumber: true } : undefined)} data-testid={`input-inventory-${key}`} />
              </label>
            ))}
            <label className="ws-field ws-span">Description<textarea className="ws-input" rows={3} {...form.register('description')} data-testid="input-inventory-description" /></label>
            <label className="ws-field ws-span">Specifications <span className="ws-muted">(sizes, condition…)</span><textarea className="ws-input" rows={2} {...form.register('specifications')} data-testid="input-inventory-specifications" /></label>
            <div className="ws-form-actions ws-span">
              <button className="ws-btn ws-btn-primary" disabled={create.isPending || update.isPending} data-testid="button-save-inventory">{editing ? 'Save changes' : 'Add goods'}</button>
              <button type="button" className="ws-btn ws-btn-ghost" onClick={close}>Cancel</button>
            </div>
          </form>
        </Card>
      )}
      <Card title={`Your listings${inventory.data ? ` (${inventory.data.length})` : ''}`}>
        <ListRows empty={inventory.isLoading ? 'Loading your goods…' : 'No goods listed yet. Tap “Add goods” when you’re ready.'}
          items={(inventory.data ?? []).map((x) => ({
            id: x.id, title: x.title, status: x.status,
            detail: `${x.quantityAvailable} ${x.unit} · ${x.district}${x.area ? `, ${x.area}` : ''}`,
            right: <>
              <button className="ws-btn ws-btn-ghost ws-btn-sm" onClick={() => edit(x)} aria-label={`Edit ${x.title}`}><Pencil size={14} />Edit</button>
              {x.status !== 'WITHDRAWN' && <button className="ws-btn ws-btn-danger ws-btn-sm" onClick={() => { if (confirm(`Withdraw “${x.title}”?`)) remove.mutate({ id: x.id }, { onSuccess: refresh }); }}><Trash2 size={14} />Withdraw</button>}
            </>,
          }))} />
      </Card>
    </div>
  );
}

export function DonorActivity() {
  const client = useQueryClient();
  const offers = useGetSponsorships();
  const orders = useGetOrders();
  const orderStatus = useUpdateOrderStatus();
  const [tab, setTab] = useState<'offers' | 'handoffs'>('offers');
  return (
    <div className="ws-col ws-col-wide">
      <PageHeader title="Activity" subtitle="Your offers and where each handoff stands." />
      <Segmented value={tab} onChange={setTab} options={[{ value: 'offers', label: 'My offers', count: offers.data?.length }, { value: 'handoffs', label: 'Handoffs', count: orders.data?.length }]} />
      {tab === 'offers' ? (
        <Card><ListRows empty="When you offer help on a request, it shows up here." items={(offers.data ?? []).map((s) => ({ id: s.id, title: s.requestTitle, status: s.status, detail: `${s.quantity} offered · ${new Date(s.createdAt).toLocaleDateString()}` }))} /></Card>
      ) : (
        <Card><ListRows empty="No handoffs yet. Once a teacher approves an offer, the next steps appear here."
          items={(orders.data ?? []).map((o) => ({
            id: o.id, title: o.requestTitle, status: o.status,
            detail: `${o.quantity} · ${o.generalArea || 'Area to be confirmed'}${o.scheduledAt ? ` · ${new Date(o.scheduledAt).toLocaleDateString()}` : ''}`,
            right: o.status === 'PREPARING' ? <button className="ws-btn ws-btn-primary ws-btn-sm" onClick={() => orderStatus.mutate({ id: o.id, data: { status: 'READY_FOR_HANDOFF' } }, { onSuccess: () => void client.invalidateQueries({ queryKey: getGetOrdersQueryKey() }) })}>Ready for handoff</button> : undefined,
          }))} /></Card>
      )}
    </div>
  );
}

export function DonorMe() {
  const user = useGetAuthSession().data?.user;
  const reports = useGetMyReports({ query: { queryKey: getGetMyReportsQueryKey() } });
  return (
    <div className="ws-col ws-col-wide">
      <PageHeader title="Me" />
      <Card>
        <div className="ws-profile">
          <Avatar name={user?.name || 'Sedibeng'} size={64} />
          <div><h2>{user?.name}</h2><p className="ws-muted">{user?.email}</p><p className="ws-muted">{user?.emailVerifiedAt ? '✓ Email verified' : 'Email not verified yet'}</p></div>
        </div>
      </Card>
      <VerificationCard kind="donor" />
      <Card title="Reports you’ve sent"><ListRows empty="You haven’t reported anything." items={(reports.data ?? []).map((r) => ({ id: r.id, title: r.reason, status: r.status, detail: `${r.targetType.toLowerCase()} · ${r.createdAt.slice(0, 10)}` }))} /></Card>
    </div>
  );
}
