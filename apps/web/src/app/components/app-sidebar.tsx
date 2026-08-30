'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useContext, useEffect, useState, type ReactNode } from 'react';
import { accessTokenExpiresAt, apiUrl, authenticatedFetch, clearStoredSession, getAccessToken, getSessionIdentity, refreshSession } from '../../lib/api';
import { AppShellContext } from './app-shell-context';

type Profile = {
  firstName: string;
  lastName: string;
  avatar: { mediaAssetId: string } | null;
};

export function AppSidebar({ children, persistent = false }: { children: ReactNode; persistent?: boolean }) {
  const isNestedInApplicationShell = useContext(AppShellContext);
  if (isNestedInApplicationShell && !persistent) return <>{children}</>;
  return <StandaloneAppSidebar>{children}</StandaloneAppSidebar>;
}

function StandaloneAppSidebar({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [isGuestAccessPromptOpen, setIsGuestAccessPromptOpen] = useState(false);
  function endExpiredSession() {
    clearStoredSession();
    router.replace('/login');
  }

  function requestGuestAccess() {
    if (!isAuthenticated) setIsGuestAccessPromptOpen(true);
  }

  useEffect(() => {
    const accessToken = getAccessToken();
    const identity = getSessionIdentity();
    if (!accessToken || !identity?.userId) return;
    setIsAuthenticated(true);
    let expiryTimer: number | undefined;
    const scheduleRefresh = (token: string) => {
      const expiresAt = accessTokenExpiresAt(token);
      if (expiresAt === null) return;
      expiryTimer = window.setTimeout(async () => {
        const refreshed = await refreshSession();
        if (refreshed) scheduleRefresh(refreshed.accessToken);
      }, Math.max(0, expiresAt - Date.now() - 60_000));
    };
    scheduleRefresh(accessToken);
    let objectUrl: string | null = null;
    async function loadProfile() {
      try {
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
        }
        setAvatarUrl(null);
        const response = await authenticatedFetch(`/api/v1/users/${identity!.userId}/profile`);
        if (!response.ok) return;
        const loadedProfile = await response.json() as Profile;
        setProfile(loadedProfile);
        if (!loadedProfile.avatar) return;
        const image = await authenticatedFetch(`/api/v1/media/${loadedProfile.avatar.mediaAssetId}`);
        if (!image.ok) return;
        objectUrl = URL.createObjectURL(await image.blob());
        setAvatarUrl(objectUrl);
      } catch {
        // Sidebar profile data is supplementary; navigation remains available.
      }
    }
    void loadProfile();
    window.addEventListener('gatherly-profile-updated', loadProfile);
    window.addEventListener('gatherly-session-expired', endExpiredSession);
    return () => {
      window.removeEventListener('gatherly-profile-updated', loadProfile);
      window.removeEventListener('gatherly-session-expired', endExpiredSession);
      if (expiryTimer !== undefined) window.clearTimeout(expiryTimer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, []);

  useEffect(() => {
    const accessToken = getAccessToken();
    if (!accessToken) return;
    async function loadNotificationSummary() {
      try {
        const response = await authenticatedFetch('/api/v1/notifications?limit=1');
        if (!response.ok) return;
        const page = await response.json() as { unreadCount: number };
        setUnreadNotificationCount(page.unreadCount);
      } catch {
        // A badge is supplementary; navigation remains available without it.
      }
    }
    void loadNotificationSummary();
    const refresh = () => void loadNotificationSummary();
    const timer = window.setInterval(refresh, 20_000);
    window.addEventListener('focus', refresh);
    window.addEventListener('gatherly-notifications-updated', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('gatherly-notifications-updated', refresh);
    };
  }, []);

  async function signOut() {
    const accessToken = getAccessToken();
    try {
      await fetch(`${apiUrl}/api/v1/auth/sign-out`, {
        method: 'POST',
        credentials: 'include',
        headers: accessToken ? { authorization: `Bearer ${accessToken}` } : undefined,
      });
    } finally {
      clearStoredSession();
      router.replace('/login');
    }
  }

  const fullName = profile ? `${profile.firstName} ${profile.lastName}` : 'Hesabın';
  const initials = profile ? `${profile.firstName[0] ?? ''}${profile.lastName[0] ?? ''}`.toUpperCase() : 'G';

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="sidebar-brand">
          <Link className="wordmark" href="/calendar" aria-label="Gatherly takvimi">
            <span className="wordmark-mark">••</span>
            <span className="sidebar-label">Gatherly</span>
          </Link>
        </div>
        <nav className="sidebar-nav" aria-label="Ana menü">
          <Link className={pathname === '/calendar' ? 'sidebar-link is-active' : 'sidebar-link'} href="/calendar"><SidebarIcon kind="calendar" /><span className="sidebar-label">Takvim</span><span className="sidebar-page-number">1</span></Link>
          <Link className={pathname === '/discover' || (pathname.startsWith('/events/') && pathname !== '/events/new') ? 'sidebar-link is-active' : 'sidebar-link'} href="/discover"><SidebarIcon kind="discover" /><span className="sidebar-label">Keşfet</span><span className="sidebar-page-number">2</span></Link>
          {isAuthenticated ? <Link className={pathname === '/events' || pathname === '/events/new' ? 'sidebar-link is-active' : 'sidebar-link'} href="/events"><SidebarIcon kind="events" /><span className="sidebar-label">Etkinliklerim</span><span className="sidebar-page-number">3</span></Link> : <button className="sidebar-link-button" type="button" onClick={requestGuestAccess}><SidebarIcon kind="events" /><span className="sidebar-label">Etkinliklerim</span><span className="sidebar-page-number">3</span></button>}
          {isAuthenticated ? <Link className={pathname === '/invitations' ? 'sidebar-link is-active' : 'sidebar-link'} href="/invitations"><SidebarIcon kind="invitations" /><span className="sidebar-label">Davetler</span><span className="sidebar-page-number">4</span></Link> : <button className="sidebar-link-button" type="button" onClick={requestGuestAccess}><SidebarIcon kind="invitations" /><span className="sidebar-label">Davetler</span><span className="sidebar-page-number">4</span></button>}
          {isAuthenticated ? <Link className={pathname === '/notifications' ? 'sidebar-link is-active' : 'sidebar-link'} href="/notifications" aria-label={unreadNotificationCount ? `Bildirimler, ${unreadNotificationCount} okunmamış` : 'Bildirimler'}><span className="sidebar-icon-wrap"><SidebarIcon kind="notifications" />{unreadNotificationCount > 0 && <span className="notification-alert-dot" aria-hidden="true" />}</span><span className="sidebar-label">Bildirimler</span><span className="sidebar-page-number">5</span></Link> : <button className="sidebar-link-button" type="button" onClick={requestGuestAccess}><span className="sidebar-icon-wrap"><SidebarIcon kind="notifications" /></span><span className="sidebar-label">Bildirimler</span><span className="sidebar-page-number">5</span></button>}
        </nav>
        <div className="sidebar-account">
          {isAuthenticated ? <div className="account-menu" title={fullName}>
            <div className="account-summary">
              <Link className="account-profile-link" href="/settings">
                {avatarUrl ? <img className="account-avatar" src={avatarUrl} alt="" /> : <span className="account-avatar account-initials">{initials}</span>}
                <span className="account-copy sidebar-label"><strong>{fullName}</strong><small>{profile ? 'Profil ve ayarlar' : 'Yükleniyor…'}</small></span>
              </Link>
              <button className="sign-out-button" type="button" onClick={() => void signOut()} aria-label="Oturumu kapat" title="Oturumu kapat"><span aria-hidden="true">⏻</span></button>
            </div>
          </div> : <div className="guest-actions">
            <p className="guest-label">Misafir görünümü</p>
            <div className="guest-buttons">
              <Link className="guest-sign-in" href="/login">Giriş yap <span aria-hidden="true">→</span></Link>
              <Link className="guest-register" href="/register">Kayıt ol</Link>
            </div>
          </div>}
        </div>
      </aside>
      <main className="app-content">{children}</main>
      {isGuestAccessPromptOpen && <div className="guest-access-backdrop" role="presentation" onMouseDown={() => setIsGuestAccessPromptOpen(false)}><section className="guest-access-prompt" role="dialog" aria-modal="true" aria-labelledby="guest-access-title" onMouseDown={(event) => event.stopPropagation()}><button className="guest-access-close" type="button" aria-label="Kapat" onClick={() => setIsGuestAccessPromptOpen(false)}>×</button><p className="guest-access-eyebrow">Hesap gerekli</p><h2 id="guest-access-title">Devam etmek için giriş yap.</h2><p className="guest-access-copy">Etkinliklerini oluşturmak, davetlerini yönetmek ve bildirimlerini görmek için hesabınla devam et.</p><div className="guest-access-actions"><Link className="guest-access-sign-in" href="/login">Giriş yap <span aria-hidden="true">→</span></Link><Link className="guest-access-register" href="/register">Kayıt ol</Link></div></section></div>}
    </div>
  );
}

function SidebarIcon({ kind }: { kind: 'calendar' | 'discover' | 'events' | 'invitations' | 'notifications' }) {
  if (kind === 'calendar') return <svg className="sidebar-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></svg>;
  if (kind === 'discover') return <svg className="sidebar-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m4 12 16-8-5.5 16-3-6-7.5-2Z" /><path d="m11.5 14 3.5-4" /></svg>;
  if (kind === 'events') return <svg className="sidebar-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M8 10h8M8 14h5" /></svg>;
  if (kind === 'invitations') return <svg className="sidebar-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="2" /><path d="m4 8 8 6 8-6" /></svg>;
  return <svg className="sidebar-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>;
}
