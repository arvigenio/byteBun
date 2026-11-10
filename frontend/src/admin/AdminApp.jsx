import { usePathname } from '../lib/router.js';
import { AdminLayout } from './AdminLayout.jsx';
import { BookingsPage } from './BookingsPage.jsx';
import { AdminDialogs } from './dialogs.jsx';
import { LeadsPage } from './LeadsPage.jsx';
import { ProspectsPage } from './ProspectsPage.jsx';
import { SecurityPage } from './SecurityPage.jsx';
import { SignInPage } from './SignInPage.jsx';
import { TaskPage } from './TaskPage.jsx';
import { TasksPage } from './TasksPage.jsx';

// The admin app. The server only serves it at the secret LOGIN_PATH (the sign-in page) and, to a
// fully signed-in admin, at /admin/*. The app never needs to know the secret path: any page that
// is not /admin/* is the sign-in page.
export default function AdminApp() {
  const pathname = usePathname().replace(/\/+$/, '');
  if (!pathname.startsWith('/admin')) return <SignInPage />;
  const taskId = pathname.match(/^\/admin\/tasks\/(\d+)$/)?.[1]; // /admin/tasks/12: one task's own page
  const page = pathname.startsWith('/admin/bookings') ? (
    <BookingsPage />
  ) : pathname.startsWith('/admin/prospects') ? (
    <ProspectsPage />
  ) : taskId ? (
    <TaskPage key={taskId} id={Number(taskId)} />
  ) : pathname.startsWith('/admin/tasks') ? (
    <TasksPage />
  ) : pathname.startsWith('/admin/security') ? (
    <SecurityPage />
  ) : (
    <LeadsPage />
  );
  return (
    <AdminDialogs>
      <AdminLayout pathname={pathname}>{page}</AdminLayout>
    </AdminDialogs>
  );
}
