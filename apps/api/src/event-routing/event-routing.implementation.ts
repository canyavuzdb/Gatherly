import type { EventRoutePath, EventRoutingModule, ResolveEventRoute } from './event-routing.interface';

type OpenRouteServiceResponse = {
  features?: Array<{
    geometry?: { type?: string; coordinates?: unknown };
    properties?: { summary?: { distance?: unknown; duration?: unknown } };
  }>;
};

export class OpenRouteServiceEventRoutingImplementation implements EventRoutingModule {
  constructor(private readonly apiKey: string | undefined) {}

  async resolve(request: ResolveEventRoute): Promise<EventRoutePath | null> {
    if (!this.apiKey) return null;

    let response: Response;
    try {
      response = await fetch(`https://api.heigit.org/openrouteservice/v2/directions/${profileFor(request.mode)}/geojson`, {
        method: 'POST',
        headers: { Authorization: this.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coordinates: [
            [request.start.longitude, request.start.latitude],
            [request.end.longitude, request.end.latitude],
          ],
        }),
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      return null;
    }
    if (!response.ok) return null;

    const payload = await response.json() as OpenRouteServiceResponse;
    const feature = payload.features?.[0];
    const coordinates = feature?.geometry?.coordinates;
    if (feature?.geometry?.type !== 'LineString' || !Array.isArray(coordinates)) return null;

    const line = coordinates.flatMap((point): Array<[number, number]> => {
      if (!Array.isArray(point) || typeof point[0] !== 'number' || typeof point[1] !== 'number') return [];
      return [[point[0], point[1]]];
    });
    const distanceMeters = feature.properties?.summary?.distance;
    const durationSeconds = feature.properties?.summary?.duration;
    if (line.length < 2 || typeof distanceMeters !== 'number' || typeof durationSeconds !== 'number') return null;
    return { coordinates: line, distanceMeters, durationSeconds };
  }
}

function profileFor(mode: ResolveEventRoute['mode']) {
  return { WALKING: 'foot-walking', CYCLING: 'cycling-regular', DRIVING: 'driving-car' }[mode];
}
