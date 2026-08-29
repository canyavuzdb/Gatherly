'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AppSidebar } from '../components/app-sidebar';
import { apiUrl, getAccessToken } from '../../lib/api';

type Invitation = { id: string; eventId: string; status: string; expiresAt: string; event?: { title: string; startsAt: string } };

export default function InvitationsPage() {
  const [items, setItems] = useState<Invitation[]>([]); const [notice, setNotice] = useState('');
  const loadInvitations = useCallback(async () => {
    const token = getAccessToken();
    if (!token) { setNotice('Davetlerini görmek için giriş yapmalısın.'); return; }
    try {
      const response = await fetch(`${apiUrl}/api/v1/invitations/me`, { headers: { authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error();
      setItems(await response.json() as Invitation[]); setNotice('');
    } catch { setNotice('Davetlerin şu an yüklenemedi.'); }
  }, []);
  useEffect(() => { void loadInvitations(); const refresh = () => void loadInvitations(); const timer = window.setInterval(refresh, 20_000); window.addEventListener('focus', refresh); return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); }; }, [loadInvitations]);
  return <AppSidebar><section className="dashboard-stage"><p className="auth-eyebrow">Davetler</p><h1 className="dashboard-title">Bekleyen davetlerin.</h1>{notice && <p className="form-note">{notice}</p>}{!notice && items.length === 0 && <p className="empty-state">Bekleyen davetin yok.</p>}<div className="dashboard-list">{items.map((invitation) => <Link className="dashboard-row dashboard-link" href={`/events/${invitation.eventId}`} key={invitation.id}><span><strong>{invitation.event?.title ?? 'Etkinlik daveti'}</strong><small>{invitation.event ? new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(invitation.event.startsAt)) : 'Daveti ve etkinlik ayrıntılarını görüntüle'}</small></span><time>{new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium' }).format(new Date(invitation.expiresAt))}</time><em>Görüntüle →</em></Link>)}</div></section></AppSidebar>;
}
