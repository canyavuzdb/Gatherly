'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AppSidebar } from '../components/app-sidebar';
import { apiUrl, getAccessToken } from '../../lib/api';

type Notification = { id: string; type: string; readAt: string | null; createdAt: string; payload: { eventId: string; title: string; body: string } };

export default function NotificationsPage() {
  const [items, setItems] = useState<Notification[]>([]); const [notice, setNotice] = useState('');
  const loadNotifications = useCallback(async () => {
    const token = getAccessToken();
    if (!token) { setNotice('Bildirimlerini görmek için giriş yapmalısın.'); return; }
    try {
      const response = await fetch(`${apiUrl}/api/v1/notifications`, { headers: { authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error();
      setItems((await response.json() as { items: Notification[] }).items); setNotice('');
    } catch { setNotice('Bildirimlerin şu an yüklenemedi.'); }
  }, []);
  async function openNotification(notification: Notification) {
    const token = getAccessToken();
    if (!notification.readAt && token) {
      await fetch(`${apiUrl}/api/v1/notifications/${notification.id}/read`, { method: 'POST', headers: { authorization: `Bearer ${token}` } }).catch(() => undefined);
      setItems((current) => current.map((item) => item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item));
      window.dispatchEvent(new Event('gatherly-notifications-updated'));
    }
  }
  useEffect(() => { void loadNotifications(); const refresh = () => void loadNotifications(); const timer = window.setInterval(refresh, 20_000); window.addEventListener('focus', refresh); return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); }; }, [loadNotifications]);
  return <AppSidebar><section className="dashboard-stage"><p className="auth-eyebrow">Bildirimler</p><h1 className="dashboard-title">Gelişmeler.</h1>{notice && <p className="form-note">{notice}</p>}{!notice && items.length === 0 && <p className="empty-state">Henüz bildirimin yok.</p>}<div className="dashboard-list">{items.map((notification) => <Link className={notification.readAt ? 'dashboard-row dashboard-link' : 'dashboard-row dashboard-link is-unread'} href={`/events/${notification.payload.eventId}`} onClick={() => void openNotification(notification)} key={notification.id}><span><strong>{notification.payload.title}</strong><small>{notification.payload.body}</small></span><time>{new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(notification.createdAt))}</time><em>Görüntüle →</em></Link>)}</div></section></AppSidebar>;
}
