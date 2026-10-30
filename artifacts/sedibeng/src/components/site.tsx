import { Link } from 'wouter';
import { ArrowUpRight, BookOpen, HeartHandshake, Shield } from 'lucide-react';

export function Brand() {
  return <Link href="/" className="brand" data-testid="link-brand"><span className="brand-mark">s</span><span>Sedibeng</span></Link>;
}

export function Header() {
  return <header className="site-header" data-testid="site-header">
    <Brand />
    <nav className="nav-links" aria-label="Main navigation">
      <Link href="/requests" data-testid="link-catalogue">Browse requests</Link>
      <a href="/#how-it-works" data-testid="link-how-it-works">How it works</a>
      <Link href="/dashboard/donor" data-testid="link-demo-dashboard">Preview dashboards</Link>
    </nav>
    <div className="nav-actions">
      <Link href="/sign-in" className="button button-outline" data-testid="link-sign-in">Sign in</Link>
      <Link href="/register/donor" className="button button-primary" data-testid="link-give-goods">Give goods <ArrowUpRight size={15}/></Link>
    </div>
  </header>;
}

export function Footer() {
  return <footer className="footer" data-testid="site-footer"><div className="footer-inner">
    <Brand />
    <div className="footer-links">
      <Link href="/requests" data-testid="footer-catalogue">Requests</Link>
      <Link href="/register/teacher" data-testid="footer-teacher">For teachers</Link>
      <Link href="/register/donor" data-testid="footer-donor">For donors</Link>
      <Link href="/dashboard/admin" data-testid="footer-admin-preview">Admin preview</Link>
      <Link href="/sign-in" data-testid="footer-sign-in">Preview sign in</Link>
      <a href="/#safeguarding" data-testid="footer-safeguarding">Safeguarding</a>
      <a href="/#privacy" data-testid="footer-privacy">Privacy principles</a>
      <a href="/#faq" data-testid="footer-faq">FAQs</a>
    </div>
    <span>Contact details will be added in a later phase.</span>
    <span>© Sedibeng Phase 1 · A demonstration experience</span>
  </div></footer>;
}

export function DemoTag({ label = 'Demonstration data' }: { label?: string }) {
  return <span className="demo-pill" data-testid="status-demonstration"><i aria-hidden="true"/>{label}</span>;
}

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  return <div className="state-panel" role="alert" data-testid="state-api-error">
    <Shield size={25} strokeWidth={1.5} />
    <h3>We couldn’t load this preview</h3>
    <p>The demonstration service may be unavailable. Nothing has been submitted or saved.</p>
    <button className="button button-outline" onClick={onRetry} data-testid="button-retry">Try again</button>
  </div>;
}

export function LoadingState({ label = 'Loading demonstration content' }: { label?: string }) {
  return <div className="state-panel" role="status" data-testid="state-loading"><BookOpen size={24} strokeWidth={1.5}/><h3>{label}</h3><p>Gathering the example content for this preview.</p></div>;
}

export function PrivacyNote() {
  return <div className="privacy-note" data-testid="notice-safeguarding"><HeartHandshake size={16} style={{display:'inline',verticalAlign:'middle',marginRight:6}}/>Learners never have accounts or contact with donors. Requests share school-level context only—never a learner’s identity or private circumstances.</div>;
}
