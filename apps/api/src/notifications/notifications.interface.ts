import type { UserIdentity } from '../auth/auth.interface';
export type NotificationItem = { id: string; type: string; payload: { eventId: string; title: string; body: string }; readAt: Date | null; createdAt: Date };
export type ListNotifications = { actor: UserIdentity; before?: string; limit?: number };
export type NotificationPage = { items: NotificationItem[]; unreadCount: number; nextCursor?: string };
export type NotificationCommand = { kind: 'MARK_NOTIFICATION_READ'; actor: UserIdentity; notificationId: string } | { kind: 'MARK_ALL_NOTIFICATIONS_READ'; actor: UserIdentity };
export type NotificationDelivery = { messageId: string; eventName: 'invitation.received.v1' | 'invitation.revoked.v1' | 'attendance.pending.v1' | 'attendance.confirmed.v1' | 'attendance.rejected.v1' | 'attendance.waitlisted.v1' | 'attendance.promoted.v1' | 'event.revised.v1' | 'event.cancelled.v1' | 'event.completed.v1' | 'organizer-transfer.requested.v1' | 'organizer-transfer.accepted.v1' | 'organizer-transfer.declined.v1'; payload: { recipientUserId: string; eventId: string; title: string; body: string } };
export interface NotificationModule { list(request: ListNotifications): Promise<NotificationPage>; decide(command: NotificationCommand): Promise<{ kind: 'NOTIFICATION_READ' | 'NOTIFICATIONS_READ' }>; consume(delivery: NotificationDelivery): Promise<{ created: boolean }>; }
