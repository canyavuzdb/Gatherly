'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppSidebar } from '../components/app-sidebar';
import { apiUrl, getAccessToken } from '../../lib/api';

type EventItem = { id: string; title: string; startsAt: string; relationship: 'ORGANIZER' | 'ATTENDEE'; location: { city: string; district: string; venueName: string | null } };

export default function MyEventsPage() {
  const [items, setItems] = useState<EventItem[]>([]);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const token = getAccessToken();
    if (!token) { setNotice('Etkinliklerini görmek için giriş yapmalısın.'); return; }
    void fetch(`${apiUrl}/api/v1/events/calendar/me`, { headers: { authorization: `Bearer ${token}` } })
      .then(async (response) => { if (!response.ok) throw new Error(); return response.json() as Promise<{ items: EventItem[] }>; })
      .then((page) => setItems(page.items))
      .catch(() => setNotice('Etkinliklerin şu an yüklenemedi.'));
  }, []);
  return <AppSidebar><section className="dashboard-stage"><div className="my-events-heading"><div><p className="auth-eyebrow">Etkinliklerim</p><h1 className="dashboard-title">Planların.</h1></div><Link className="my-events-create" href="/events/new">Etkinlik yarat <span>+</span></Link></div>{notice && <p className="form-note">{notice}</p>}{!notice && items.length === 0 && <p className="empty-state">Henüz yaklaşan etkinliğin yok.</p>}<div className="dashboard-list">{items.map((event) => <Link key={event.id} href={`/events/${event.id}`} className="dashboard-row"><span><strong>{event.title}</strong><small>{event.location.venueName ?? `${event.location.city} · ${event.location.district}`}</small></span><time>{new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.startsAt))}</time><em>{event.relationship === 'ORGANIZER' ? 'Organizatör' : 'Katılımcı'}</em></Link>)}</div></section></AppSidebar>;
}
