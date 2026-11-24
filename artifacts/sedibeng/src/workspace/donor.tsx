import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Bookmark, HandHeart, ImagePlus, MapPin, Package, Pencil, Plus, Search, ShieldCheck, Trash2, X } from 'lucide-react';
import {
  type FeedPost, type InventoryItem,
  customFetch, getGetDonorDashboardQueryKey, getGetInventoryQueryKey, getGetMyReportsQueryKey, getGetOrdersQueryKey,
  useCreateInventoryBulk, useDeleteInventory, useDeleteInventoryPhoto, useGetAuthSession, useGetDonorDashboard, useGetInventory, useGetMyReports,
  useGetOrders, useGetSavedRequests, useGetSponsorships, useUpdateInventory,
} from '@workspace/api-client-react';
import { ErrorState } from '../components/site';
import { RequestDetailPage } from '../pages/pages';
import { VerificationCard } from './common';
import { FulfilmentOrderCard } from './fulfilment';
import { OfferDetail } from './record-details';
import { FeedPostCard, OfferDialog, useFeed, useIsVerified, useToggleSave, type FeedFilters } from './feed';
import { AreaPicker, GoodsPhoto, LocationSelect, goodsCategories, goodsConditionLabels, useServiceAreaFilter } from './places';
import { Avatar, Card, EmptyState, Feedback, ListRows, Notice, PageHeader, Segmented, SkeletonPosts, StatCards, StatusPill, greet } from './ui';

const chips: { label: string; filters: FeedFilters }[] = [
  { label: 'All', filters: {} },
  { label: 'Urgent', filters: { priority: 'Essential' } },
  { label: 'School shoes', filters: { categoryGroup: 'SHOES' } },
  { label: 'Books & stationery', filters: { categoryGroup: 'BOOKS_STATIONERY' } },
  { label: 'Bags', filters: { categoryGroup: 'BAGS' } },
  { label: 'Uniforms', filters: { categoryGroup: 'UNIFORMS' } },
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
  const area = useServiceAreaFilter();
  const filters = useMemo<FeedFilters>(() => ({ ...chips[chip].filters, search: debounced || undefined, serviceAreaId: area.serviceAreaId }), [chip, debounced, area.serviceAreaId]);
  const feed = useFeed(filters, area.ready);
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
            <h1>{greet(user?.name)}</h1>
            <p>{open > 0 ? `${open}${hasNextPage ? '+' : ''} school ${open === 1 && !hasNextPage ? 'need is' : 'needs are'} waiting for a helping hand.` : 'Here’s what schools need this week.'}</p>
          </div>
          <Link href="/donor/goods" className="ws-btn ws-btn-soft ws-btn-sm">List goods</Link>
        </section>

        {!verifyLoading && !verified && (
          <Notice tone="warn"><ShieldCheck size={16} /> Your account is waiting for verification, so you can browse and save but not offer yet. <Link href="/donor/me">See status</Link></Notice>
        )}

        <div className="ws-filters">
          <AreaPicker filter={area} label="Requests in" />
          <label className="ws-search"><Search size={16} /><input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items, schools or areas" aria-label="Search requests" data-testid="input-feed-search" />{search && <button onClick={() => setSearch('')} aria-label="Clear search"><X size={14} /></button>}</label>
          <div className="ws-chips" role="tablist" aria-label="Filter requests">
            {chips.map((item, index) => <button key={item.label} role="tab" aria-selected={chip === index} className={chip === index ? 'is-active' : ''} onClick={() => setChip(index)}>{item.label}</button>)}
          </div>
        </div>

        {feed.isLoading ? <SkeletonPosts count={2} />
          : feed.isError ? <ErrorState onRetry={() => void feed.refetch()} />
          : posts.length === 0 ? (
            <div className="ws-empty">
              <span className="ws-empty-icon"><MapPin size={26} /></span>
              <h3>{area.serviceAreaId ? 'No requests in this area yet' : 'Nothing here yet'}</h3>
              <p>{debounced || chip ? 'No requests match that. Try a different search or filter.' : area.serviceAreaId ? 'There are no published requests in this service area right now. You can look further afield.' : 'New school requests will show up here as soon as teachers post them.'}</p>
              {area.serviceAreaId ? <button className="ws-btn ws-btn-primary" onClick={() => area.select('all')} data-testid="button-all-areas">See requests in all areas</button> : !(chip || debounced) && <Link href="/donor/goods" className="ws-btn ws-btn-primary">List goods you can give</Link>}
            </div>
          )
          : <>
              {posts.map((post) => <FeedPostCard key={post.id} post={post} onOffer={setOffering} onToggleSave={toggleSave} />)}
              <div ref={sentinel} />
              {isFetchingNextPage && <SkeletonPosts count={1} />}
              {hasNextPage && !isFetchingNextPage && <button className="ws-btn ws-btn-soft ws-center" onClick={() => void fetchNextPage()}>Load more</button>}
              {!hasNextPage && <p className="ws-end">You’re all caught up.</p>}
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

type GoodsRow = { title: string; category: string; description: string; quantityAvailable: number; unit: string; condition: 'NEW' | 'GOOD' | 'FAIR'; photo: File | null };
const blankRow = (): GoodsRow => ({ title: '', category: goodsCategories[0], description: '', quantityAvailable: 1, unit: 'items', condition: 'GOOD', photo: null });
const PHOTO_TYPES = ['image/jpeg', 'image/png'];
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

function photoProblem(file: File | null) {
  if (!file) return null;
  if (!PHOTO_TYPES.includes(file.type)) return 'Please choose a JPEG or PNG photo.';
  if (file.size > MAX_PHOTO_BYTES) return 'That photo is too large. The limit is 5 MB.';
  return null;
}

function uploadGoodsPhoto(id: string, file: File) {
  return customFetch<InventoryItem>(`/api/v1/inventory/${id}/photo`, { method: 'POST', body: file, headers: { 'content-type': file.type }, responseType: 'json' });
}

const goodsStatus: Record<string, [string, string]> = { AVAILABLE: ['Available', 'good'], RESERVED: ['Fully offered', 'warn'], DRAFT: ['Waiting for verification', 'muted'], WITHDRAWN: ['Withdrawn', 'muted'] };
function GoodsStatusPill({ status }: { status: string }) {
  const [label, tone] = goodsStatus[status] ?? [status, 'muted'];
  return <span className={`ws-pill ws-pill-${tone}`}>{label}</span>;
}

export function DonorGoods() {
  const client = useQueryClient();
  const inventory = useGetInventory();
  const create = useCreateInventoryBulk();
  const update = useUpdateInventory();
  const remove = useDeleteInventory();
  const removePhoto = useDeleteInventoryPhoto();
  const { verified, loading: verifyLoading } = useIsVerified();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [locationId, setLocationId] = useState('');
  const [rows, setRows] = useState<GoodsRow[]>([blankRow()]);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok?: string; error?: unknown }>({});
  const refresh = () => { void client.invalidateQueries({ queryKey: getGetInventoryQueryKey() }); void client.invalidateQueries({ queryKey: getGetDonorDashboardQueryKey() }); };

  const close = () => { setShowForm(false); setEditing(null); setRows([blankRow()]); setLocationId(''); };
  const setRow = (index: number, change: Partial<GoodsRow>) => setRows((current) => current.map((row, i) => (i === index ? { ...row, ...change } : row)));

  const openEdit = (item: InventoryItem) => {
    setEditing(item); setShowForm(true); setFeedback({});
    setLocationId(item.locationId ?? '');
    setRows([{ title: item.title, category: item.category, description: item.description, quantityAvailable: Math.max(1, item.quantityAvailable), unit: item.unit, condition: (item.condition as GoodsRow['condition']) ?? 'GOOD', photo: null }]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const problem = (): string | null => {
    if (!locationId) return 'Choose where the goods are available.';
    for (const [index, row] of rows.entries()) {
      const label = rows.length > 1 ? `Item ${index + 1}: ` : '';
      if (row.title.trim().length < 2) return `${label}give the item a name.`;
      if (row.description.trim().length < 4) return `${label}add a short description (sizes can go here).`;
      if (!(row.quantityAvailable >= 1)) return `${label}enter how many you have.`;
      const photo = photoProblem(row.photo);
      if (photo) return `${label}${photo}`;
    }
    return null;
  };

  const save = async () => {
    setFeedback({});
    const issue = problem();
    if (issue) return setFeedback({ error: new Error(issue) });
    setBusy(true);
    const payload = rows.map((row) => ({ title: row.title.trim(), category: row.category, description: row.description.trim(), quantityAvailable: Number(row.quantityAvailable), unit: row.unit.trim() || 'items', condition: row.condition, locationId }));
    try {
      const saved = editing ? [await update.mutateAsync({ id: editing.id, data: payload[0] })] : await create.mutateAsync({ data: { items: payload } });
      const failed: string[] = [];
      for (const [index, item] of saved.entries()) {
        const photo = rows[index]?.photo;
        if (photo) { try { await uploadGoodsPhoto(item.id, photo); } catch { failed.push(item.title); } }
      }
      setFeedback({
        ok: failed.length ? `Saved. The photo for ${failed.join(', ')} couldn’t be uploaded. You can add it from the listing.` : editing ? 'Listing updated.' : saved.length > 1 ? `${saved.length} items added.` : 'Goods added.',
      });
      close(); refresh();
    } catch (error) { setFeedback({ error }); }
    finally { setBusy(false); }
  };

  const quickPhoto = async (item: InventoryItem, file: File | undefined) => {
    if (!file) return;
    const issue = photoProblem(file);
    if (issue) return setFeedback({ error: new Error(issue) });
    setFeedback({});
    try { await uploadGoodsPhoto(item.id, file); setFeedback({ ok: 'Photo sent. It will appear to teachers once it’s approved.' }); refresh(); }
    catch (error) { setFeedback({ error }); }
  };

  const items = inventory.data ?? [];
  return (
    <div className="ws-col ws-col-wide">
      <PageHeader title="My goods" subtitle="What you have available to give." action={!showForm && <button className="ws-btn ws-btn-primary" onClick={() => { setFeedback({}); setShowForm(true); }} data-testid="button-add-goods"><Plus size={16} />Add goods</button>} />
      {!verifyLoading && !verified && <Notice tone="warn"><ShieldCheck size={16} /> Your goods are saved, but teachers only see them once your account is verified. <Link href="/donor/me">See status</Link></Notice>}
      <Feedback error={feedback.error} success={feedback.ok} />

      {showForm && (
        <Card title={editing ? 'Edit listing' : 'Add goods'} hint="Share what you have and where it is. Mention sizes in the description; teachers read the details themselves." action={<button className="ws-icon-btn" onClick={close} aria-label="Close form"><X size={18} /></button>}>
          <div className="ws-form">
            <label className="ws-field">Where are the goods available? <span className="ws-muted">(required)</span>
              <LocationSelect value={locationId} onChange={setLocationId} testId="select-goods-location" />
            </label>
            {rows.map((row, index) => (
              <div className="ws-itemrow" key={index} data-testid={`goods-row-${index}`}>
                {rows.length > 1 && <div className="ws-itemrow-head"><b>Item {index + 1}</b><button type="button" className="ws-btn ws-btn-ghost ws-btn-sm" onClick={() => setRows((current) => current.filter((_, i) => i !== index))}><Trash2 size={14} />Remove</button></div>}
                <div className="ws-grid-2">
                  <label className="ws-field">Item name<input className="ws-input" value={row.title} onChange={(e) => setRow(index, { title: e.target.value })} placeholder="e.g. Black school shoes" data-testid={`input-goods-title-${index}`} /></label>
                  <label className="ws-field">Category
                    <select className="ws-input" value={row.category} onChange={(e) => setRow(index, { category: e.target.value })} data-testid={`select-goods-category-${index}`}>{goodsCategories.map((c) => <option key={c} value={c}>{c}</option>)}</select>
                  </label>
                  <label className="ws-field">How many<input className="ws-input" type="number" min={1} value={row.quantityAvailable} onChange={(e) => setRow(index, { quantityAvailable: Number(e.target.value) })} data-testid={`input-goods-quantity-${index}`} /></label>
                  <label className="ws-field">Unit<input className="ws-input" value={row.unit} onChange={(e) => setRow(index, { unit: e.target.value })} placeholder="pairs, books, sets…" /></label>
                  <label className="ws-field">Condition
                    <select className="ws-input" value={row.condition} onChange={(e) => setRow(index, { condition: e.target.value as GoodsRow['condition'] })} data-testid={`select-goods-condition-${index}`}>{Object.entries(goodsConditionLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                  </label>
                  <label className="ws-field">Photo <span className="ws-muted">(optional)</span>
                    <input className="ws-input" type="file" accept="image/jpeg,image/png" onChange={(e) => setRow(index, { photo: e.target.files?.[0] ?? null })} data-testid={`input-goods-photo-${index}`} />
                  </label>
                  <label className="ws-field ws-span">Description <span className="ws-muted">(condition details, sizes…)</span>
                    <textarea className="ws-input" rows={2} value={row.description} onChange={(e) => setRow(index, { description: e.target.value })} placeholder="e.g. Sizes 3 to 5, lightly worn" data-testid={`input-goods-description-${index}`} />
                  </label>
                </div>
              </div>
            ))}
            {!editing && rows.length < 10 && <button type="button" className="ws-btn ws-btn-soft" onClick={() => setRows((current) => [...current, blankRow()])} data-testid="button-add-another"><Plus size={15} />Add another item</button>}
            <p className="ws-fine">Photos should show the goods only, never people. They’re checked before teachers can see them.</p>
            <div className="ws-form-actions">
              <button className="ws-btn ws-btn-primary" disabled={busy} onClick={() => void save()} data-testid="button-save-goods">{busy ? 'Saving…' : editing ? 'Save changes' : rows.length > 1 ? `Add ${rows.length} items` : 'Add goods'}</button>
              <button type="button" className="ws-btn ws-btn-ghost" onClick={close}>Cancel</button>
            </div>
          </div>
        </Card>
      )}

      <Card title={`Your listings${inventory.data ? ` (${items.filter((i) => i.status !== 'WITHDRAWN').length})` : ''}`}>
        {items.length === 0 ? <p className="ws-muted ws-empty-line">{inventory.isLoading ? 'Loading your goods…' : 'No goods listed yet. Tap “Add goods” when you’re ready.'}</p> : items.map((item) => (
          <article className="ws-goods" key={item.id} data-testid={`goods-${item.id}`}>
            <div className="ws-goods-thumb">{item.photoVersion && item.photoStatus !== 'REJECTED' ? <GoodsPhoto id={item.id} version={item.photoVersion} alt={item.title} /> : <Package size={24} />}</div>
            <div className="ws-goods-copy">
              <b>{item.title} <GoodsStatusPill status={item.status} /></b>
              <div className="ws-goods-meta">
                <span>{item.status === 'RESERVED' ? `0 left` : `${item.quantityAvailable} ${item.unit}`}</span>
                {item.condition && <span>{goodsConditionLabels[item.condition] ?? item.condition}</span>}
                <span><MapPin size={12} /> {item.locationName ?? item.district}{item.serviceAreaName && item.serviceAreaName !== item.locationName ? ` · ${item.serviceAreaName}` : ''}</span>
                <span>{item.category}</span>
              </div>
              <p>{item.description}</p>
              {item.offerCount > 0 && <small className="ws-muted">{item.offerCount} offer{item.offerCount === 1 ? '' : 's'} so far{item.pendingOfferCount ? ` · ${item.pendingOfferCount} waiting for the teacher` : ''}. <Link href="/donor/activity">See activity</Link></small>}
              {item.photoStatus === 'PENDING' && <small className="ws-note-inline">Photo waiting for approval. Only you can see it until then.</small>}
              {item.photoStatus === 'REJECTED' && <small className="ws-note-inline">Your photo wasn’t approved. Try a clearer photo of just the goods.</small>}
              {item.status !== 'WITHDRAWN' && (
                <div className="ws-goods-actions">
                  <button className="ws-btn ws-btn-ghost ws-btn-sm" onClick={() => openEdit(item)} aria-label={`Edit ${item.title}`}><Pencil size={14} />Edit</button>
                  <label className="ws-btn ws-btn-ghost ws-btn-sm" style={{ cursor: 'pointer' }}><ImagePlus size={14} />{item.photoStatus === 'NONE' || item.photoStatus === 'REJECTED' ? 'Add photo' : 'Replace photo'}
                    <input type="file" accept="image/jpeg,image/png" hidden onChange={(e) => { void quickPhoto(item, e.target.files?.[0]); e.target.value = ''; }} data-testid={`input-quick-photo-${item.id}`} />
                  </label>
                  {item.photoStatus !== 'NONE' && <button className="ws-btn ws-btn-ghost ws-btn-sm" onClick={() => removePhoto.mutate({ id: item.id }, { onSuccess: refresh })}>Remove photo</button>}
                  <button className="ws-btn ws-btn-danger ws-btn-sm" onClick={() => { if (confirm(`Withdraw “${item.title}”? Offers already made will carry on.`)) remove.mutate({ id: item.id }, { onSuccess: refresh }); }}><Trash2 size={14} />Withdraw</button>
                </div>
              )}
            </div>
          </article>
        ))}
      </Card>
    </div>
  );
}

export function DonorActivity() {
  const offers = useGetSponsorships();
  const orders = useGetOrders();
  const [tab, setTab] = useState<'offers' | 'handoffs'>('offers');
  return (
    <div className="ws-col ws-col-wide">
      <PageHeader title="Activity" subtitle="Your offers and where each handoff stands." />
      <Segmented value={tab} onChange={setTab} options={[{ value: 'offers', label: 'My offers', count: offers.data?.length }, { value: 'handoffs', label: 'Handoffs', count: orders.data?.length }]} />
      {tab === 'offers' ? (
        offers.isError ? <ErrorState onRetry={() => void offers.refetch()} />
          : <Card><ListRows empty={offers.isLoading ? 'Loading your offers…' : 'When you offer help on a request, it shows up here.'} items={(offers.data ?? []).map((s) => ({ id: s.id, title: s.requestTitle, status: s.status, detail: `${s.quantity} offered${s.inventoryTitle ? ` from “${s.inventoryTitle}”` : ' · you plan to source the goods'} · ${new Date(s.createdAt).toLocaleDateString()}`, right: <Link href={`/donor/activity/${s.id}`} className="ws-btn ws-btn-ghost ws-btn-sm" data-testid={`link-offer-details-${s.id}`}>View details</Link> }))} /></Card>
      ) : (
        <Card>
          {orders.isLoading ? <p className="ws-muted ws-empty-line">Loading handoffs…</p>
            : orders.isError ? <ErrorState onRetry={() => void orders.refetch()} />
            : orders.data?.length ? <div className="ws-handoff-list">{orders.data.map((order) => <FulfilmentOrderCard key={order.id} order={order} role="donor" />)}</div>
            : <p className="ws-muted ws-empty-line">No handoffs yet. Once a teacher approves an offer, the next steps appear here.</p>}
        </Card>
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

export function DonorOfferDetail() { return <OfferDetail role="donor" />; }
