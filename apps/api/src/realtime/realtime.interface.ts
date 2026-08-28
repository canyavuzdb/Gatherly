export type CommittedRealtimeSignal =
  | { kind: 'NOTIFICATIONS_CHANGED'; recipientUserId: string }
  | { kind: 'USER_EVENT_CHANGED'; recipientUserId: string; eventId: string; change: 'ATTENDANCE' | 'INVITATION' | 'EVENT' }
  | { kind: 'PUBLIC_EVENT_CHANGED'; eventId: string; change: 'EVENT' | 'CAPACITY' };

export interface RealtimeModule {
  emit(signal: CommittedRealtimeSignal): Promise<void>;
}
