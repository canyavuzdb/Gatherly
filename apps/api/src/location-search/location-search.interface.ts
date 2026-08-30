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
  district?: string;
  latitude: number;
  longitude: number;
};

export type ReverseLocationRequest = {
  actor: UserIdentity;
  latitude: number;
  longitude: number;
};

export type ReverseLocation = {
  address?: string;
  venueName?: string | null;
  district?: string;
};

export interface LocationSearchModule {
  search(request: LocationSearchRequest): Promise<{ items: LocationSuggestion[] }>;
  reverse(request: ReverseLocationRequest): Promise<ReverseLocation>;
}
