import { Redirect, Route, Switch } from 'wouter';
import { AppShell, RoleGuard, type Area } from './shell';
import { NotificationsPage } from './common';
import { DonorActivity, DonorGoods, DonorHome, DonorMe, DonorRequest, DonorSaved } from './donor';
import { TeacherHandoffs, TeacherHome, TeacherMe, TeacherOffers, TeacherRequestForm, TeacherRequests } from './teacher';
import { AdminHome, AdminModeration, AdminReports, AdminUsers, AdminVerifications } from './admin';

// Which workspace (if any) a URL belongs to.
export function areaForPath(path: string): Area | null {
  if (path === '/donor' || path.startsWith('/donor/')) return 'DONOR';
  if (path === '/teacher' || path.startsWith('/teacher/')) return 'TEACHER';
  if (path === '/admin' || path.startsWith('/admin/')) return 'ADMIN';
  return null;
}

function Missing({ home }: { home: string }) { return <Redirect to={home} replace />; }

export function Workspace({ area }: { area: Area }) {
  return (
    <RoleGuard area={area}>
      <AppShell area={area}>
        {area === 'DONOR' && (
          <Switch>
            <Route path="/donor" component={DonorHome} />
            <Route path="/donor/saved" component={DonorSaved} />
            <Route path="/donor/request/:id" component={DonorRequest} />
            <Route path="/donor/goods" component={DonorGoods} />
            <Route path="/donor/activity" component={DonorActivity} />
            <Route path="/donor/notifications" component={NotificationsPage} />
            <Route path="/donor/me" component={DonorMe} />
            <Route>{() => <Missing home="/donor" />}</Route>
          </Switch>
        )}
        {area === 'TEACHER' && (
          <Switch>
            <Route path="/teacher" component={TeacherHome} />
            <Route path="/teacher/requests" component={TeacherRequests} />
            <Route path="/teacher/requests/new" component={TeacherRequestForm} />
            <Route path="/teacher/requests/:id/edit" component={TeacherRequestForm} />
            <Route path="/teacher/offers" component={TeacherOffers} />
            <Route path="/teacher/handoffs" component={TeacherHandoffs} />
            <Route path="/teacher/notifications" component={NotificationsPage} />
            <Route path="/teacher/me" component={TeacherMe} />
            <Route>{() => <Missing home="/teacher" />}</Route>
          </Switch>
        )}
        {area === 'ADMIN' && (
          <Switch>
            <Route path="/admin" component={AdminHome} />
            <Route path="/admin/verifications" component={AdminVerifications} />
            <Route path="/admin/moderation" component={AdminModeration} />
            <Route path="/admin/users" component={AdminUsers} />
            <Route path="/admin/reports" component={AdminReports} />
            <Route path="/admin/notifications" component={NotificationsPage} />
            <Route>{() => <Missing home="/admin" />}</Route>
          </Switch>
        )}
      </AppShell>
    </RoleGuard>
  );
}
