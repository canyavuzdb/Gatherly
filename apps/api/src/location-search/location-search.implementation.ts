import type { LocationSearchModule, LocationSearchRequest, LocationSuggestion } from './location-search.interface';

type MapTilerFeature = {
  geometry?: { coordinates?: unknown };
  place_name?: string;
  text?: string;
  properties?: { address?: string };
};

type MapTilerResponse = { features?: MapTilerFeature[] };

export class MapTilerLocationSearchImplementation implements LocationSearchModule {
  constructor(private readonly apiKey: string | undefined) {}

  async search(request: LocationSearchRequest): Promise<{ items: LocationSuggestion[] }> {
    if (!this.apiKey) throw new LocationSearchBusinessError('LOCATION_SEARCH_UNAVAILABLE');

    const url = new URL(`https://api.maptiler.com/geocoding/${encodeURIComponent(`${request.query}, ${request.city}, Türkiye`)}.json`);
    url.searchParams.set('key', this.apiKey);
    url.searchParams.set('language', 'tr');
    url.searchParams.set('country', 'tr');
    url.searchParams.set('limit', '6');

    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(6_000) });
    } catch {
      throw new LocationSearchBusinessError('LOCATION_SEARCH_UNAVAILABLE');
    }
    if (!response.ok) throw new LocationSearchBusinessError('LOCATION_SEARCH_UNAVAILABLE');

    const payload = await response.json() as MapTilerResponse;
    const items = (payload.features ?? []).flatMap((feature): LocationSuggestion[] => {
      const coordinates = feature.geometry?.coordinates;
      if (!Array.isArray(coordinates) || typeof coordinates[0] !== 'number' || typeof coordinates[1] !== 'number') return [];
      const label = feature.place_name?.trim() || feature.text?.trim();
      if (!label) return [];
      return [{
        label,
        address: feature.place_name?.trim() || feature.properties?.address?.trim() || label,
        venueName: feature.text?.trim() || null,
        longitude: coordinates[0],
        latitude: coordinates[1],
      }];
    });
    return { items };
  }
}

export class LocationSearchBusinessError extends Error {
  constructor(readonly code: 'LOCATION_SEARCH_UNAVAILABLE') {
    super(code);
  }
}
