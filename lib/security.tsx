import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

interface SecurityStatus {
  status: 'ok';
  supportNumber: string;
  whatsappLink: string;
}

interface SecurityContextValue {
  securityStatus: SecurityStatus;
  recheckSecurity: () => Promise<void>;
}

const SecurityContext = createContext<SecurityContextValue | null>(null);

export function useSecurityContext() {
  const ctx = useContext(SecurityContext);
  if (!ctx) throw new Error('useSecurityContext must be used inside SecurityProvider');
  return ctx;
}

export function SecurityProvider({ children, userId }: { children: ReactNode; userId: string | null }) {
  const [securityStatus] = useState<SecurityStatus>({
    status: 'ok',
    supportNumber: '+918179142535',
    whatsappLink: 'https://wa.me/918179142535',
  });

  const recheckSecurity = useCallback(async () => {
    // No-op: security checks disabled
  }, []);

  return (
    <SecurityContext.Provider value={{ securityStatus, recheckSecurity }}>
      {children}
    </SecurityContext.Provider>
  );
}
