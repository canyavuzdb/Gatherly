import type { UserIdentity } from '../auth/auth.interface';
export type NotificationItem = { id: string; type: string; payload: { eventId: string; title: string; body: string }; readAt: Date | null; createdAt: Date };
export type NotificationPage = { items: NotificationItem[]; unreadCount: number };
export type NotificationCommand = { kind: 'MARK_NOTIFICATION_READ'; actor: UserIdentity; notificationId: string } | { kind: 'MARK_ALL_NOTIFICATIONS_READ'; actor: UserIdentity };
export type NotificationDelivery = { messageId: string; eventName: 'invitation.received.v1' | 'invitation.revoked.v1' | 'attendance.confirmed.v1' | 'attendance.rejected.v1' | 'attendance.waitlisted.v1' | 'attendance.promoted.v1'; payload: { recipientUserId: string; eventId: string; title: string; body: string } };
export interface NotificationModule { list(actor: UserIdentity): Promise<NotificationPage>; decide(command: NotificationCommand): Promise<{ kind: 'NOTIFICATION_READ' | 'NOTIFICATIONS_READ' }>; consume(delivery: NotificationDelivery): Promise<{ created: boolean }>; }
