import type { UserIdentity } from '../auth/auth.interface';
export type Viewer = UserIdentity | null;
export type DiscoverEvents = { viewer: Viewer; city: string; district?: string; categoryId?: string; startsAtFrom?: Date; startsAtBefore?: Date; after?: string; limit?: number };
export type CapacityView = { kind: 'UNLIMITED' } | { kind: 'LIMITED'; capacity: number; confirmedCount: number; availableSeats: number };
export type EventCard = { id: string; title: string; startsAt: Date; endsAt: Date; timezone: string; status: 'PUBLISHED' | 'CANCELLED' | 'COMPLETED'; category: { id: string; name: string; isActive: boolean }; location: { city: string; district: string; venueName: string | null }; capacity: CapacityView; coverMediaAssetId?: string; ownAttendanceStatus?: 'PENDING' | 'CONFIRMED' | 'WAITLISTED' | 'REJECTED' | 'CANCELLED' };
export type EventPage = { items: EventCard[]; nextCursor?: string; activeCategories: Array<{ id: string; name: string }> };
export type OpenEvent = { viewer: Viewer; eventId: string; shareToken?: string };
export type EventParticipantPreview = { kind: 'VISIBLE'; userId: string; name: string; initials: string; avatarMediaAssetId?: string } | { kind: 'ANONYMOUS'; initials: string };
export type EventDetail = Omit<EventCard, 'status'> & { status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED' | 'COMPLETED'; description: string; visibility: 'PUBLIC' | 'UNLISTED' | 'PRIVATE'; joinPolicy: 'OPEN' | 'APPROVAL_REQUIRED' | 'INVITE_ONLY'; invitationId?: string; location: EventCard['location'] & { address: string | null }; galleryMediaAssetIds: string[]; organizerPreview: EventParticipantPreview; participantPreview?: EventParticipantPreview[]; participantRoster?: Array<{ userId: string; name: string; initials: string; avatarMediaAssetId?: string }>; isOrganizer: boolean; canManageMedia: boolean; joinAvailable: boolean };
export type PersonalCalendar = { actor: UserIdentity; scope?: 'UPCOMING' | 'PAST'; after?: string; limit?: number };
export type CalendarEventCard = Omit<EventCard, 'status'> & { status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED' | 'COMPLETED'; relationship: 'ORGANIZER' | 'ATTENDEE' };
export type CalendarPage = { items: CalendarEventCard[]; nextCursor?: string };
export interface EventDiscoveryModule { discover(request: DiscoverEvents): Promise<EventPage>; open(request: OpenEvent): Promise<EventDetail>; personalCalendar(request: PersonalCalendar): Promise<CalendarPage>; }
