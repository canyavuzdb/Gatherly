'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AppSidebar } from '../components/app-sidebar';
import { CityPicker } from '../components/city-picker';
import { EventMap } from '../components/event-map';
import { apiUrl, authenticatedFetch } from '../../lib/api';
import { categoryToneClass } from '../lib/category-tone';
import { routeSummaryLabel, type RouteSummary } from '../lib/route-summary';

type EventCard = {
  id: string;
  title: string;
  startsAt: string;
  status: 'PUBLISHED' | 'CANCELLED' | 'COMPLETED';
  category: { id: string; name: string; isActive: boolean };
  location: { city: string; district: string; venueName: string | null };
  capacity: { kind: 'UNLIMITED' } | { kind: 'LIMITED'; capacity: number; confirmedCount: number; availableSeats: number };
  coverMediaAssetId?: string;
  route?: RouteSummary;
  mapLocation?: { latitude: number; longitude: number };
};

type DiscoveryPage = { items: EventCard[]; activeCategories: Array<{ id: string; name: string }> };
type Scope = 'UPCOMING' | 'LIVE' | 'PAST';
type ViewMode = 'FEED' | 'MAP';

export default function DiscoverPage() {
  const [city, setCity] = useState('Istanbul');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>('UPCOMING');
  const [viewMode, setViewMode] = useState<ViewMode>('FEED');
  const [selectedMapEventId, setSelectedMapEventId] = useState<string | null>(null);
  const [events, setEvents] = useState<EventCard[]>([]);
  const [categories, setCategories] = useState<DiscoveryPage['activeCategories']>([]);
  const [notice, setNotice] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  async function loadEvents(targetCity = city, targetCategory = categoryId, targetScope = scope) {
    setIsLoading(true);
    setNotice('');
    try {
      const query = new URLSearchParams({ city: targetCity, scope: targetScope, limit: '50' });
      if (targetCategory) query.set('categoryId', targetCategory);
      const response = await authenticatedFetch(`/api/v1/events?${query.toString()}`);
      if (!response.ok) throw new Error('Etkinlikler şu an yüklenemedi.');
      const page = await response.json() as DiscoveryPage;
      setEvents(page.items);
      setCategories(page.activeCategories);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Etkinlikler yüklenemedi.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void loadEvents('Istanbul', null, 'UPCOMING'); }, []);

  const days = useMemo(() => groupByDay(events), [events]);
  const selectedMapEvent = events.find((event) => event.id === selectedMapEventId);

  function selectCity(selectedCity: string) {
    setCity(selectedCity);
    void loadEvents(selectedCity, categoryId);
  }

  function selectCategory(selectedCategory: string | null) {
    setCategoryId(selectedCategory);
    void loadEvents(city, selectedCategory);
  }

  function selectScope(selectedScope: Scope) {
    setScope(selectedScope);
    void loadEvents(city, categoryId, selectedScope);
  }

  return (
    <AppSidebar>
      <section className="discover-stage">
        <header className="discover-header">
          <div><p className="auth-eyebrow">Keşfet</p><h1 className="discover-title">Şehirde buluş.</h1><p>{scope === 'UPCOMING' ? 'Yaklaşan Public etkinlikler, en yakın saatten başlayarak tek akışta.' : scope === 'LIVE' ? 'Şu anda devam eden Public etkinlikler.' : 'Şehirde daha önce gerçekleşmiş Public etkinlikler.'}</p></div>
          <CityPicker value={city} onValueChange={selectCity} isLoading={isLoading} />
        </header>
        <div className="discover-filters" aria-label="Etkinlik filtreleri">
          <ScopePicker scope={scope} count={events.length} isLoading={isLoading} onSelect={selectScope} />
          <div className="discover-filter-actions"><label className="discover-category-select"><span>Kategori</span><select value={categoryId ?? ''} onChange={(event) => selectCategory(event.target.value || null)} disabled={isLoading}><option value="">Tüm kategoriler</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label><button className="discover-map-toggle" type="button" aria-pressed={viewMode === 'MAP'} onClick={() => setViewMode(viewMode === 'FEED' ? 'MAP' : 'FEED')}>{viewMode === 'MAP' ? 'Akışa dön' : 'Haritada gör'} <span aria-hidden="true">{viewMode === 'MAP' ? '→' : '↗'}</span></button></div>
        </div>
        {notice && <p className="form-note" role="alert">{notice}</p>}
        {!isLoading && !notice && events.length === 0 && <p className="empty-state">Bu şehirde {scope === 'UPCOMING' ? 'yaklaşan' : scope === 'LIVE' ? 'devam eden' : 'geçmiş'} Public etkinlik bulunmuyor.</p>}
        {viewMode === 'MAP' ? <div className="discover-map-view"><EventMap events={events} onEventSelect={setSelectedMapEventId} />{selectedMapEvent && <DiscoverEvent event={selectedMapEvent} />}</div> : <div className="discover-feed">
          {days.map((day) => <section className="discover-day" key={day.key}><h2>{formatDay(day.date)}</h2><div>{day.items.map((event) => <DiscoverEvent event={event} key={event.id} />)}</div></section>)}
        </div>}
      </section>
    </AppSidebar>
  );
}

function ScopePicker({ scope, count, isLoading, onSelect }: { scope: Scope; count: number; isLoading: boolean; onSelect: (scope: Scope) => void }) {
  return <div className="content-scope" role="tablist" aria-label="Etkinlik zaman aralığı"><button className={scope === 'UPCOMING' ? 'is-active' : ''} type="button" role="tab" aria-selected={scope === 'UPCOMING'} onClick={() => onSelect('UPCOMING')} disabled={isLoading}>Yaklaşan{scope === 'UPCOMING' && <small>{count}</small>}</button><button className={scope === 'LIVE' ? 'is-active' : ''} type="button" role="tab" aria-selected={scope === 'LIVE'} onClick={() => onSelect('LIVE')} disabled={isLoading}>Devam ediyor{scope === 'LIVE' && <small>{count}</small>}</button><button className={scope === 'PAST' ? 'is-active' : ''} type="button" role="tab" aria-selected={scope === 'PAST'} onClick={() => onSelect('PAST')} disabled={isLoading}>Geçmiş{scope === 'PAST' && <small>{count}</small>}</button></div>;
}

function DiscoverEvent({ event }: { event: EventCard }) {
  const location = event.location.venueName ?? `${event.location.city} · ${event.location.district}`;
  const capacity = event.capacity.kind === 'UNLIMITED' ? 'Katılım açık' : `${event.capacity.availableSeats} yer kaldı`;
  const routeSummary = routeSummaryLabel(event.route);
  return <Link className={event.status === 'CANCELLED' ? 'discover-event is-cancelled' : 'discover-event'} href={`/events/${event.id}`}>
    <time>{formatTime(event.startsAt)}</time><i className={categoryToneClass(event.category.name)} aria-hidden="true" /><span className="discover-event-content">{event.coverMediaAssetId && <img src={`${apiUrl}/api/v1/media/${event.coverMediaAssetId}`} alt="" onError={(image) => { image.currentTarget.style.display = 'none'; }} />}<span className="discover-event-copy"><small>{event.status === 'CANCELLED' ? 'İPTAL EDİLDİ' : event.category.name}</small><strong>{event.title}</strong><em>{location} · {event.status === 'CANCELLED' ? 'İptal edildi' : capacity}</em>{routeSummary && <span className="event-route-summary">↗ {routeSummary}</span>}</span></span><b aria-hidden="true">↗</b>
  </Link>;
}

function groupByDay(events: EventCard[]) {
  const groups = new Map<string, { key: string; date: Date; items: EventCard[] }>();
  for (const event of events) {
    const date = new Date(event.startsAt);
    const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(date);
    const group = groups.get(key) ?? { key, date, items: [] };
    group.items.push(event);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function formatDay(value: Date) { return new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' }).format(value); }
function formatTime(value: string) { return new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
