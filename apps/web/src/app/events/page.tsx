'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AppSidebar } from '../components/app-sidebar';
import { authenticatedFetch, getAccessToken } from '../../lib/api';

type Scope = 'UPCOMING' | 'PAST';
type EventItem = { id: string; title: string; startsAt: string; status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED' | 'COMPLETED'; relationship: 'ORGANIZER' | 'ATTENDEE'; location: { city: string; district: string; venueName: string | null } };

export default function MyEventsPage() {
  const [items, setItems] = useState<EventItem[]>([]);
  const [notice, setNotice] = useState('');
  const [scope, setScope] = useState<Scope>('UPCOMING');
  const [isLoading, setIsLoading] = useState(true);
  const loadEvents = useCallback(async () => {
    const token = getAccessToken();
    if (!token) { setNotice('Etkinliklerini görmek için giriş yapmalısın.'); setIsLoading(false); return; }
    setIsLoading(true); setNotice('');
    try {
      const response = await authenticatedFetch(`/api/v1/events/calendar/me?scope=${scope}`);
      if (!response.ok) throw new Error();
      setItems((await response.json() as { items: EventItem[] }).items);
    } catch { setNotice('Etkinliklerin şu an yüklenemedi.'); }
    finally { setIsLoading(false); }
  }, [scope]);
  useEffect(() => { void loadEvents(); }, [loadEvents]);
  return <AppSidebar><section className="dashboard-stage"><div className="my-events-heading"><div><p className="auth-eyebrow">Etkinliklerim</p><h1 className="dashboard-title">Planların.</h1><div className="content-scope" role="tablist" aria-label="Etkinlik zaman aralığı"><button className={scope === 'UPCOMING' ? 'is-active' : ''} type="button" role="tab" aria-selected={scope === 'UPCOMING'} onClick={() => setScope('UPCOMING')}>Yaklaşan</button><button className={scope === 'PAST' ? 'is-active' : ''} type="button" role="tab" aria-selected={scope === 'PAST'} onClick={() => setScope('PAST')}>Geçmiş</button></div></div><Link className="my-events-create" href="/events/new">Etkinlik yarat <span>+</span></Link></div>{notice && <p className="form-note">{notice}</p>}{!notice && !isLoading && items.length === 0 && <p className="empty-state">{scope === 'UPCOMING' ? 'Henüz yaklaşan etkinliğin yok.' : 'Henüz geçmiş etkinliğin yok.'}</p>}{isLoading ? <p className="empty-state">Etkinliklerin yükleniyor…</p> : <div className="dashboard-list">{items.map((event) => <Link key={event.id} href={`/events/${event.id}`} className={event.status === 'CANCELLED' ? 'dashboard-row is-cancelled' : 'dashboard-row'}><span><strong>{event.title}</strong><small>{event.location.venueName ?? `${event.location.city} · ${event.location.district}`}</small></span><time>{new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.startsAt))}</time><em>{scope === 'PAST' ? event.status === 'COMPLETED' ? 'Tamamlandı' : event.status === 'CANCELLED' ? 'İptal edildi' : 'Geçmiş etkinlik' : event.status === 'CANCELLED' ? 'İptal edildi' : event.relationship === 'ORGANIZER' ? 'Organizatör' : 'Katılımcı'}</em></Link>)}</div>}</section></AppSidebar>;
}
