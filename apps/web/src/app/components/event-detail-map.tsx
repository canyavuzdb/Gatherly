'use client';

import { useEffect, useRef } from 'react';
import type { Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl';

type EventRoute = {
  mode: 'WALKING' | 'CYCLING' | 'DRIVING';
  end: { latitude: number; longitude: number };
  geometry?: Array<[longitude: number, latitude: number]>;
  distanceMeters?: number;
  durationSeconds?: number;
};

export function EventDetailMap({ latitude, longitude, title, route }: { latitude: number; longitude: number; title: string; route?: EventRoute }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return;
    let map: MapLibreMap | null = null;
    let marker: MapLibreMarker | null = null;
    let disposed = false;
    void import('maplibre-gl').then(({ Map, Marker, NavigationControl, LngLatBounds, setWorkerUrl }) => {
      if (disposed || !container.current) return;
      setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');
      map = new Map({
        container: container.current,
        style: process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? 'https://tiles.openfreemap.org/styles/liberty',
        center: [longitude, latitude],
        zoom: 14,
        attributionControl: false,
      });
      map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
      marker = new Marker({ color: '#161616' }).setLngLat([longitude, latitude]).addTo(map);
      if (route) {
        new Marker({ color: '#6b7280' }).setLngLat([route.end.longitude, route.end.latitude]).addTo(map);
        map.once('load', () => {
          if (!map) return;
          const bounds = new LngLatBounds();
          const routeCoordinates: Array<[number, number]> = route.geometry?.length
            ? route.geometry
            : [[longitude, latitude], [route.end.longitude, route.end.latitude]];
          for (const coordinate of routeCoordinates) bounds.extend(coordinate);
          if (route.geometry?.length) {
            map.addSource('event-route', {
              type: 'geojson',
              data: {
                type: 'Feature',
                properties: {},
                geometry: { type: 'LineString', coordinates: route.geometry },
              },
            });
            map.addLayer({
              id: 'event-route-line',
              type: 'line',
              source: 'event-route',
              paint: { 'line-color': '#161616', 'line-width': 4, 'line-opacity': 0.88 },
            });
          }
          map.fitBounds(bounds, { padding: 54, maxZoom: 14, duration: 0 });
        });
      }
    });
    return () => { disposed = true; marker?.remove(); map?.remove(); };
  }, [latitude, longitude, route]);

  const routeSummary = route?.geometry?.length && route.distanceMeters !== undefined && route.durationSeconds !== undefined
    ? `${formatDistance(route.distanceMeters)} · yaklaşık ${formatDuration(route.durationSeconds)}`
    : route ? 'Güzergâh şu anda oluşturulamadı; başlangıç ve bitiş noktaları gösteriliyor.' : title;
  return <section className="event-detail-location" aria-labelledby="event-location-title"><div><p className="auth-eyebrow">{route?.geometry?.length ? 'Rota' : route ? 'Başlangıç ve bitiş' : 'Konum'}</p><h2 id="event-location-title">{route ? `${routeModeLabel(route.mode)} rotası` : 'Buluşma noktası'}</h2><span>{routeSummary}</span></div><div className="event-detail-map-shell"><div className="event-detail-map" ref={container} /><small>© OpenFreeMap · © OpenStreetMap katkıda bulunanlar</small></div></section>;
}

function routeModeLabel(mode: 'WALKING' | 'CYCLING' | 'DRIVING') { return { WALKING: 'Yürüyüş', CYCLING: 'Bisiklet', DRIVING: 'Araç' }[mode]; }
function formatDistance(meters: number) { return meters >= 1_000 ? `${(meters / 1_000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} km` : `${Math.round(meters)} m`; }
function formatDuration(seconds: number) { const minutes = Math.max(1, Math.round(seconds / 60)); return minutes >= 60 ? `${Math.floor(minutes / 60)} sa ${minutes % 60 ? `${minutes % 60} dk` : ''}`.trim() : `${minutes} dk`; }
