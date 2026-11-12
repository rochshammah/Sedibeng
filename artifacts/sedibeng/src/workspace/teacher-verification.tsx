import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, FileText, Lock, Paperclip, Trash2 } from 'lucide-react';
import {
  type TeacherVerificationStage, type VerificationDocumentInfo,
  customFetch, getGetTeacherVerificationQueryKey,
  useAccessVerificationDocument, useDeleteVerificationDocument, useGetTeacherVerification, useSubmitTeacherVerificationStage,
} from '@workspace/api-client-react';
import { Card, Feedback, Notice, StatusPill } from './ui';

type Stage = 'IDENTITY' | 'PROFESSIONAL';

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = ['application/pdf', 'image/jpeg', 'image/png'];

export const documentLabels: Record<string, string> = {
  NATIONAL_ID: 'Omang (national ID)', PASSPORT: 'Passport', DRIVING_LICENCE: 'Driving licence',
  TEACHING_LICENCE: 'Teaching licence or registration', EMPLOYMENT_LETTER: 'Current employment letter',
  SCHOOL_CONFIRMATION: 'Letter from your school head or an authorised representative', OTHER: 'Other evidence',
};

const stageInfo: Record<Stage, { step: number; title: string; intro: string; types: string[] }> = {
  IDENTITY: {
    step: 1, title: 'Confirm who you are',
    intro: 'Upload a clear photo or scan of your Omang, passport or driving licence.',
    types: ['NATIONAL_ID', 'PASSPORT', 'DRIVING_LICENCE', 'OTHER'],
  },
  PROFESSIONAL: {
    step: 2, title: 'Confirm where you teach',
    intro: 'Upload one or more of: your teaching licence or registration, a current employment letter, or a letter from your school head or another authorised person at your school.',
    types: ['TEACHING_LICENCE', 'EMPLOYMENT_LETTER', 'SCHOOL_CONFIRMATION', 'OTHER'],
  },
};

const statusHelp: Record<string, string> = {
  NOT_STARTED: 'Not started yet.',
  PENDING: 'We’re reviewing your documents. You’ll get a notification as soon as it’s done.',
  NEEDS_MORE_INFORMATION: 'The reviewer needs a little more from you. See their note below.',
  VERIFIED: 'This step is confirmed.',
  REJECTED: 'This step wasn’t approved. See the reason below, then upload new evidence.',
  EXPIRED: 'This step has expired. Please upload up-to-date evidence.',
};

function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function StageCard({ stage, data, storageConfigured }: { stage: Stage; data: TeacherVerificationStage; storageConfigured: boolean }) {
  const info = stageInfo[stage];
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: getGetTeacherVerificationQueryKey() });
  const submit = useSubmitTeacherVerificationStage();
  const remove = useDeleteVerificationDocument();
  const access = useAccessVerificationDocument();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [docType, setDocType] = useState(info.types[0]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok?: string; error?: unknown }>({});

  const drafts = data.documents.filter((doc) => !doc.submitted);
  const submitted = data.documents.filter((doc) => doc.submitted);
  const responding = data.status === 'NEEDS_MORE_INFORMATION';
  const canSend = drafts.length > 0 || (responding && submitted.length > 0 && note.trim().length > 0);
  const buttonLabel = responding ? 'Send my reply' : data.status === 'NOT_STARTED' ? 'Submit for review' : 'Submit again';

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setMessage({});
    if (!ACCEPTED.includes(file.type)) return setMessage({ error: new Error('Please choose a PDF, JPEG or PNG file.') });
    if (file.size > MAX_BYTES) return setMessage({ error: new Error('That file is too large. The limit is 5 MB.') });
    setBusy(true);
    try {
      await customFetch<VerificationDocumentInfo>(
        `/api/v1/teacher/verification/documents?stage=${stage}&documentType=${docType}&filename=${encodeURIComponent(file.name)}`,
        { method: 'POST', body: file, headers: { 'content-type': file.type }, responseType: 'json' },
      );
      await refresh();
    } catch (error) { setMessage({ error }); }
    finally { setBusy(false); if (fileInput.current) fileInput.current.value = ''; }
  };

  const open = (doc: VerificationDocumentInfo) => {
    // Open the tab straight away so the browser doesn't treat it as a pop-up, then point it at the short-lived link.
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    access.mutate({ id: doc.id }, {
      onSuccess: (result) => { if (tab) tab.location.href = result.url; },
      onError: (error) => { tab?.close(); setMessage({ error }); },
    });
  };

  const send = () => {
    setMessage({});
    submit.mutate({ stage, data: { note: note.trim() || null } }, {
      onSuccess: () => { setNote(''); setMessage({ ok: 'Sent for review. We’ll let you know the outcome.' }); void refresh(); },
      onError: (error) => setMessage({ error }),
    });
  };

  return (
    <section className={`ws-step ws-step-${data.status.toLowerCase()}`} data-testid={`verification-stage-${stage.toLowerCase()}`}>
      <header className="ws-step-head">
        <span className="ws-step-num">{data.status === 'VERIFIED' ? <BadgeCheck size={18} /> : info.step}</span>
        <div><h3>{info.title}</h3><p className="ws-muted">{info.intro}</p></div>
        <StatusPill status={data.status} />
      </header>
      <p className="ws-step-help">{statusHelp[data.status]}{data.status === 'VERIFIED' && data.expiresAt ? ` Valid until ${new Date(data.expiresAt).toLocaleDateString()}.` : ''}</p>

      {data.feedback && ['NEEDS_MORE_INFORMATION', 'REJECTED', 'EXPIRED'].includes(data.status) && (
        <div className="ws-feedback-box" role="note"><b>Message from the reviewer</b><p>{data.feedback}</p></div>
      )}

      {data.documents.length > 0 && (
        <ul className="ws-docs">
          {[...submitted, ...drafts].map((doc) => (
            <li key={doc.id}>
              <FileText size={16} />
              <span><b>{documentLabels[doc.documentType] ?? doc.documentType}</b><small>{doc.originalFilename} · {formatSize(doc.sizeBytes)}{doc.submitted ? ' · sent' : ' · not sent yet'}</small></span>
              <button className="ws-btn ws-btn-ghost ws-btn-sm" onClick={() => open(doc)} disabled={access.isPending}>View</button>
              {!doc.submitted && <button className="ws-icon-btn" aria-label={`Remove ${doc.originalFilename}`} onClick={() => remove.mutate({ id: doc.id }, { onSuccess: () => void refresh() })}><Trash2 size={16} /></button>}
            </li>
          ))}
        </ul>
      )}

      {data.canSubmit && storageConfigured && (
        <div className="ws-upload">
          <label className="ws-field">What are you uploading?
            <select className="ws-input" value={docType} onChange={(e) => setDocType(e.target.value)} data-testid={`select-doc-type-${stage.toLowerCase()}`}>
              {info.types.map((type) => <option key={type} value={type}>{documentLabels[type]}</option>)}
            </select>
          </label>
          <label className="ws-btn ws-btn-soft ws-upload-btn">
            <Paperclip size={15} />{busy ? 'Uploading…' : 'Choose a file'}
            <input ref={fileInput} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" hidden disabled={busy} onChange={(e) => void onPick(e.target.files?.[0])} data-testid={`input-doc-file-${stage.toLowerCase()}`} />
          </label>
          <small className="ws-muted">PDF, JPEG or PNG, up to 5 MB each.</small>
          <label className="ws-field">{responding ? 'Your reply' : 'Anything we should know?'} <span className="ws-muted">(optional)</span>
            <textarea className="ws-input" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} data-testid={`input-note-${stage.toLowerCase()}`} />
          </label>
          <button className="ws-btn ws-btn-primary" disabled={!canSend || submit.isPending || busy} onClick={send} data-testid={`button-submit-${stage.toLowerCase()}`}>{submit.isPending ? 'Sending…' : buttonLabel}</button>
        </div>
      )}
      {data.canSubmit && !storageConfigured && <Notice tone="warn">Document uploads aren’t switched on yet. Please check back soon.</Notice>}
      <Feedback error={message.error} success={message.ok} />
    </section>
  );
}

export function TeacherVerificationPanel() {
  const verification = useGetTeacherVerification({ query: { queryKey: getGetTeacherVerificationQueryKey() } });
  const data = verification.data;
  if (verification.isLoading || !data) return <Card title="Verification"><p className="ws-muted">Loading…</p></Card>;
  const done = [data.identity, data.professional].filter((stage) => stage.status === 'VERIFIED').length;
  return (
    <Card title="Verification" hint="Two quick steps so donors can trust every request. Both are needed before you can publish.">
      <div className={`ws-eligibility ${data.eligible ? 'is-ok' : ''}`} data-testid="verification-eligibility">
        <span className="ws-eligibility-icon">{data.eligible ? <BadgeCheck size={20} /> : <Lock size={20} />}</span>
        <div>
          <b>{data.eligible ? 'You’re verified and can publish requests' : `${done} of 2 steps complete`}</b>
          <p>{data.eligible ? 'Your requests go to a quick review, then appear in donors’ feeds.' : data.reasons[0] ?? 'Finish both steps to publish requests. You can save drafts in the meantime.'}</p>
        </div>
      </div>
      <div className="ws-steps">
        <StageCard stage="IDENTITY" data={data.identity} storageConfigured={data.storageConfigured} />
        <StageCard stage="PROFESSIONAL" data={data.professional} storageConfigured={data.storageConfigured} />
      </div>
      <p className="ws-fine"><Lock size={12} /> Your documents are stored privately and are only seen by Sedibeng’s verification team.</p>
    </Card>
  );
}
