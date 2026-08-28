'use client';

import { useEffect, useState } from 'react';
import { AppSidebar } from '../components/app-sidebar';
import { apiUrl, getAccessToken } from '../../lib/api';

type Notification = { id: string; readAt: string | null; createdAt: string; payload: { title: string; body: string } };

export default function NotificationsPage() {
  const [items, setItems] = useState<Notification[]>([]); const [notice, setNotice] = useState('');
  useEffect(() => { const token = getAccessToken(); if (!token) { setNotice('Bildirimlerini görmek için giriş yapmalısın.'); return; } void fetch(`${apiUrl}/api/v1/notifications`, { headers: { authorization: `Bearer ${token}` } }).then(async (response) => { if (!response.ok) throw new Error(); return response.json() as Promise<{ items: Notification[] }>; }).then((page) => setItems(page.items)).catch(() => setNotice('Bildirimlerin şu an yüklenemedi.')); }, []);
  return <AppSidebar><section className="dashboard-stage"><p className="auth-eyebrow">Bildirimler</p><h1 className="dashboard-title">Gelişmeler.</h1>{notice && <p className="form-note">{notice}</p>}{!notice && items.length === 0 && <p className="empty-state">Henüz bildirimin yok.</p>}<div className="dashboard-list">{items.map((notification) => <div className={notification.readAt ? 'dashboard-row' : 'dashboard-row is-unread'} key={notification.id}><span><strong>{notification.payload.title}</strong><small>{notification.payload.body}</small></span><time>{new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(notification.createdAt))}</time></div>)}</div></section></AppSidebar>;
}
