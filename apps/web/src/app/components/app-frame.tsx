'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShellContext } from './app-shell-context';
import { AppSidebar } from './app-sidebar';

export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const usesApplicationShell = pathname === '/calendar'
    || pathname === '/discover'
    || pathname === '/events'
    || pathname.startsWith('/events/')
    || pathname === '/invitations'
    || pathname === '/notifications'
    || pathname === '/settings';

  if (!usesApplicationShell) return <>{children}</>;
  return <AppShellContext.Provider value={true}><AppSidebar persistent>{children}</AppSidebar></AppShellContext.Provider>;
}
