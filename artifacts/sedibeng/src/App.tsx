import { type ReactNode, useEffect, useRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { useGetAuthSession, useGetCsrfToken, getGetAuthSessionQueryKey, getGetCsrfTokenQueryKey, setCsrfTokenGetter } from '@workspace/api-client-react';
import type { AuthUserRole } from '@workspace/api-client-react';
import { AuthPage, DashboardPage, HomePage, NotFoundPage, RequestDetailPage, RequestsPage } from './pages/pages';
import { Footer, Header } from './components/site';

const queryClient = new QueryClient();

function Bootstrap() {
  const csrf = useGetCsrfToken({ query: { queryKey: getGetCsrfTokenQueryKey(), staleTime: 5 * 60_000 } });
  const token = useRef<string | null>(null);
  token.current = csrf.data?.csrfToken ?? null;
  useEffect(() => { setCsrfTokenGetter(() => token.current); return () => setCsrfTokenGetter(null); }, []);
  if (csrf.isLoading) return <div className="page-state"><div className="skeleton-line"/><p>Preparing a secure session…</p></div>;
  if (csrf.isError || !csrf.data?.csrfToken) return <div className="page-state"><h2>Secure connection unavailable</h2><p>We couldn’t prepare a protected connection for your account actions.</p><button className="button button-outline" onClick={() => void csrf.refetch()}>Try again</button></div>;
  return <Router/>;
}

function ProtectedDashboard({ role }: { role: AuthUserRole }) {
  const session = useGetAuthSession({ query: { queryKey: getGetAuthSessionQueryKey(), retry: false } });
  const [, navigate] = useLocation();
  useEffect(() => {
    if (session.isLoading || session.isError) return;
    const user = session.data?.user;
    if (!user) navigate('/sign-in');
    else if (user.role !== role) navigate(user.role === 'ADMIN' ? '/dashboard/admin' : user.role === 'TEACHER' ? '/dashboard/teacher' : '/dashboard/donor');
  }, [session.data, session.isLoading, session.isError, navigate, role]);
  if (session.isLoading) return <div className="page-state"><div className="skeleton-line"/><p>Checking your secure session…</p></div>;
  if (session.isError) return <div className="page-state"><h2>We couldn’t confirm your session</h2><button className="button button-outline" onClick={() => void session.refetch()}>Try again</button></div>;
  if (!session.data?.user || session.data.user.role !== role) return <div className="page-state">Opening your workspace…</div>;
  return <DashboardPage role={role === 'ADMIN' ? 'admin' : role === 'TEACHER' ? 'teacher' : 'donor'}/>;
}

function Router() {
  return <ErrorBoundary><div className="site-shell"><Header/><Switch>
    <Route path="/" component={HomePage}/>
    <Route path="/requests" component={RequestsPage}/>
    <Route path="/requests/:id" component={RequestDetailPage}/>
    <Route path="/sign-in">{() => <AuthPage kind="signin"/>}</Route>
    <Route path="/register/donor">{() => <AuthPage kind="donor"/>}</Route>
    <Route path="/register/teacher">{() => <AuthPage kind="teacher"/>}</Route>
    <Route path="/forgot-password">{() => <AuthPage kind="forgot"/>}</Route>
    <Route path="/reset-password">{() => <AuthPage kind="reset"/>}</Route>
    <Route path="/verify-email">{() => <AuthPage kind="verify"/>}</Route>
    <Route path="/dashboard/donor">{() => <ProtectedDashboard role="DONOR"/>}</Route>
    <Route path="/dashboard/teacher">{() => <ProtectedDashboard role="TEACHER"/>}</Route>
    <Route path="/dashboard/admin">{() => <ProtectedDashboard role="ADMIN"/>}</Route>
    <Route component={NotFoundPage}/>
  </Switch><Footer/></div></ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Bootstrap/></WouterRouter><Toaster/></TooltipProvider></QueryClientProvider>;
}
export default App;
