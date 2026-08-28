'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AppSidebar } from '../components/app-sidebar';
import { CityPicker } from '../components/city-picker';
import { apiUrl, getAccessToken } from '../../lib/api';

type EventCard = {
  id: string;
  title: string;
  startsAt: string;
  category: { id: string; name: string; isActive: boolean };
  location: { city: string; district: string; venueName: string | null };
  capacity: { kind: 'UNLIMITED' } | { kind: 'LIMITED'; capacity: number; confirmedCount: number; availableSeats: number };
  coverMediaAssetId?: string;
};

type DiscoveryPage = { items: EventCard[]; activeCategories: Array<{ id: string; name: string }> };

export default function DiscoverPage() {
  const [city, setCity] = useState('Istanbul');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [events, setEvents] = useState<EventCard[]>([]);
  const [categories, setCategories] = useState<DiscoveryPage['activeCategories']>([]);
  const [notice, setNotice] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  async function loadEvents(targetCity = city, targetCategory = categoryId) {
    setIsLoading(true);
    setNotice('');
    try {
      const accessToken = getAccessToken();
      const query = new URLSearchParams({ city: targetCity, limit: '50' });
      if (targetCategory) query.set('categoryId', targetCategory);
      const response = await fetch(`${apiUrl}/api/v1/events?${query.toString()}`, {
        headers: accessToken ? { authorization: `Bearer ${accessToken}` } : undefined,
      });
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

  useEffect(() => { void loadEvents('Istanbul', null); }, []);

  const days = useMemo(() => groupByDay(events), [events]);

  function selectCity(selectedCity: string) {
    setCity(selectedCity);
    void loadEvents(selectedCity, categoryId);
  }

  function selectCategory(selectedCategory: string | null) {
    setCategoryId(selectedCategory);
    void loadEvents(city, selectedCategory);
  }

  return (
    <AppSidebar>
      <section className="discover-stage">
        <header className="discover-header">
          <div><p className="auth-eyebrow">Keşfet</p><h1 className="discover-title">Şehirde buluş.</h1><p>Yaklaşan Public etkinlikler, en yakın saatten başlayarak tek akışta.</p></div>
          <CityPicker value={city} onValueChange={selectCity} isLoading={isLoading} />
        </header>
        <div className="discover-filters" aria-label="Etkinlik filtreleri">
          <div className="discover-category-strip" role="list" aria-label="Kategoriler">
            <button className={categoryId === null ? 'is-selected' : ''} type="button" onClick={() => selectCategory(null)} disabled={isLoading}>Tümü</button>
            {categories.map((category) => <button className={categoryId === category.id ? 'is-selected' : ''} type="button" onClick={() => selectCategory(category.id)} disabled={isLoading} key={category.id}>{category.name}</button>)}
          </div>
          <p>{isLoading ? 'Etkinlikler yenileniyor…' : `${events.length} yaklaşan etkinlik`}</p>
        </div>
        {notice && <p className="form-note" role="alert">{notice}</p>}
        {!isLoading && !notice && events.length === 0 && <p className="empty-state">Bu şehirde yaklaşan Public etkinlik bulunmuyor.</p>}
        <div className="discover-feed">
          {days.map((day) => <section className="discover-day" key={day.key}><h2>{formatDay(day.date)}</h2><div>{day.items.map((event) => <DiscoverEvent event={event} key={event.id} />)}</div></section>)}
        </div>
      </section>
    </AppSidebar>
  );
}

function DiscoverEvent({ event }: { event: EventCard }) {
  const location = event.location.venueName ?? `${event.location.city} · ${event.location.district}`;
  const capacity = event.capacity.kind === 'UNLIMITED' ? 'Katılım açık' : `${event.capacity.availableSeats} yer kaldı`;
  return <Link className="discover-event" href={`/events/${event.id}`}>
    <time>{formatTime(event.startsAt)}</time><i aria-hidden="true" /><span className="discover-event-copy"><small>{event.category.name}</small><strong>{event.title}</strong><em>{location} · {capacity}</em></span>
    {event.coverMediaAssetId && <img src={`${apiUrl}/api/v1/media/${event.coverMediaAssetId}`} alt="" onError={(image) => { image.currentTarget.style.display = 'none'; }} />}<b aria-hidden="true">↗</b>
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
