import { createAdminSessionToken } from '@/lib/security/auth';
import { AdminSessionProvider } from '@/components/AdminSessionProvider';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const sessionToken = await createAdminSessionToken();

  return (
    <AdminSessionProvider sessionToken={sessionToken}>
      {children}
    </AdminSessionProvider>
  );
}

