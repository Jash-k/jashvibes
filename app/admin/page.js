import AdminApp from '@/components/admin/AdminApp';
import '@/components/admin/admin.css';

export const metadata = {
  title: 'Admin — JaSH ViBeS',
  robots: { index: false, follow: false },
};

/**
 * The admin control room. Renders inside the app's AuthGate (root layout), so
 * the theatre must be unlocked first; the admin layer itself is gated by
 * ADMIN_PASS inside AdminApp + every /api/admin/* handler.
 */
export default function AdminPage() {
  return <AdminApp />;
}
