import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, LockKeyhole, MessageCircle, PackageCheck } from 'lucide-react';
import {
  type FulfilmentOrder,
  getGetNotificationsQueryKey, getGetOrderMessagesQueryKey, getGetOrdersQueryKey,
  useCreateOrderMessage, useGetOrderMessages, useUpdateOrderStatus,
} from '@workspace/api-client-react';
import { Feedback, StatusPill } from './ui';

type OrderRole = 'donor' | 'school';

export function FulfilmentOrderCard({ order, role, onChanged }: {
  order: FulfilmentOrder;
  role: OrderRole;
  onChanged?: () => void;
}) {
  const client = useQueryClient();
  const update = useUpdateOrderStatus();
  const [quantityReceived, setQuantityReceived] = useState(1);
  const [actionError, setActionError] = useState<unknown>();
  const [actionSuccess, setActionSuccess] = useState('');
  const closed = order.status === 'FULFILLED' || order.status === 'CANCELLED';
  const hasReadyEvent = order.events.some((event) => event.eventType === 'GOODS_READY');
  const conversationAvailable = hasReadyEvent || ['READY_FOR_HANDOFF', 'PARTIALLY_HANDED_OVER', 'HANDED_OVER', 'PARTIALLY_RECEIVED', 'RECEIVED', 'FULFILLED'].includes(order.status);
  const remaining = Math.max(0, order.acceptedQuantity - order.receivedQuantity);
  const actualReceived = order.receivedQuantity;
  const receiptSaved = actualReceived > 0;
  const canRecordReceipt = role === 'school' && conversationAvailable && !closed && remaining > 0;

  const refresh = () => {
    void client.invalidateQueries({ queryKey: getGetOrdersQueryKey() });
    void client.invalidateQueries({ queryKey: getGetNotificationsQueryKey() });
    onChanged?.();
  };

  const act = (action: 'MARK_READY' | 'CONFIRM_RECEIPT', quantity?: number) => {
    setActionError(undefined);
    setActionSuccess('');
    update.mutate({ id: order.id, data: { action, actionId: crypto.randomUUID(), ...(quantity === undefined ? {} : { quantity }) } }, {
      onSuccess: () => {
        setActionSuccess(action === 'MARK_READY' ? 'Goods marked ready. You can now coordinate here.' : 'Receipt saved. Thank you for recording what arrived.');
        refresh();
      },
      onError: setActionError,
    });
  };

  return (
    <article className="ws-handoff-card" data-testid={`handoff-${order.id}`}>
      <header className="ws-handoff-head">
        <div>
          <h3>{order.requestTitle}</h3>
          <p>{order.donorWillSource ? 'Goods the donor is sourcing' : order.donorLocationName ? `Goods from ${order.donorLocationName}` : 'Goods offered to your school'}</p>
        </div>
        <StatusPill status={order.status}/>
      </header>

      <div className="ws-receipt-amounts" aria-label="Offer and receipt amounts">
        <div><span>Offered</span><strong>{order.quantity} {order.unit}</strong></div>
        <div><span>Accepted</span><strong>{order.acceptedQuantity} {order.unit}</strong></div>
        {receiptSaved && <div><span>Received</span><strong>{actualReceived} {order.unit}</strong></div>}
      </div>

      {role === 'donor' && order.status === 'PREPARING' && (
        <div className="ws-ready-panel">
          <p>When the goods are ready, mark them here. You can then agree on a handoff in a private conversation.</p>
          <button className="ws-btn ws-btn-primary ws-btn-sm" data-testid={`button-mark-ready-${order.id}`} disabled={update.isPending} onClick={() => act('MARK_READY')}>
            <PackageCheck size={15}/>{update.isPending ? 'Saving…' : 'Mark goods ready'}
          </button>
        </div>
      )}

      {canRecordReceipt && (
        <div className="ws-receipt-panel">
          <div>
            <h4>Record what arrived</h4>
            <p>Enter the positive amount your school actually received. It can be less than the amount accepted; no explanation is needed.</p>
          </div>
          <label className="ws-receipt-field">Amount received
            <div className="ws-receipt-input-wrap">
              <input className="ws-input" type="number" min={1} max={remaining} step={1} value={Math.min(quantityReceived, Math.max(remaining, 1))} onChange={(event) => setQuantityReceived(Number(event.target.value))} aria-label={`Amount received in ${order.unit}`} data-testid={`input-received-quantity-${order.id}`} />
              <span>{order.unit}</span>
            </div>
          </label>
          <button className="ws-btn ws-btn-primary" data-testid={`button-confirm-receipt-${order.id}`} disabled={update.isPending || !Number.isInteger(quantityReceived) || quantityReceived < 1 || quantityReceived > remaining} onClick={() => act('CONFIRM_RECEIPT', quantityReceived)}>
            {update.isPending ? 'Saving receipt…' : 'Confirm goods received'}
          </button>
        </div>
      )}

      {receiptSaved && (
        <div className="ws-receipt-result" role="status">
          <span className="ws-receipt-check"><PackageCheck size={19}/></span>
          <div>
            <strong>{actualReceived} {order.unit} received</strong>
            <p>{actualReceived < order.acceptedQuantity
              ? `That is ${order.acceptedQuantity - actualReceived} ${order.unit} fewer than accepted. The amount received is recorded, and any unmet need remains available on the school’s request.`
              : 'The offered amount has been received.'}</p>
            {role === 'donor' && <p className="ws-thanks">Thank you for offering what you could. Your contribution is appreciated; there is no expectation to provide more.</p>}
          </div>
        </div>
      )}

      <Feedback error={actionError} success={actionSuccess}/>

      {conversationAvailable && (
        <HandoffConversation orderId={order.id} closed={closed} />
      )}
    </article>
  );
}

function HandoffConversation({ orderId, closed }: { orderId: string; closed: boolean }) {
  const client = useQueryClient();
  const messages = useGetOrderMessages(orderId, {
    query: {
      enabled: true,
      refetchInterval: closed ? false : 7000,
      queryKey: getGetOrderMessagesQueryKey(orderId),
    },
  });
  const create = useCreateOrderMessage();
  const [body, setBody] = useState('');
  const [sendError, setSendError] = useState<unknown>();
  const [sendSuccess, setSendSuccess] = useState('');
  const send = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = body.trim();
    if (!text || closed) return;
    setSendError(undefined);
    setSendSuccess('');
    create.mutate({ id: orderId, data: { actionId: crypto.randomUUID(), body: text } }, {
      onSuccess: () => {
        setBody('');
        setSendSuccess('Message sent.');
        void client.invalidateQueries({ queryKey: getGetOrderMessagesQueryKey(orderId) });
        void client.invalidateQueries({ queryKey: getGetNotificationsQueryKey() });
      },
      onError: setSendError,
    });
  };

  return (
    <section className="ws-conversation" aria-labelledby={`conversation-${orderId}`}>
      <header className="ws-conversation-head">
        <span className="ws-conversation-icon"><MessageCircle size={18}/></span>
        <div><h4 id={`conversation-${orderId}`}>Handoff conversation</h4><p>Private to the donor and school</p></div>
        <span className="ws-live-label"><i/>Updates automatically</span>
      </header>
      <div className="ws-privacy-reminder" role="note"><LockKeyhole size={15}/><p>Keep messages to practical handoff arrangements. Do not share learner names, photos, addresses, or other identifying details. Role labels are shown, but do not guarantee anonymity.</p></div>
      <div className="ws-message-list" aria-live="polite" aria-relevant="additions text">
        {messages.isLoading ? <div className="ws-skel" aria-label="Loading messages"><div className="ws-skel-line w60"/><div className="ws-skel-line w80"/></div>
          : messages.isError ? <div className="ws-message-error" role="alert"><p>Messages could not be loaded.</p><button className="ws-link-btn" onClick={() => void messages.refetch()}>Try again</button></div>
          : messages.data?.length ? messages.data.map((message) => (
            <article className={`ws-message ws-message-${message.senderLabel.toLowerCase()}`} key={message.id}>
              <div><strong>{message.senderLabel}</strong><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString()}</time></div>
              <p>{message.body}</p>
            </article>
          )) : <p className="ws-message-empty">No messages yet. Use this space to agree on a practical handoff.</p>}
      </div>
      {closed ? <p className="ws-conversation-closed">This conversation is read-only because the offer is complete or cancelled.</p> : (
        <form className="ws-message-form" onSubmit={send}>
          <label htmlFor={`message-${orderId}`}>Write a message</label>
          <textarea id={`message-${orderId}`} className="ws-input" rows={2} maxLength={1200} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Share practical handoff details…" data-testid={`input-handoff-message-${orderId}`} />
          <div className="ws-message-form-foot"><span>{body.length}/1200</span><button className="ws-btn ws-btn-primary ws-btn-sm" data-testid={`button-send-handoff-message-${orderId}`} disabled={create.isPending || !body.trim()} type="submit">{create.isPending ? 'Sending…' : <>Send message <ArrowUpRight size={14}/></>}</button></div>
          <Feedback error={sendError} success={sendSuccess}/>
        </form>
      )}
    </section>
  );
}
