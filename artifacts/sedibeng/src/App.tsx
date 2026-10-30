import { type ReactNode, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';
import { AuthPage, DashboardPage, HomePage, NotFoundPage, RequestDetailPage, RequestsPage } from './pages/pages';
import { Footer, Header } from './components/site';

const queryClient = new QueryClient();

const pageMeta = (path: string) => {
  if (path === '/requests') return { title: 'School essentials requests in Gaborone | Sedibeng', description: 'Browse sample requests for school shoes, uniforms, backpacks, books and stationery. All Sedibeng catalogue entries are demonstration data.' };
  if (path.startsWith('/requests/')) return { title: 'School essentials request details | Sedibeng', description: 'Review an anonymous, school-level sample request for physical school goods. No learner identities or private circumstances are shown.' };
  if (path === '/dashboard/donor') return { title: 'Donor dashboard preview | Sedibeng', description: 'Preview Sedibeng’s goods-first donor experience using clearly marked sample inventory, offers and suggested matches.' };
  if (path === '/dashboard/teacher') return { title: 'Teacher dashboard preview | Sedibeng', description: 'Preview school-level assistance requests and future teacher-led match approval workflows. Demonstration data only.' };
  if (path === '/dashboard/admin') return { title: 'Admin dashboard preview | Sedibeng', description: 'Preview sample moderation and safeguarding workflows. Teacher verification and request moderation are not active.' };
  if (path === '/sign-in') return { title: 'Sign in preview | Sedibeng', description: 'View the Sedibeng sign-in screen. Authentication is not active and credentials are never sent or saved.' };
  if (path.startsWith('/register/')) return { title: 'Registration preview | Sedibeng', description: 'View a Sedibeng teacher or donor registration screen. Account creation is not active in this demonstration.' };
  if (path.startsWith('/forgot-password') || path.startsWith('/reset-password')) return { title: 'Account recovery preview | Sedibeng', description: 'Preview Sedibeng account recovery screens. No emails are sent and no password changes are processed.' };
  if (path === '/') return { title: 'School essentials, shared with care | Sedibeng', description: 'Sedibeng connects teachers with donors offering physical school essentials in Gaborone, Botswana, while keeping learner identities private.' };
  return { title: 'Sedibeng | School essentials, shared with care', description: 'A safeguarding-first platform preview connecting teachers and donors around physical school essentials in Gaborone.' };
};

function PageMetadata() {
  const [location] = useLocation();
  useEffect(() => {
    const path = location.split('?')[0] || '/';
    const meta = pageMeta(path);
    document.title = meta.title;
    const setMeta = (selector: string, attribute: 'name'|'property', key: string, content: string) => {
      let element = document.head.querySelector<HTMLMetaElement>(selector);
      if (!element) {
        element = document.createElement('meta');
        element.setAttribute(attribute, key);
        document.head.appendChild(element);
      }
      element.content = content;
    };
    const canonicalUrl = new URL(path, window.location.origin).toString();
    const imageUrl = new URL('/images/sedibeng-community-preparation.jpg', window.location.origin).toString();
    setMeta('meta[name="description"]', 'name', 'description', meta.description);
    setMeta('meta[property="og:title"]', 'property', 'og:title', meta.title);
    setMeta('meta[property="og:description"]', 'property', 'og:description', meta.description);
    setMeta('meta[property="og:url"]', 'property', 'og:url', canonicalUrl);
    setMeta('meta[property="og:image"]', 'property', 'og:image', imageUrl);
    setMeta('meta[name="twitter:title"]', 'name', 'twitter:title', meta.title);
    setMeta('meta[name="twitter:description"]', 'name', 'twitter:description', meta.description);
    setMeta('meta[name="twitter:image"]', 'name', 'twitter:image', imageUrl);
    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = canonicalUrl;
  }, [location]);
  return null;
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <div className="site-shell">
        <Header />
        <Switch>
          <Route path="/" component={HomePage} />
          <Route path="/requests" component={RequestsPage} />
          <Route path="/requests/:id" component={RequestDetailPage} />
          <Route path="/sign-in">{() => <AuthPage kind="signin" />}</Route>
          <Route path="/register/donor">{() => <AuthPage kind="donor" />}</Route>
          <Route path="/register/teacher">{() => <AuthPage kind="teacher" />}</Route>
          <Route path="/forgot-password">{() => <AuthPage kind="forgot" />}</Route>
          <Route path="/reset-password">{() => <AuthPage kind="reset" />}</Route>
          <Route path="/dashboard/donor">{() => <DashboardPage role="donor" />}</Route>
          <Route path="/dashboard/teacher">{() => <DashboardPage role="teacher" />}</Route>
          <Route path="/dashboard/admin">{() => <DashboardPage role="admin" />}</Route>
          <Route component={NotFoundPage} />
        </Switch>
        <Footer />
      </div>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <PageMetadata />
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
