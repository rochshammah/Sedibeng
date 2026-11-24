import { type ReactNode, useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  Bell, Bookmark, ClipboardList, Flag, Gift, Globe, HandHeart, Home, LogOut, type LucideIcon, Package, Plus,
  ShieldCheck, User, Users, Inbox, Truck,
} from 'lucide-react';
import {
  getGetAuthSessionQueryKey, getGetNotificationsQueryKey, getGetSponsorshipsQueryKey,
  useGetAuthSession, useGetNotifications, useGetSponsorships, useLogout,
} from '@workspace/api-client-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Brand } from '../components/site';
import { Avatar } from './ui';

export type Area = 'DONOR' | 'TEACHER' | 'ADMIN';

export const homePath: Record<Area, string> = { DONOR: '/donor', TEACHER: '/teacher', ADMIN: '/admin' };

type NavItem = { href: string; label: string; icon: LucideIcon; badge?: number; match?: (path: string) => boolean };

function navFor(area: Area, pendingOffers: number): NavItem[] {
  if (area === 'DONOR') {
    return [
      { href: '/donor', label: 'Home', icon: Home, match: (p) => p === '/donor' || p.startsWith('/donor/request') },
      { href: '/donor/saved', label: 'Saved', icon: Bookmark },
      { href: '/donor/goods', label: 'My goods', icon: Package },
      { href: '/donor/activity', label: 'Activity', icon: HandHeart },
      { href: '/donor/me', label: 'Me', icon: User },
    ];
  }
  if (area === 'TEACHER') {
    return [
      { href: '/teacher', label: 'Home', icon: Home, match: (p) => p === '/teacher' },
      { href: '/teacher/requests', label: 'Requests', icon: ClipboardList },
      { href: '/teacher/offers', label: 'Offers', icon: Gift, badge: pendingOffers },
      { href: '/teacher/handoffs', label: 'Handoffs', icon: Truck },
      { href: '/teacher/me', label: 'Me', icon: User },
    ];
  }
  return [
    { href: '/admin', label: 'Home', icon: Home, match: (p) => p === '/admin' },
    { href: '/admin/verifications', label: 'Verify', icon: ShieldCheck },
    { href: '/admin/moderation', label: 'Moderate', icon: Inbox },
    { href: '/admin/users', label: 'People', icon: Users },
    { href: '/admin/reports', label: 'Reports', icon: Flag },
  ];
}

export function RoleGuard({ area, children }: { area: Area; children: ReactNode }) {
  const session = useGetAuthSession({ query: { queryKey: getGetAuthSessionQueryKey(), retry: false } });
  const [, navigate] = useLocation();
  const user = session.data?.user;
  // Right after sign-in the cached "no user" answer is still refreshing; wait for the fresh one.
  const settling = session.isLoading || (session.isFetching && !user);
  useEffect(() => {
    if (settling || session.isError) return;
    if (!user) navigate('/sign-in');
    else if (user.role !== area) navigate(homePath[user.role as Area] ?? '/');
  }, [user, settling, session.isError, navigate, area]);

  if (settling) return <div className="page-state"><div className="skeleton-line" /><p>Checking your secure session…</p></div>;
  if (session.isError) return <div className="page-state"><h2>We couldn’t confirm your session</h2><button className="button button-outline" onClick={() => void session.refetch()}>Try again</button></div>;
  if (!user || user.role !== area) return <div className="page-state">Opening your space…</div>;
  return <>{children}</>;
}

export function AppShell({ area, children }: { area: Area; children: ReactNode }) {
  const client = useQueryClient();
  const [path, navigate] = useLocation();
  const session = useGetAuthSession({ query: { queryKey: getGetAuthSessionQueryKey() } });
  const logout = useLogout();
  const user = session.data?.user;

  const notifications = useGetNotifications({ query: { queryKey: getGetNotificationsQueryKey(), refetchInterval: 60_000 } });
  const offers = useGetSponsorships({ query: { queryKey: getGetSponsorshipsQueryKey(), enabled: area === 'TEACHER', refetchInterval: 60_000 } });
  const unread = (notifications.data ?? []).filter((item) => !item.readAt).length;
  const pendingOffers = (offers.data ?? []).filter((item) => item.status === 'PENDING_TEACHER_REVIEW').length;
  const nav = navFor(area, pendingOffers);
  const home = homePath[area];
  const isActive = (item: NavItem) => (item.match ? item.match(path) : path.startsWith(item.href));

  const signOut = () => logout.mutate(undefined, { onSuccess: () => { void client.invalidateQueries(); navigate('/sign-in'); } });

  return (
    <div className="ws-app" data-area={area.toLowerCase()}>
      <header className="ws-top">
        <Brand />
        <div className="ws-top-actions">
          {area === 'TEACHER' && <Link href="/teacher/requests/new" className="ws-btn ws-btn-primary ws-btn-sm ws-hide-xs" data-testid="link-post-need"><Plus size={15} />Post a need</Link>}
          <Link href={`${home}/notifications`} className="ws-icon-btn" aria-label={unread ? `Notifications, ${unread} new` : 'Notifications'} data-testid="link-notifications">
            <Bell size={20} />{unread > 0 && <i className="ws-dot">{unread > 9 ? '9+' : unread}</i>}
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger className="ws-avatar-btn" aria-label="Account menu" data-testid="button-account-menu"><Avatar name={user?.name || 'Sedibeng'} size={36} /></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="ws-menu">
              <DropdownMenuLabel><b>{user?.name}</b><br /><small>{user?.email}</small></DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => navigate('/')}><Globe size={15} />&nbsp;Visit the website</DropdownMenuItem>
              <DropdownMenuItem onSelect={signOut} disabled={logout.isPending} data-testid="button-sign-out"><LogOut size={15} />&nbsp;{logout.isPending ? 'Signing out…' : 'Sign out'}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="ws-body">
        <aside className="ws-side" aria-label="Sections">
          <nav>
            {nav.map((item) => (
              <Link key={item.href} href={item.href} className={isActive(item) ? 'is-active' : ''} aria-current={isActive(item) ? 'page' : undefined}>
                <item.icon size={19} /><span>{item.label}</span>{!!item.badge && <i className="ws-count">{item.badge}</i>}
              </Link>
            ))}
          </nav>
          {area === 'TEACHER' && <Link href="/teacher/requests/new" className="ws-btn ws-btn-primary ws-side-cta"><Plus size={16} />Post a need</Link>}
        </aside>
        <main className="ws-main">{children}</main>
      </div>

      <nav className="ws-tabs" aria-label="Sections">
        {nav.map((item) => (
          <Link key={item.href} href={item.href} className={isActive(item) ? 'is-active' : ''} aria-current={isActive(item) ? 'page' : undefined}>
            <span className="ws-tab-icon"><item.icon size={22} />{!!item.badge && <i className="ws-dot">{item.badge}</i>}</span>
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
