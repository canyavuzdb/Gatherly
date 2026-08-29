'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { apiUrl } from '../../lib/api';
import { CityPicker } from '../components/city-picker';
import { categoryToneClass } from '../lib/category-tone';

export type CalendarEvent = {
  id: string;
  title: string;
  startsAt: string;
  category: { id: string; name: string; isActive: boolean };
  location: { city: string; district: string; venueName: string | null };
  capacity: { kind: 'UNLIMITED' } | { kind: 'LIMITED'; capacity: number; confirmedCount: number; availableSeats: number };
  coverMediaAssetId?: string;
  ownAttendanceStatus?: 'PENDING' | 'CONFIRMED' | 'WAITLISTED' | 'REJECTED' | 'CANCELLED';
};

type Props = { events: CalendarEvent[]; city: string; onCitySelect: (city: string) => void; isGuest: boolean; isLoading: boolean };

export function CalendarFlow({ events, city, onCitySelect, isGuest, isLoading }: Props) {
  const days = useMemo(() => buildDays(events), [events]);
  const [selectedDayKey, setSelectedDayKey] = useState(days[0]?.key ?? '');
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const selectedDay = days.find((day) => day.key === selectedDayKey) ?? days[0];
  const dayEvents = events.filter((event) => dateKey(event.startsAt) === selectedDay?.key);

  return <section className="calendar-flow">
    <header className="calendar-flow-header">
      <div>
        <p className="auth-eyebrow">{isGuest ? 'MİSAFİR TAKVİMİ' : 'ŞEHİR TAKVİMİ'}</p>
        <h1 className="dashboard-title">Şehirde neler var?</h1>
      </div>
      <CityPicker value={city} onValueChange={onCitySelect} isLoading={isLoading} />
    </header>

    <section className="calendar-selection-layout">
      <nav className="calendar-day-scroller" aria-label="Takvim günleri">{days.map((day, dayIndex) => <button type="button" className={day.key === selectedDay?.key ? 'is-selected' : ''} onClick={() => setSelectedDayKey(day.key)} key={day.key}><small>{dayIndex === 0 ? 'BUGÜN' : day.label}</small><strong>{formatContextDate(day.date)}</strong><span>{day.count ? `${day.count} plan` : 'Boş'}</span></button>)}</nav>
      <div className="calendar-selected-day">
        <p>{selectedDay ? formatLongDate(selectedDay.date) : 'Bugün'}</p>
        {dayEvents.length > 0 ? <div className="calendar-stream-axis">{dayEvents.map((event, index) => <button className="calendar-stream-event" type="button" key={event.id} onClick={() => setSelectedEvent(event)}>
        <time>{formatTime(event.startsAt)}</time><i className={categoryToneClass(event.category.name)} aria-hidden="true" /><span className="calendar-stream-content">{event.coverMediaAssetId && <img className="calendar-stream-cover" src={mediaUrl(event.coverMediaAssetId)} alt="" onError={(image) => { image.currentTarget.style.display = 'none'; }} />}<span className="calendar-stream-copy"><small>{event.ownAttendanceStatus === 'CONFIRMED' ? 'KATILIYORSUN' : index === 0 ? 'YAKLAŞAN' : event.category.name}</small><strong>{event.title}</strong><em>{event.location.venueName ?? `${event.location.city} · ${event.location.district}`} · {formatAttendance(event.capacity)}</em></span></span><b aria-hidden="true">↗</b>
        </button>)}</div> : <div className="calendar-selection-empty"><strong>Bu gün boş.</strong><span>Başka günleri kaydırarak göz atabilir ya da yeni bir etkinlik keşfedebilirsin.</span><Link href="/discover">Etkinlik keşfet →</Link></div>}
      </div>
    </section>

    {selectedEvent && <EventPreview event={selectedEvent} onClose={() => setSelectedEvent(null)} />}
  </section>;
}

function EventPreview({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
  const eventUrl = event.id.startsWith('prototype') ? '/discover' : `/events/${event.id}`;
  return <div className="event-preview-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="event-preview" role="dialog" aria-modal="true" aria-labelledby="event-preview-title" onMouseDown={(event) => event.stopPropagation()}>
      <button className="event-preview-close" type="button" onClick={onClose} aria-label="Detayı kapat">×</button>
      {event.coverMediaAssetId && <img className="event-preview-cover" src={mediaUrl(event.coverMediaAssetId)} alt={`${event.title} kapak görseli`} onError={(image) => { image.currentTarget.style.display = 'none'; }} />}
      <p>{event.ownAttendanceStatus === 'CONFIRMED' ? 'KATILDIĞIN ETKİNLİK' : 'ETKİNLİK DETAYI'}</p>
      <h2 id="event-preview-title">{event.title}</h2>
      <dl><div><dt>Tarih</dt><dd>{formatLongDate(new Date(event.startsAt))}</dd></div><div><dt>Saat</dt><dd>{formatTime(event.startsAt)}</dd></div><div><dt>Konum</dt><dd>{event.location.venueName ?? `${event.location.city} · ${event.location.district}`}</dd></div><div><dt>Katılım</dt><dd>{formatAttendance(event.capacity)}</dd></div></dl>
      <Link href={eventUrl}>Tüm ayrıntıyı aç <span>→</span></Link>
    </section>
  </div>;
}

function buildDays(events: CalendarEvent[]) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return Array.from({ length: 90 }, (_, offset) => {
    const date = new Date(start);
    date.setDate(date.getDate() + offset);
    const key = dateKey(date.toISOString());
    return { date, key, label: offset === 0 ? 'BUGÜN' : new Intl.DateTimeFormat('tr-TR', { weekday: 'short' }).format(date), count: events.filter((event) => dateKey(event.startsAt) === key).length };
  });
}

function dateKey(value: string) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date(value)); }
function formatTime(value: string) { return new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
function formatLongDate(value: Date) { return new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' }).format(value); }
function formatContextDate(value: Date) { return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long' }).format(value); }
function formatAttendance(capacity: CalendarEvent['capacity']) { return capacity.kind === 'UNLIMITED' ? 'Katılım açık' : `${capacity.confirmedCount} kişi katılıyor · ${capacity.availableSeats} yer kaldı`; }
function mediaUrl(mediaAssetId: string) { return `${apiUrl}/api/v1/media/${mediaAssetId}`; }
