'use client';

import React, { createContext, useContext, useCallback } from 'react';

interface AdminSessionContextType {
  sessionToken: string;
  adminFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

const AdminSessionContext = createContext<AdminSessionContextType | null>(null);

export function AdminSessionProvider({
  sessionToken,
  children,
}: {
  sessionToken: string;
  children: React.ReactNode;
}) {
  const adminFetch = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers);
      if (sessionToken && !headers.has('x-admin-session')) {
        headers.set('x-admin-session', sessionToken);
      }

      return fetch(input, {
        ...init,
        credentials: 'same-origin',
        headers,
      });
    },
    [sessionToken]
  );

  return (
    <AdminSessionContext.Provider value={{ sessionToken, adminFetch }}>
      {children}
    </AdminSessionContext.Provider>
  );
}

export function useAdminSession() {
  const ctx = useContext(AdminSessionContext);
  if (!ctx) {
    return {
      sessionToken: '',
      adminFetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, credentials: 'same-origin' }),
    };
  }
  return ctx;
}
