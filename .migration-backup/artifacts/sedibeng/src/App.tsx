import { type ReactNode, useEffect, useRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Redirect, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { useGetCsrfToken, getGetCsrfTokenQueryKey, setCsrfTokenGetter } from '@workspace/api-client-react';
import { AuthPage, HomePage, NotFoundPage, RequestDetailPage, RequestsPage } from './pages/pages';
import { Workspace, areaForPath } from './workspace';
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

function Router() {
  const [path] = useLocation();
  const area = areaForPath(path);
  // Signed-in workspaces get their own app-style shell, without the marketing header and footer.
  if (area) return <ErrorBoundary><Workspace area={area}/></ErrorBoundary>;
  return <ErrorBoundary><div className="site-shell"><Header/><Switch>
    <Route path="/" component={HomePage}/>
    <Route path="/requests" component={RequestsPage}/>
    <Route path="/requests/:id">{() => <RequestDetailPage/>}</Route>
    <Route path="/sign-in">{() => <AuthPage kind="signin"/>}</Route>
    <Route path="/register/donor">{() => <AuthPage kind="donor"/>}</Route>
    <Route path="/register/teacher">{() => <AuthPage kind="teacher"/>}</Route>
    <Route path="/forgot-password">{() => <AuthPage kind="forgot"/>}</Route>
    <Route path="/reset-password">{() => <AuthPage kind="reset"/>}</Route>
    <Route path="/verify-email">{() => <AuthPage kind="verify"/>}</Route>
    <Route path="/dashboard/donor">{() => <Redirect to="/donor" replace/>}</Route>
    <Route path="/dashboard/teacher">{() => <Redirect to="/teacher" replace/>}</Route>
    <Route path="/dashboard/admin">{() => <Redirect to="/admin" replace/>}</Route>
    <Route component={NotFoundPage}/>
  </Switch><Footer/></div></ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Bootstrap/></WouterRouter><Toaster/></TooltipProvider></QueryClientProvider>;
}
export default App;
