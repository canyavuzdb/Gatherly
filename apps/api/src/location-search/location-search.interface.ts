import type { UserIdentity } from '../auth/auth.interface';

export type LocationSearchRequest = {
  actor: UserIdentity;
  query: string;
  city: string;
};

export type LocationSuggestion = {
  label: string;
  address: string;
  venueName: string | null;
  latitude: number;
  longitude: number;
};

export interface LocationSearchModule {
  search(request: LocationSearchRequest): Promise<{ items: LocationSuggestion[] }>;
}
