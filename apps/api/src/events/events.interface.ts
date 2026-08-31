import type { UserId } from '../auth/auth.interface';

export type EventId = string;
export type CategoryId = string;

export type EventLocationInput = {
  city: string;
  district: string;
  venueName: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  routeMode: 'NONE' | 'WALKING' | 'CYCLING' | 'DRIVING';
  routeEndLatitude: number | null;
  routeEndLongitude: number | null;
  addressVisibility: 'EVENT_VIEWERS' | 'CONFIRMED_ATTENDEES';
};

export type CompleteEventDefinition = {
  categoryId: CategoryId;
  title: string;
  description: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  capacity: number | null;
  visibility: 'PUBLIC' | 'UNLISTED' | 'PRIVATE';
  joinPolicy: 'OPEN' | 'APPROVAL_REQUIRED' | 'INVITE_ONLY';
  location: EventLocationInput;
};

export type CreateDraft = {
  kind: 'CREATE_DRAFT';
  eventId: EventId;
  actorUserId: UserId;
  definition: CompleteEventDefinition;
};

export type ReviseEvent = {
  kind: 'REVISE_EVENT';
  eventId: EventId;
  actorUserId: UserId;
  expectedVersion: number;
  definition: CompleteEventDefinition;
};

export type PublishEvent = {
  kind: 'PUBLISH_EVENT';
  eventId: EventId;
  actorUserId: UserId;
  expectedVersion: number;
};

export type CancelEvent = {
  kind: 'CANCEL_EVENT';
  eventId: EventId;
  actorUserId: UserId;
  expectedVersion: number;
};

export type RequestOrganizerTransfer = {
  kind: 'REQUEST_ORGANIZER_TRANSFER';
  eventId: EventId;
  actorUserId: UserId;
  recipientUserId: UserId;
};

export type RespondToOrganizerTransfer = {
  kind: 'RESPOND_TO_ORGANIZER_TRANSFER';
  transferId: string;
  actorUserId: UserId;
  response: 'ACCEPT' | 'DECLINE';
};

export type CompleteDueEvents = { kind: 'COMPLETE_DUE_EVENTS' };

export type EventCommand = CreateDraft | ReviseEvent | PublishEvent | CancelEvent | RequestOrganizerTransfer | RespondToOrganizerTransfer | CompleteDueEvents;

export type EventSnapshot = CompleteEventDefinition & {
  id: EventId;
  organizerId: UserId;
  confirmedCount: number;
  status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED' | 'COMPLETED';
  shareToken: string | null;
  version: number;
  location: EventLocationInput;
};

export type CapacitySnapshot = {
  capacity: number | null;
  confirmedCount: number;
  availableCount: number | null;
};

export type DraftCreated = {
  kind: 'DRAFT_CREATED';
  event: EventSnapshot;
  capacity: CapacitySnapshot;
};

export type EventRevised = {
  kind: 'EVENT_REVISED';
  event: EventSnapshot;
  capacity: CapacitySnapshot;
};

export type EventPublished = {
  kind: 'EVENT_PUBLISHED';
  event: EventSnapshot;
  capacity: CapacitySnapshot;
};

export type EventCancelled = {
  kind: 'EVENT_CANCELLED';
  event: EventSnapshot;
  capacity: CapacitySnapshot;
};

export type OrganizerTransferRequested = { kind: 'ORGANIZER_TRANSFER_REQUESTED'; transferId: string };
export type OrganizerTransferResponded = { kind: 'ORGANIZER_TRANSFER_ACCEPTED' | 'ORGANIZER_TRANSFER_DECLINED'; transferId: string };

export type DueEventsCompleted = {
  kind: 'DUE_EVENTS_COMPLETED';
  completedEventIds: EventId[];
};

export type EventOutcome = DraftCreated | EventRevised | EventPublished | EventCancelled | OrganizerTransferRequested | OrganizerTransferResponded | DueEventsCompleted;

export interface EventModule {
  decide(command: EventCommand): Promise<EventOutcome>;
}
