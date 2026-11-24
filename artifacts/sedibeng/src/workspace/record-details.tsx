import { useState } from 'react';
import { Link, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, PackageCheck } from 'lucide-react';
import {
  getGetNotificationsQueryKey, getGetOrdersQueryKey, getGetRequestQueryKey, getGetSponsorshipsQueryKey,
  useDecideSponsorship, useGetMyRequests, useGetRequest, useGetSponsorships,
} from '@workspace/api-client-react';
import { ErrorState } from '../components/site';
import { Card, Feedback, PageHeader, StatusPill } from './ui';

export function TeacherRequestDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const requests = useGetMyRequests();
  const request = (requests.data ?? []).find((item) => item.id === id);
  const published = useGetRequest(id, { query: { enabled: !!request && ['Open', 'Partially matched', 'Matched', 'Fulfilled'].includes(request.status), queryKey: getGetRequestQueryKey(id) } });
  const detail = request && published.data ? { ...request, ...published.data } : request;
  return (
    <div className="ws-col ws-col-wide">
      <Link href="/teacher/requests" className="ws-back"><ArrowLeft size={15} />Back to requests</Link>
      {requests.isLoading ? <Card><div className="ws-skel" aria-label="Loading request"><div className="ws-skel-line w40"/><div className="ws-skel-line w80"/><div className="ws-skel-line w60"/></div></Card>
        : requests.isError ? <ErrorState onRetry={() => void requests.refetch()} />
        : !detail ? <Card><h2>Request not found</h2><p className="ws-muted">This request may no longer be available.</p></Card>
        : <>
          <PageHeader title={detail.title} subtitle="Your request details" />
          <Card title="What the school needs" hint="Shared with donors when your request is published.">
            {detail.imageUrl && <img className="ws-request-detail-photo" src={detail.imageUrl} alt={detail.imageAlt || detail.title} />}
            <dl className="ws-detail-list">
              <div><dt>Status</dt><dd><StatusPill status={detail.status}/></dd></div>
              <div><dt>Item</dt><dd>{detail.item}</dd></div>
              <div><dt>Amount requested</dt><dd>{detail.quantity} {detail.unit}</dd></div>
              <div><dt>Category</dt><dd>{detail.category}</dd></div>
              <div><dt>Where needed</dt><dd>{detail.locationName || detail.location}</dd></div>
              {detail.serviceAreaName && <div><dt>Service area</dt><dd>{detail.serviceAreaName}</dd></div>}
              <div><dt>Priority</dt><dd>{detail.priority}</dd></div>
              {detail.size && <div><dt>Size</dt><dd>{detail.size}</dd></div>}
              {detail.conditionRequirement && <div><dt>Condition</dt><dd>{detail.conditionRequirement.replaceAll('_', ' ').toLowerCase()}</dd></div>}
              {detail.requiredBy && <div><dt>Needed by</dt><dd>{new Date(detail.requiredBy).toLocaleDateString()}</dd></div>}
              <div className="ws-detail-full"><dt>Why it’s needed</dt><dd>{detail.description}</dd></div>
              {detail.specifications && <div className="ws-detail-full"><dt>More details</dt><dd>{detail.specifications}</dd></div>}
              {detail.schoolContext && <div className="ws-detail-full"><dt>School context</dt><dd>{detail.schoolContext}</dd></div>}
              <div><dt>Last updated</dt><dd>{detail.updatedLabel}</dd></div>
              {detail.moderationFeedback && <div className="ws-detail-full"><dt>Reviewer’s note</dt><dd>{detail.moderationFeedback}</dd></div>}
            </dl>
          </Card>
          {detail.teacherPrivateNotes && <Card title="Private note for reviewers" hint="Only you and authorized administrators can see this."><p>{detail.teacherPrivateNotes}</p></Card>}
        </>}
    </div>
  );
}

export function OfferDetail({ role }: { role: 'teacher' | 'donor' }) {
  const { id = '' } = useParams<{ id: string }>();
  const client = useQueryClient();
  const offers = useGetSponsorships();
  const decide = useDecideSponsorship();
  const [feedback, setFeedback] = useState<{ error?: unknown; success?: string }>({});
  const offer = (offers.data ?? []).find((item) => item.id === id);
  const requestId = offer?.requestId ?? '';
  const request = useGetRequest(requestId, {
    query: {
      enabled: !!offer,
      queryKey: getGetRequestQueryKey(requestId),
    },
  });
  const back = role === 'teacher' ? '/teacher/offers' : '/donor/activity';
  const refresh = () => {
    void client.invalidateQueries({ queryKey: getGetSponsorshipsQueryKey() });
    void client.invalidateQueries({ queryKey: getGetOrdersQueryKey() });
    void client.invalidateQueries({ queryKey: getGetNotificationsQueryKey() });
  };
  const decideOffer = (decision: 'APPROVE' | 'REJECT') => {
    setFeedback({});
    decide.mutate({ id, data: { decision } }, {
      onSuccess: () => { setFeedback({ success: decision === 'APPROVE' ? 'Offer accepted. You can coordinate the handoff in Handoffs.' : 'Offer declined.' }); refresh(); },
      onError: (error) => setFeedback({ error }),
    });
  };
  return (
    <div className="ws-col ws-col-wide">
      <Link href={back} className="ws-back"><ArrowLeft size={15}/>Back to {role === 'teacher' ? 'offers' : 'activity'}</Link>
      {offers.isLoading ? <Card><div className="ws-skel" aria-label="Loading offer"><div className="ws-skel-line w40"/><div className="ws-skel-line w80"/><div className="ws-skel-line w60"/></div></Card>
        : offers.isError ? <ErrorState onRetry={() => void offers.refetch()} />
        : !offer ? <Card><h2>Offer not found</h2><p className="ws-muted">This offer may no longer be available.</p></Card>
        : <>
          <PageHeader title={offer.requestTitle} subtitle={role === 'teacher' ? `An offer from ${offer.donorName}` : 'Your offer to help'} />
          <Card title="Offer details" hint="A practical offer, with room to work out the next steps together.">
            <div className="ws-offer-summary"><span className="ws-offer-icon"><PackageCheck size={24}/></span><div><strong>{offer.quantity} offered</strong><p>{offer.inventoryTitle ? `From ${offer.inventoryTitle}` : 'The donor plans to source these goods'}</p></div><StatusPill status={offer.status}/></div>
            <dl className="ws-detail-list">
              {role === 'teacher' && <div><dt>Offered by</dt><dd>{offer.donorName}</dd></div>}
              <div><dt>Request</dt><dd>{offer.requestTitle}</dd></div>
              <div><dt>Offered amount</dt><dd>{offer.quantity}</dd></div>
              {offer.acceptedQuantity !== null && <div><dt>Accepted amount</dt><dd>{offer.acceptedQuantity}</dd></div>}
              <div><dt>Offer date</dt><dd>{new Date(offer.createdAt).toLocaleDateString()}</dd></div>
              {offer.donorMessage && <div className="ws-detail-full"><dt>Message</dt><dd>{offer.donorMessage}</dd></div>}
            </dl>
          </Card>
          {request.isLoading ? (
            <Card><div className="ws-skel" aria-label="Loading request"><div className="ws-skel-line w40"/><div className="ws-skel-line w80"/><div className="ws-skel-line w60"/></div></Card>
          ) : request.isError ? (
            <Card title="Request details"><ErrorState onRetry={() => void request.refetch()} /></Card>
          ) : request.data ? (
            <Card title="Original request" hint="The published school need this offer responds to.">
              {request.data.imageUrl && <img className="ws-request-detail-photo" src={request.data.imageUrl} alt={request.data.imageAlt || request.data.title} />}
              <dl className="ws-detail-list">
                <div><dt>Item</dt><dd>{request.data.item}</dd></div>
                <div><dt>Amount requested</dt><dd>{request.data.quantity} {request.data.unit}</dd></div>
                <div><dt>Category</dt><dd>{request.data.category}</dd></div>
                <div><dt>Where needed</dt><dd>{request.data.location}</dd></div>
                {request.data.serviceAreaName && <div><dt>Service area</dt><dd>{request.data.serviceAreaName}</dd></div>}
                <div><dt>Priority</dt><dd>{request.data.priority}</dd></div>
                {request.data.size && <div><dt>Size</dt><dd>{request.data.size}</dd></div>}
                {request.data.conditionRequirement && <div><dt>Condition</dt><dd>{request.data.conditionRequirement.replaceAll('_', ' ').toLowerCase()}</dd></div>}
                {request.data.requiredBy && <div><dt>Needed by</dt><dd>{new Date(request.data.requiredBy).toLocaleDateString()}</dd></div>}
                <div className="ws-detail-full"><dt>Why it’s needed</dt><dd>{request.data.description}</dd></div>
                {request.data.specifications && <div className="ws-detail-full"><dt>More details</dt><dd>{request.data.specifications}</dd></div>}
                {request.data.schoolContext && <div className="ws-detail-full"><dt>School context</dt><dd>{request.data.schoolContext}</dd></div>}
                <div><dt>Last updated</dt><dd>{request.data.updatedLabel}</dd></div>
              </dl>
              <Link href={`/requests/${offer.requestId}`} className="ws-btn ws-btn-ghost ws-btn-sm">Open published request</Link>
            </Card>
          ) : null}
          {role === 'teacher' && offer.status === 'PENDING_TEACHER_REVIEW' && (
            <Card title="Your decision" hint="You can accept or decline this offer.">
              <div className="ws-form-actions">
                <button className="ws-btn ws-btn-primary" disabled={decide.isPending} onClick={() => decideOffer('APPROVE')}>{decide.isPending ? 'Saving…' : 'Accept offer'}</button>
                <button className="ws-btn ws-btn-ghost" disabled={decide.isPending} onClick={() => decideOffer('REJECT')}>Decline</button>
              </div>
            </Card>
          )}
          {role === 'teacher' && <Feedback error={feedback.error} success={feedback.success}/>}
          {role === 'teacher' && offer.status === 'APPROVED' && <Card title="Next step" hint="The accepted offer is in your handoffs list."><Link href="/teacher/handoffs" className="ws-btn ws-btn-primary">Go to handoffs</Link></Card>}
        </>}
    </div>
  );
}
