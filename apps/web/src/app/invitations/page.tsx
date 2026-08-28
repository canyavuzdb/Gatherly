'use client';

import { useEffect, useState } from 'react';
import { AppSidebar } from '../components/app-sidebar';
import { apiUrl, getAccessToken } from '../../lib/api';

type Invitation = { id: string; eventId: string; status: string; expiresAt: string };

export default function InvitationsPage() {
  const [items, setItems] = useState<Invitation[]>([]); const [notice, setNotice] = useState('');
  useEffect(() => { const token = getAccessToken(); if (!token) { setNotice('Davetlerini görmek için giriş yapmalısın.'); return; } void fetch(`${apiUrl}/api/v1/invitations/me`, { headers: { authorization: `Bearer ${token}` } }).then(async (response) => { if (!response.ok) throw new Error(); return response.json() as Promise<Invitation[]>; }).then(setItems).catch(() => setNotice('Davetlerin şu an yüklenemedi.')); }, []);
  return <AppSidebar><section className="dashboard-stage"><p className="auth-eyebrow">Davetler</p><h1 className="dashboard-title">Bekleyen davetlerin.</h1>{notice && <p className="form-note">{notice}</p>}{!notice && items.length === 0 && <p className="empty-state">Bekleyen davetin yok.</p>}<div className="dashboard-list">{items.map((invitation) => <div className="dashboard-row" key={invitation.id}><span><strong>Etkinlik daveti</strong><small>Etkinlik kimliği: {invitation.eventId}</small></span><time>{new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium' }).format(new Date(invitation.expiresAt))}</time><em>{invitation.status}</em></div>)}</div></section></AppSidebar>;
}
