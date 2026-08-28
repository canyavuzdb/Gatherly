'use client';

import { useEffect, useState } from 'react';
import { AppSidebar } from '../components/app-sidebar';
import { apiUrl, getAccessToken } from '../../lib/api';
import { CalendarFlow, type CalendarEvent } from './calendar-flow';

export default function CalendarPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [city, setCity] = useState('Istanbul');
  const [notice, setNotice] = useState('');
  const [isGuest, setIsGuest] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  async function load(targetCity = city) {
    setIsLoading(true);
    setNotice('');
    const accessToken = getAccessToken();
    setIsGuest(!accessToken);
    try {
      const response = await fetch(`${apiUrl}/api/v1/events?city=${encodeURIComponent(targetCity)}&limit=50`, {
        headers: accessToken ? { authorization: `Bearer ${accessToken}` } : undefined,
      });
      if (!response.ok) throw new Error('Şehir takvimi şu an yüklenemedi.');
      const page = await response.json() as { items: CalendarEvent[] };
      setEvents(page.items);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Şehir takvimi yüklenemedi.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void load('Istanbul'); }, []);

  return <AppSidebar>
    {notice ? <p className="form-note" role="alert">{notice}</p> : <CalendarFlow events={events} city={city} onCitySelect={(selectedCity) => { setCity(selectedCity); void load(selectedCity); }} isGuest={isGuest} isLoading={isLoading} />}
  </AppSidebar>;
}
