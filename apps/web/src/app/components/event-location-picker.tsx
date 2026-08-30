'use client';

import { useEffect, useRef, useState } from 'react';
import type { Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl';
import { authenticatedFetch, getAccessToken } from '../../lib/api';
import { cityLabel } from '../../lib/cities';

type Suggestion = { label: string; address: string; venueName: string | null; district?: string; latitude: number; longitude: number };
type Coordinates = { latitude: number | null; longitude: number | null };
type LocationSelection = Coordinates & Partial<Pick<Suggestion, 'address' | 'venueName' | 'district'>>;

export function EventLocationPicker({ city, value, onChange, label = 'Haritada konum' }: {
  city: string;
  value: Coordinates;
  onChange: (next: LocationSelection) => void;
  label?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<MapLibreMarker | null>(null);
  const onChangeRef = useRef(onChange);
  const reverseRequestRef = useRef(0);
  const [query, setQuery] = useState('');
  const [selectedQuery, setSelectedQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  useEffect(() => {
    if (!container.current) return;
    let disposed = false;
    void import('maplibre-gl').then(({ Map, Marker, NavigationControl, setWorkerUrl }) => {
      if (disposed || !container.current) return;
      setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');
      const map = new Map({
        container: container.current,
        style: process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? 'https://tiles.openfreemap.org/styles/liberty',
        center: [35.2433, 39.055],
        zoom: 5,
        attributionControl: false,
      });
      map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
      map.on('click', (event) => { void selectPoint(event.lngLat.lat, event.lngLat.lng); });
      mapRef.current = map;
      const marker = new Marker({ draggable: true, color: '#161616' });
      marker.on('dragend', () => {
        const next = marker.getLngLat();
        void selectPoint(next.lat, next.lng);
      });
      markerRef.current = marker;
    });
    return () => { disposed = true; markerRef.current?.remove(); mapRef.current?.remove(); markerRef.current = null; mapRef.current = null; };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !markerRef.current) return;
    if (value.latitude === null || value.longitude === null) {
      markerRef.current.remove();
      return;
    }
    const point: [number, number] = [value.longitude, value.latitude];
    markerRef.current.setLngLat(point).addTo(mapRef.current);
  }, [value.latitude, value.longitude]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2 || trimmed === selectedQuery) { setSuggestions([]); setSearchError(''); return; }
    const token = getAccessToken();
    if (!token) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsSearching(true); setSearchError('');
      try {
        const params = new URLSearchParams({ q: trimmed, city });
        const response = await authenticatedFetch(`/api/v1/locations/search?${params}`, { signal: controller.signal });
        if (!response.ok) throw new Error('Mekân araması şu anda yapılamadı.');
        const payload = await response.json() as { items?: Suggestion[] };
        setSuggestions(payload.items ?? []);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setSuggestions([]); setSearchError(error instanceof Error ? error.message : 'Mekân araması şu anda yapılamadı.');
      } finally { if (!controller.signal.aborted) setIsSearching(false); }
    }, 280);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [city, query, selectedQuery]);

  function choose(suggestion: Suggestion) {
    setQuery(suggestion.label); setSelectedQuery(suggestion.label); setSuggestions([]); setSearchError('');
    onChange({ latitude: suggestion.latitude, longitude: suggestion.longitude, address: suggestion.address, venueName: suggestion.venueName, district: suggestion.district });
    mapRef.current?.flyTo({ center: [suggestion.longitude, suggestion.latitude], zoom: 15, essential: true });
  }

  async function selectPoint(latitude: number, longitude: number) {
    onChangeRef.current({ latitude, longitude });
    const requestId = ++reverseRequestRef.current;
    const token = getAccessToken();
    if (!token) return;
    try {
      const params = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude) });
      const response = await authenticatedFetch(`/api/v1/locations/reverse?${params}`);
      if (!response.ok) return;
      const details = await response.json() as Omit<LocationSelection, 'latitude' | 'longitude'>;
      if (requestId === reverseRequestRef.current) onChangeRef.current({ latitude, longitude, ...details });
    } catch {
      // Selecting a map point remains usable even when reverse geocoding is unavailable.
    }
  }

  function clearLocation() {
    setQuery(''); setSelectedQuery(''); setSuggestions([]); setSearchError('');
    onChange({ latitude: null, longitude: null });
  }

  const hasPoint = value.latitude !== null && value.longitude !== null;
  return <section className="event-location-picker" aria-label="Harita konumu">
    <div className="event-location-picker-heading"><div><span className="field-label">{label} <small>İsteğe bağlı</small></span><p>Mekânı ara, sonucu seç; gerekirse pini haritada sürükleyerek düzelt.</p></div>{hasPoint && <button type="button" className="event-location-clear" onClick={clearLocation}>Konumu kaldır</button>}</div>
    <label className="event-location-search"><span className="sr-only">{cityLabel(city)} içinde mekân veya adres ara</span><input className="field-input" value={query} onChange={(event) => { setSelectedQuery(''); setQuery(event.target.value); }} placeholder={`${cityLabel(city)} içinde mekân veya adres ara`} autoComplete="off" />{isSearching && <span>Aranıyor…</span>}</label>
    {(suggestions.length > 0 || searchError) && <div className="event-location-results" role="listbox">{suggestions.map((suggestion) => <button type="button" key={`${suggestion.longitude}-${suggestion.latitude}-${suggestion.label}`} onClick={() => choose(suggestion)}><strong>{suggestion.venueName ?? suggestion.label}</strong><small>{suggestion.address}</small></button>)}{searchError && <p role="alert">{searchError}</p>}</div>}
    <div className="event-location-map-shell"><div className="event-location-map" ref={container} /> <div className="event-location-map-note">{hasPoint ? 'Pin seçildi · sürükleyerek veya haritaya tıklayarak güncelle.' : 'Haritaya tıklayarak da bir konum seçebilirsin.'}</div><small>© OpenFreeMap · © OpenStreetMap katkıda bulunanlar</small></div>
  </section>;
}
