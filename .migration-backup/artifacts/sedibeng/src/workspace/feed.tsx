import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { type InfiniteData, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { BadgeCheck, Bookmark, CalendarClock, CheckCircle2, Gift, MapPin, Share2, Sparkles } from 'lucide-react';
import {
  type FeedPage, type FeedPost, type GetFeedParams,
  getFeed, getGetDonorDashboardQueryKey, getGetInventoryQueryKey, getGetMyVerificationQueryKey, getGetSavedRequestsQueryKey, getGetSponsorshipsQueryKey,
  useCreateSponsorship, useGetInventory, useGetMyVerification, useSaveRequest, useUnsaveRequest,
} from '@workspace/api-client-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { PhotoImage } from '../components/site';
import { goodsConditionLabels, groupLabels } from './places';
import { Avatar, Feedback, timeAgo } from './ui';

export type FeedFilters = Pick<GetFeedParams, 'search' | 'category' | 'priority' | 'serviceAreaId' | 'categoryGroup'>;

const FEED_KEY = 'feed';

export function useFeed(filters: FeedFilters, enabled = true) {
  return useInfiniteQuery({
    enabled,
    queryKey: [FEED_KEY, filters],
    queryFn: ({ pageParam }) => getFeed({ ...filters, cursor: pageParam, limit: 10 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: FeedPage) => last.nextCursor ?? undefined,
  });
}

export function useIsVerified() {
  const verification = useGetMyVerification({ query: { queryKey: getGetMyVerificationQueryKey() } });
  return { loading: verification.isLoading, verified: verification.data?.some((record) => record.status === 'VERIFIED') ?? false, record: verification.data?.[0] };
}

function patchPost(client: ReturnType<typeof useQueryClient>, id: string, changes: Partial<FeedPost>) {
  client.setQueriesData<InfiniteData<FeedPage>>({ queryKey: [FEED_KEY] }, (data) =>
    data && { ...data, pages: data.pages.map((page) => ({ ...page, items: page.items.map((item) => (item.id === id ? { ...item, ...changes } : item)) })) });
  client.setQueryData<FeedPost[]>(getGetSavedRequestsQueryKey(), (data) => data?.map((item) => (item.id === id ? { ...item, ...changes } : item)));
}

// Saves/unsaves instantly in the UI and rolls back if the server refuses.
export function useToggleSave() {
  const client = useQueryClient();
  const { toast } = useToast();
  const save = useSaveRequest();
  const unsave = useUnsaveRequest();
  return (post: FeedPost) => {
    const next = !post.isSaved;
    patchPost(client, post.id, { isSaved: next });
    (next ? save : unsave).mutate({ id: post.id }, {
      onSuccess: () => void client.invalidateQueries({ queryKey: getGetSavedRequestsQueryKey() }),
      onError: () => { patchPost(client, post.id, { isSaved: !next }); toast({ title: 'Couldn’t update your saved list', description: 'Please try again.', variant: 'destructive' }); },
    });
  };
}

const conditionLabels: Record<string, string> = { NEW: 'New only', GENTLY_USED: 'Gently used is fine', ANY: 'Any condition' };

function neededBy(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function shareLink(post: FeedPost) {
  return new URL(`requests/${post.id}`, window.location.origin + import.meta.env.BASE_URL).href;
}

export function FeedPostCard({ post, onOffer, onToggleSave }: { post: FeedPost; onOffer: (post: FeedPost) => void; onToggleSave: (post: FeedPost) => void }) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const fulfilled = post.status === 'Fulfilled';
  const closed = fulfilled || post.status === 'Matched';
  const percent = Math.min(100, Math.round((post.quantityCovered / post.quantity) * 100));
  const long = post.description.length > 170;
  const detail = `/donor/request/${post.id}`;

  const share = async () => {
    const url = shareLink(post);
    try {
      if (navigator.share) await navigator.share({ title: post.title, text: `${post.schoolName} needs help: ${post.title}`, url });
      else { await navigator.clipboard.writeText(url); toast({ title: 'Link copied', description: 'Share it with someone who might be able to help.' }); }
    } catch { /* the person closed the share sheet */ }
  };

  return (
    <article className={`ws-card ws-post ${fulfilled ? 'is-fulfilled' : ''}`} data-testid={`post-${post.id}`}>
      <header className="ws-post-head">
        <Avatar name={post.schoolName} />
        <div className="ws-post-who">
          <b>{post.schoolName}{post.teacherVerified && <span className="ws-verified" title="This teacher’s identity and school have been verified"><BadgeCheck size={14} />Verified teacher</span>}</b>
          <span><MapPin size={12} />{post.location || 'Botswana'} · {timeAgo(post.postedAt)}</span>
        </div>
        {fulfilled
          ? <span className="ws-pill ws-pill-good"><Sparkles size={12} />Fulfilled</span>
          : post.priority !== 'Standard' && <span className={`ws-pill ${post.priority === 'Essential' ? 'ws-pill-bad' : 'ws-pill-warn'}`}>{post.priority === 'Essential' ? 'Urgent' : 'High priority'}</span>}
      </header>

      <div className="ws-post-body">
        {post.localMatch && <span className="ws-pill ws-pill-local" title="You have goods listed in this service area">A local request</span>}
        <h3><Link href={detail}>{post.title}</Link></h3>
        <p className={expanded ? '' : 'is-clamped'}>{post.description}</p>
        {long && <button className="ws-link-btn" onClick={() => setExpanded((v) => !v)}>{expanded ? 'Show less' : 'See more'}</button>}
      </div>

      {(post.size || post.conditionRequirement || post.requiredBy) && (
        <div className="ws-facts ws-post-facts">
          {post.size && <span>Size: <b>{post.size}</b></span>}
          {post.conditionRequirement && <span>{conditionLabels[post.conditionRequirement] ?? post.conditionRequirement}</span>}
          {post.requiredBy && <span><CalendarClock size={14} />Needed by <b>{neededBy(post.requiredBy)}</b></span>}
        </div>
      )}

      <Link href={detail} className="ws-post-photo" aria-label={`Open ${post.title}`}>
        <PhotoImage src={post.imageUrl} alt={post.imageAlt} loading="lazy" />
        <span className="ws-photo-chip">{post.category}</span>
      </Link>

      <div className="ws-progress-wrap">
        <div className="ws-progress-text">
          <b>{fulfilled ? `All ${post.quantity} ${post.unit} covered 🎉` : `${post.quantityCovered} of ${post.quantity} ${post.unit} covered`}</b>
          {!fulfilled && post.myOfferQuantity > 0 && <span className="ws-mine"><CheckCircle2 size={13} />You offered {post.myOfferQuantity}</span>}
        </div>
        <div className="ws-progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Share of the need already covered"><i style={{ width: `${percent}%` }} /></div>
        {!fulfilled && post.quantityPending > 0 && <small>{post.quantityPending} more offered and waiting for the teacher’s okay</small>}
      </div>

      <footer className="ws-post-actions">
        <button className={`ws-action ${post.isSaved ? 'is-on' : ''}`} onClick={() => onToggleSave(post)} aria-pressed={post.isSaved} data-testid={`button-save-${post.id}`}>
          <Bookmark size={18} fill={post.isSaved ? 'currentColor' : 'none'} />{post.isSaved ? 'Saved' : 'Save'}
        </button>
        <button className="ws-action ws-action-main" onClick={() => onOffer(post)} disabled={closed} data-testid={`button-offer-${post.id}`}>
          <Gift size={18} />{fulfilled ? 'Fulfilled' : post.status === 'Matched' ? 'Fully matched' : 'Offer help'}
        </button>
        <button className="ws-action" onClick={() => void share()} data-testid={`button-share-${post.id}`}><Share2 size={18} />Share</button>
      </footer>
    </article>
  );
}

// What an offer needs to know about a request (the feed and the detail page both use it).
export type OfferTarget = Pick<FeedPost, 'id' | 'title' | 'schoolName' | 'unit' | 'quantity' | 'quantityCovered' | 'categoryGroup' | 'serviceAreaName'>;

export function OfferDialog({ post, onClose }: { post: OfferTarget | null; onClose: () => void }) {
  const client = useQueryClient();
  const { toast } = useToast();
  const { verified, loading } = useIsVerified();
  const goods = useGetInventory({ query: { queryKey: getGetInventoryQueryKey(), enabled: !!post } });
  const create = useCreateSponsorship();
  const [error, setError] = useState<unknown>(null);
  const [picked, setPicked] = useState('');
  const [offerMode, setOfferMode] = useState<'inventory' | 'source'>('inventory');
  const actionId = useRef<string | null>(null);

  // Only goods of the kind this request asks for can be offered; goods in the same service area come first.
  const options = (goods.data ?? [])
    .filter((item) => item.status === 'AVAILABLE' && item.quantityAvailable > 0 && post && item.categoryGroup === post.categoryGroup)
    .sort((a, b) => Number(b.serviceAreaName === post?.serviceAreaName) - Number(a.serviceAreaName === post?.serviceAreaName));
  const chosen = options.find((item) => item.id === picked) ?? options[0];
  const effectiveMode = options.length === 0 ? 'source' : offerMode;
  const form = useForm<{ quantity: number; donorMessage: string }>({ values: { quantity: 1, donorMessage: '' } });
  const { reset } = form;

  useEffect(() => {
    setOfferMode('inventory');
    setPicked('');
    setError(null);
    actionId.current = null;
    reset({ quantity: 1, donorMessage: '' });
  }, [post?.id, reset]);

  const submit = form.handleSubmit((values) => {
    if (!post) return;
    setError(null);
    const wanted = Number(values.quantity);
    if (!Number.isInteger(wanted) || wanted < 1 || wanted > 10000) { setError(new Error('Enter a quantity between 1 and 10,000.')); return; }
    if (effectiveMode === 'inventory' && !chosen) { setError(new Error('Choose one of your listed goods, or choose that you will source them.')); return; }
    if (effectiveMode === 'inventory' && chosen && wanted > chosen.quantityAvailable) { setError(new Error(`You only have ${chosen.quantityAvailable} of these available.`)); return; }
    actionId.current ??= crypto.randomUUID();
    create.mutate({ data: { actionId: actionId.current, requestId: post.id, inventoryId: effectiveMode === 'inventory' ? chosen?.id ?? null : null, quantity: wanted, donorMessage: values.donorMessage.trim() || null } }, {
      onSuccess: () => {
        toast({ title: 'Offer sent 🎉', description: 'The teacher will review it and you’ll be notified.' });
        void client.invalidateQueries({ queryKey: [FEED_KEY] });
        void client.invalidateQueries({ queryKey: getGetSponsorshipsQueryKey() });
        void client.invalidateQueries({ queryKey: getGetInventoryQueryKey() });
        void client.invalidateQueries({ queryKey: getGetDonorDashboardQueryKey() });
        actionId.current = null;
        form.reset();
        setPicked('');
        setOfferMode('inventory');
        onClose();
      },
      onError: setError,
    });
  });

  return (
    <Dialog open={!!post} onOpenChange={(open) => { if (!open) { setError(null); setPicked(''); setOfferMode('inventory'); actionId.current = null; onClose(); } }}>
      <DialogContent className="ws-dialog">
        <DialogHeader>
          <DialogTitle>Offer help</DialogTitle>
          <DialogDescription>{post?.title} · {post?.schoolName}</DialogDescription>
        </DialogHeader>
        {!loading && !verified ? (
          <div className="ws-notice ws-notice-warn">Your account is still being verified, so offers are paused for now. You can keep browsing and saving requests in the meantime. <Link href="/donor/me" onClick={onClose}>Check verification</Link></div>
        ) : goods.isLoading ? (
          <p className="ws-muted ws-empty-line">Checking your listed goods…</p>
        ) : (
          <form onSubmit={submit} className="ws-form" noValidate>
            {goods.isError && <div className="ws-notice ws-notice-warn">Your listed goods could not be checked. You can still offer goods you plan to source.</div>}
            <label className="ws-field">How will you provide these goods?
              <select className="ws-input" value={effectiveMode} onChange={(e) => setOfferMode(e.target.value as typeof offerMode)} data-testid="select-offer-source">
                <option value="inventory" disabled={options.length === 0}>From my listed goods</option>
                <option value="source">I’ll buy or source them before handoff</option>
              </select>
              <small>Listed goods are reserved while the school reviews your offer. Sourced goods don’t need to be in your inventory yet.</small>
            </label>
            {effectiveMode === 'inventory' && <label className="ws-field">Which listed goods?
              <select className="ws-input" value={chosen?.id ?? ''} onChange={(e) => setPicked(e.target.value)} data-testid="select-offer-goods">
                {options.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.quantityAvailable} {item.unit} · {item.locationName ?? item.district}</option>)}
              </select>
              {chosen && <small>Available in {chosen.locationName ?? chosen.district}{chosen.condition ? ` · ${goodsConditionLabels[chosen.condition] ?? chosen.condition} condition` : ''}.</small>}
            </label>}
            <label className="ws-field">How many {post?.unit}?
              <input className="ws-input" type="number" min={1} max={effectiveMode === 'inventory' ? chosen?.quantityAvailable ?? 1 : 10000} {...form.register('quantity', { valueAsNumber: true })} data-testid="input-offer-quantity" />
              <small>{effectiveMode === 'inventory' ? `You have ${chosen?.quantityAvailable ?? 0} available.` : 'You can source these after the school accepts your offer.'} The school still needs about {post ? Math.max(1, post.quantity - post.quantityCovered) : 1}.</small>
            </label>
            <label className="ws-field">Note to the teacher <span className="ws-muted">(optional)</span>
              <textarea className="ws-input" rows={3} maxLength={500} placeholder="e.g. I can drop them off on weekdays." {...form.register('donorMessage')} data-testid="input-offer-message" />
            </label>
            <Feedback error={error} />
            <button className="ws-btn ws-btn-primary" disabled={create.isPending || !chosen} data-testid="button-send-offer">{create.isPending ? 'Sending…' : 'Send offer'}</button>
            <p className="ws-fine">Goods only. The teacher reviews every offer. If you plan to buy or source the goods later, arrange the handoff after the school accepts. Sedibeng doesn’t match sizes.</p>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
