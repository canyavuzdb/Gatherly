export type RouteMode = 'WALKING' | 'CYCLING' | 'DRIVING';

export type RoutePoint = { latitude: number; longitude: number };

export type ResolveEventRoute = {
  mode: RouteMode;
  start: RoutePoint;
  end: RoutePoint;
};

export type EventRoutePath = {
  coordinates: Array<[longitude: number, latitude: number]>;
  distanceMeters: number;
  durationSeconds: number;
};

export interface EventRoutingModule {
  resolve(request: ResolveEventRoute): Promise<EventRoutePath | null>;
}
