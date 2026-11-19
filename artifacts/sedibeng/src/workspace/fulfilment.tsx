import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  type FulfilmentOrder,
  getGetNotificationsQueryKey,
  getGetOrdersQueryKey,
  useUpdateOrderStatus,
} from '@workspace/api-client-react';
import { Feedback, StatusPill } from './ui';

type OrderRole = 'donor' | 'school';
type Action =
  | 'START_PREPARING'
  | 'MARK_READY'
  | 'CONFIRM_HANDOFF'
  | 'CONFIRM_RECEIPT'
  | 'REPORT_ISSUE'
  | 'RESOLVE_ISSUE'
  | 'COMPLETE_DISTRIBUTION'
  | 'CANCEL';

const eventLabels: Record<string, string> = {
  OFFER_ACCEPTED: 'Offer accepted by the school',
  PREPARATION_STARTED: 'School preparation started',
  GOODS_READY: 'Donor marked goods ready',
  HANDOFF_CONFIRMED: 'Donor confirmed a handoff',
  GOODS_RECEIVED: 'School confirmed goods received',
  ISSUE_REPORTED: 'School reported a goods issue',
  ISSUE_RESOLVED: 'Donor responded to the issue',
  GOODS_DISTRIBUTED: 'School recorded private distribution',
  OFFER_CANCELLED: 'Offer cancelled',
};

export function FulfilmentOrderCard({
  order,
  role,
  onChanged,
}: {
  order: FulfilmentOrder;
  role: OrderRole;
  onChanged?: () => void;
}) {
  const client = useQueryClient();
  const update = useUpdateOrderStatus();
  const [quantity, setQuantity] = useState(1);
  const [issueType, setIssueType] = useState<'MISSING' | 'DAMAGED' | 'INCORRECT'>('MISSING');
  const [note, setNote] = useState('');
  const [privateNote, setPrivateNote] = useState('');
  const [generalArea, setGeneralArea] = useState('');
  const [handoffNotes, setHandoffNotes] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [feedback, setFeedback] = useState<{ error?: unknown; success?: string }>({});
  const retryAction = useRef<{ key: string; id: string } | null>(null);
  const remainingToHandOver = Math.max(0, order.acceptedQuantity - order.handedOverQuantity);
  const remainingToReceive = Math.max(0, order.handedOverQuantity - order.receivedQuantity);
  const remainingToDistribute = Math.max(0, order.receivedQuantity - order.distributedQuantity);
  const canFinishDistribution =
    role === 'school' && order.status === 'CANCELLED' && remainingToDistribute > 0;
  const closed =
    order.status === 'FULFILLED' ||
    (order.status === 'CANCELLED' && !canFinishDistribution);
  const canDistribute = role === 'school' && remainingToDistribute > 0 && order.status !== 'RESOLUTION_REQUIRED';

  useEffect(() => {
    setGeneralArea(order.generalArea ?? '');
    setHandoffNotes(order.handoffNotes ?? '');
    if (!order.scheduledAt) {
      setScheduledAt('');
      return;
    }
    const localDate = new Date(order.scheduledAt);
    localDate.setMinutes(localDate.getMinutes() - localDate.getTimezoneOffset());
    setScheduledAt(localDate.toISOString().slice(0, 16));
  }, [order.id, order.generalArea, order.handoffNotes, order.scheduledAt]);

  function act(
    action: Action,
    extra: {
      quantity?: number;
      issueType?: 'MISSING' | 'DAMAGED' | 'INCORRECT';
      note?: string;
      privateNote?: string;
      generalArea?: string;
      handoffNotes?: string;
      scheduledAt?: string;
    } = {},
    success = 'Handoff updated.',
  ) {
    setFeedback({});
    const key = JSON.stringify({ action, extra });
    if (retryAction.current?.key !== key) {
      retryAction.current = { key, id: crypto.randomUUID() };
    }
    update.mutate(
      {
        id: order.id,
        data: {
          action,
          actionId: retryAction.current.id,
          ...extra,
        },
      },
      {
        onSuccess: () => {
          retryAction.current = null;
          setFeedback({ success });
          setNote('');
          setPrivateNote('');
          void client.invalidateQueries({ queryKey: getGetOrdersQueryKey() });
          void client.invalidateQueries({ queryKey: getGetNotificationsQueryKey() });
          onChanged?.();
        },
        onError: (error) => setFeedback({ error }),
      },
    );
  }

  return (
    <article className="ws-handoff-card" data-testid={`handoff-${order.id}`}>
      <header className="ws-handoff-head">
        <div>
          <h3><Link href={`/requests/${order.requestId}`}>{order.requestTitle}</Link></h3>
          <p>
            {order.donorWillSource ? 'Donor will source these goods before handoff' : order.donorLocationName ? `Goods from ${order.donorLocationName}` : 'Goods location not set'}
            {' · '}
            {order.schoolLocationName ? `School in ${order.schoolLocationName}` : 'School location not set'}
            {order.generalArea ? ` · Handoff: ${order.generalArea}` : ''}
            {order.scheduledAt ? ` · ${new Date(order.scheduledAt).toLocaleString()}` : ''}
          </p>
          {order.handoffNotes && <p>{order.handoffNotes}</p>}
        </div>
        <StatusPill status={order.status} />
      </header>

      <div className="ws-handoff-quantities" aria-label="Goods quantities">
        <span>Offered <b>{order.quantity} {order.unit}</b></span>
        <span>Accepted <b>{order.acceptedQuantity} {order.unit}</b></span>
        <span>Handed over <b>{order.handedOverQuantity} {order.unit}</b></span>
        <span>Received <b>{order.receivedQuantity} {order.unit}</b></span>
        <span>Distributed <b>{order.distributedQuantity} {order.unit}</b></span>
      </div>

      {order.events.length > 0 && (
        <ol className="ws-timeline" aria-label="Handoff history">
          {order.events.map((event) => (
            <li key={event.id}>
              <span>{eventLabels[event.eventType] ?? 'Handoff updated'}</span>
              {event.quantity !== null && <span>· {event.quantity} {order.unit}</span>}
              {event.issueType && <span>· {event.issueType.toLowerCase()}</span>}
              <span>· {event.statusAfter.replaceAll('_', ' ').toLowerCase()}</span>
              {event.note && <span>· {event.note}</span>}
              {event.privateNote && role === 'school' && <span>· {event.privateNote}</span>}
              <small>
                {event.actorRole.replaceAll('_', ' ').toLowerCase()} ·{' '}
                {new Date(event.createdAt).toLocaleString()}
              </small>
            </li>
          ))}
        </ol>
      )}

      {!closed && (
        <div className="ws-handoff-actions">
          {role === 'donor' && order.status === 'PREPARING' && (
            <>
              <div className="ws-handoff-form">
                <label>
                  Handoff area <span className="ws-muted">(optional)</span>
                  <input className="ws-input" maxLength={120} value={generalArea} onChange={(event) => setGeneralArea(event.target.value)} placeholder="Town or agreed public meeting area" />
                </label>
                <label>
                  Proposed time <span className="ws-muted">(optional)</span>
                  <input className="ws-input" type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} />
                </label>
                <label>
                  Handoff note <span className="ws-muted">(optional)</span>
                  <input className="ws-input" maxLength={500} value={handoffNotes} onChange={(event) => setHandoffNotes(event.target.value)} placeholder="Pickup information only; no learner details" />
                </label>
              </div>
              <button
                className="ws-btn ws-btn-primary ws-btn-sm"
                disabled={update.isPending}
                onClick={() => act('MARK_READY', {
                  generalArea,
                  handoffNotes,
                  scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
                }, 'Goods marked ready. The school still needs to confirm handoff and receipt.')}
              >
                Mark goods ready
              </button>
            </>
          )}
          {role === 'school' && order.status === 'AWAITING_TEACHER_APPROVAL' && (
            <button
              className="ws-btn ws-btn-primary ws-btn-sm"
              disabled={update.isPending}
              onClick={() => act('START_PREPARING')}
            >
              Begin preparation
            </button>
          )}
          {role === 'donor' && order.status === 'READY_FOR_HANDOFF' && remainingToHandOver > 0 && (
            <div className="ws-handoff-form">
              <label>
                Quantity handed over
                <input
                  className="ws-input"
                  type="number"
                  min={1}
                  max={remainingToHandOver}
                  value={Math.min(quantity, remainingToHandOver)}
                  onChange={(event) => setQuantity(Number(event.target.value))}
                  aria-label="Quantity handed over"
                />
              </label>
              <button
                className="ws-btn ws-btn-primary ws-btn-sm"
                disabled={update.isPending || quantity < 1 || quantity > remainingToHandOver}
                onClick={() => act('CONFIRM_HANDOFF', { quantity }, 'Handoff recorded. The school must confirm what it received.')}
              >
                Confirm handoff
              </button>
            </div>
          )}
          {role === 'donor' && remainingToHandOver > 0 && ['PARTIALLY_HANDED_OVER', 'PARTIALLY_RECEIVED'].includes(order.status) && (
            <button
              className="ws-btn ws-btn-primary ws-btn-sm"
              disabled={update.isPending}
              onClick={() => act('MARK_READY', {}, 'The remaining goods are marked ready for handoff.')}
            >
              Mark remaining goods ready
            </button>
          )}
          {role === 'school' && remainingToReceive > 0 && ['HANDED_OVER', 'PARTIALLY_HANDED_OVER', 'PARTIALLY_RECEIVED'].includes(order.status) && (
            <div className="ws-handoff-form">
              <label>
                Quantity actually received
                <input
                  className="ws-input"
                  type="number"
                  min={1}
                  max={remainingToReceive}
                  value={Math.min(quantity, remainingToReceive)}
                  onChange={(event) => setQuantity(Number(event.target.value))}
                  aria-label="Quantity actually received"
                />
              </label>
              <button
                className="ws-btn ws-btn-primary ws-btn-sm"
                disabled={update.isPending || quantity < 1 || quantity > remainingToReceive}
                onClick={() => act('CONFIRM_RECEIPT', { quantity }, 'Receipt saved. The donor has not marked the request fulfilled.')}
              >
                Confirm receipt
              </button>
            </div>
          )}
          {canDistribute && (
            <details className="ws-handoff-details">
              <summary>Mark private distribution complete</summary>
              <div className="ws-handoff-form">
                <label>
                  Quantity distributed
                  <input
                    className="ws-input"
                    type="number"
                    min={1}
                    max={remainingToDistribute}
                    value={Math.min(quantity, remainingToDistribute)}
                    onChange={(event) => setQuantity(Number(event.target.value))}
                    aria-label="Quantity privately distributed"
                  />
                </label>
                <label>
                  Private school note <span className="ws-muted">(only school staff can see this)</span>
                  <textarea
                    className="ws-input"
                    rows={2}
                    maxLength={1000}
                    value={privateNote}
                    onChange={(event) => setPrivateNote(event.target.value)}
                    placeholder="No learner names or identifying details"
                  />
                </label>
                <button
                  className="ws-btn ws-btn-primary ws-btn-sm"
                  disabled={update.isPending || quantity < 1 || quantity > remainingToDistribute}
                  onClick={() => act('COMPLETE_DISTRIBUTION', { quantity, privateNote: privateNote || undefined }, 'Private distribution progress saved.')}
                >
                  Save distribution
                </button>
              </div>
            </details>
          )}
          {role === 'school' && order.handedOverQuantity > 0 && !['RESOLUTION_REQUIRED', 'CANCELLED'].includes(order.status) && (
            <details className="ws-handoff-details">
              <summary>Report missing, damaged or incorrect goods</summary>
              <div className="ws-handoff-form">
                <label>
                  Issue type
                  <select className="ws-input" value={issueType} onChange={(event) => setIssueType(event.target.value as typeof issueType)}>
                    <option value="MISSING">Missing</option>
                    <option value="DAMAGED">Damaged</option>
                    <option value="INCORRECT">Incorrect</option>
                  </select>
                </label>
                <label>
                  Quantity affected
                  <input
                    className="ws-input"
                    type="number"
                    min={1}
                    max={order.handedOverQuantity}
                    value={Math.min(quantity, order.handedOverQuantity)}
                    onChange={(event) => setQuantity(Number(event.target.value))}
                  />
                </label>
                <label>
                  Private note for school staff
                  <textarea
                    className="ws-input"
                    rows={2}
                    maxLength={1000}
                    value={privateNote}
                    onChange={(event) => setPrivateNote(event.target.value)}
                    placeholder="Do not include learner names or identifying details."
                  />
                </label>
                <button
                  className="ws-btn ws-btn-ghost ws-btn-sm"
                  disabled={update.isPending || quantity < 1 || quantity > order.handedOverQuantity}
                  onClick={() => act('REPORT_ISSUE', { quantity, issueType, privateNote: privateNote || undefined }, 'Issue sent to the donor without private school notes.')}
                >
                  Submit issue
                </button>
              </div>
            </details>
          )}
          {role === 'donor' && order.status === 'RESOLUTION_REQUIRED' && (
            <details className="ws-handoff-details" open>
              <summary>Respond to the school’s issue</summary>
              <div className="ws-handoff-form">
                <label>
                  Resolution update
                  <textarea className="ws-input" rows={2} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
                </label>
                <button
                  className="ws-btn ws-btn-primary ws-btn-sm"
                  disabled={update.isPending || !note.trim()}
                  onClick={() => act('RESOLVE_ISSUE', { note }, 'Resolution update sent to the school.')}
                >
                  Send update
                </button>
              </div>
            </details>
          )}
          {order.status !== 'CANCELLED' && (role === 'school' || order.handedOverQuantity === 0) && (
            <details className="ws-handoff-details">
              <summary>Cancel offer</summary>
              <div className="ws-handoff-form">
                <label>
                  Reason
                  <textarea className="ws-input" rows={2} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
                </label>
                <button
                  className="ws-btn ws-btn-ghost ws-btn-sm"
                  disabled={update.isPending || !note.trim()}
                  onClick={() => act('CANCEL', { note }, 'Offer cancelled. Any goods not handed over were returned to inventory.')}
                >
                  Confirm cancellation
                </button>
              </div>
            </details>
          )}
        </div>
      )}

      <Feedback error={feedback.error} success={feedback.success} />
    </article>
  );
}
