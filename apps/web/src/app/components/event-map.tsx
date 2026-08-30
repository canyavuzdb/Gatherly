'use client';

import { useEffect, useRef } from 'react';
import type { Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl';
import { categoryToneClass } from '../lib/category-tone';

export type MappableEvent = { id: string; title: string; category: { name: string }; mapLocation?: { latitude: number; longitude: number } };

export function EventMap({ events, onEventSelect }: { events: MappableEvent[]; onEventSelect: (eventId: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const mappableEvents = events.filter((event): event is MappableEvent & { mapLocation: { latitude: number; longitude: number } } => Boolean(event.mapLocation));

  useEffect(() => {
    if (!container.current) return;
    let map: MapLibreMap | undefined;
    const markers: MapLibreMarker[] = [];
    let disposed = false;
    void import('maplibre-gl').then(({ Map, Marker, NavigationControl, LngLatBounds, setWorkerUrl }) => {
      if (disposed || !container.current) return;
      setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');
      const first = mappableEvents[0]?.mapLocation ?? { longitude: 28.9784, latitude: 41.0082 };
      map = new Map({ container: container.current, style: process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? 'https://tiles.openfreemap.org/styles/liberty', center: [first.longitude, first.latitude], zoom: mappableEvents.length > 1 ? 11 : 13, attributionControl: false });
      map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
      const bounds = new LngLatBounds();
      for (const event of mappableEvents) {
        const markerElement = document.createElement('button');
        markerElement.type = 'button';
        markerElement.className = `event-map-marker ${categoryToneClass(event.category.name)}`;
        markerElement.setAttribute('aria-label', `${event.title} etkinliğini aç`);
        markerElement.addEventListener('click', () => onEventSelect(event.id));
        markers.push(new Marker({ element: markerElement, anchor: 'center' }).setLngLat([event.mapLocation.longitude, event.mapLocation.latitude]).addTo(map));
        bounds.extend([event.mapLocation.longitude, event.mapLocation.latitude]);
      }
      if (mappableEvents.length > 1) map.fitBounds(bounds, { padding: 68, maxZoom: 13, duration: 0 });
    });
    return () => { disposed = true; markers.forEach((marker) => marker.remove()); map?.remove(); };
  }, [mappableEvents, onEventSelect]);

  return <div className="event-map-shell"><div className="event-map" ref={container} />{mappableEvents.length === 0 && <p className="event-map-empty">Bu filtrede haritada gösterilebilecek konum yok.</p>}<small>© OpenFreeMap · © OpenStreetMap katkıda bulunanlar</small></div>;
}
