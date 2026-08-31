import { DataSource, IsNull } from 'typeorm';
import { AttendanceRecord } from '../events/events.persistence';
import type { ListNotifications, NotificationDelivery } from './notifications.interface';
import { NotificationRecord } from './notifications.persistence';
import { NotificationsBusinessError } from './notifications.errors';
import type { RealtimeModule } from '../realtime/realtime.interface';

export class NotificationsImplementation {
  constructor(private readonly dataSource: DataSource, private readonly now = () => new Date(), private readonly realtime?: RealtimeModule) {}

  async list(request: ListNotifications) {
    const limit = request.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new NotificationsBusinessError('INVALID_PAGE_LIMIT');
    const cursor = request.before ? this.decodeCursor(request.before, request.actor.userId) : undefined;
    const repository = this.dataSource.getRepository(NotificationRecord);
    const [rows, unreadCount] = await Promise.all([
      repository.createQueryBuilder('notification').where('notification.recipient_user_id = :userId', { userId: request.actor.userId }).andWhere(cursor ? '(notification.created_at, notification.id) < (:createdAt, :id)' : 'true', cursor ? { createdAt: cursor.createdAt, id: cursor.id } : {}).orderBy('notification.created_at', 'DESC').addOrderBy('notification.id', 'DESC').limit(limit + 1).getMany(),
      repository.count({ where: { recipientUserId: request.actor.userId, readAt: IsNull() } }),
    ]);
    const hasMore = rows.length > limit; const visible = rows.slice(0, limit); const last = visible.at(-1);
    return { items: visible.map((row) => this.item(row)), unreadCount, ...(hasMore && last ? { nextCursor: Buffer.from(JSON.stringify({ createdAt: last.createdAt.toISOString(), id: last.id, userId: request.actor.userId })).toString('base64url') } : {}) };
  }

  async decide(command: { kind: string; actor: { userId: string }; notificationId?: string }) {
    const repository = this.dataSource.getRepository(NotificationRecord);
    if (command.kind === 'MARK_ALL_NOTIFICATIONS_READ') {
      await repository.createQueryBuilder().update().set({ readAt: this.now() }).where('recipient_user_id = :userId AND read_at IS NULL', { userId: command.actor.userId }).execute();
      return { kind: 'NOTIFICATIONS_READ' as const };
    }
    const row = await repository.findOneBy({ id: command.notificationId, recipientUserId: command.actor.userId });
    if (!row) throw new NotificationsBusinessError('NOTIFICATION_NOT_FOUND_OR_NOT_OWNED');
    if (!row.readAt) { row.readAt = this.now(); await repository.save(row); }
    return { kind: 'NOTIFICATION_READ' as const };
  }

  async consume(delivery: NotificationDelivery) {
    if (delivery.eventName === 'event.completed.v1') return { created: false };
    const types: Record<Exclude<NotificationDelivery['eventName'], 'event.completed.v1'>, string> = { 'invitation.received.v1': 'INVITATION_RECEIVED', 'invitation.revoked.v1': 'INVITATION_REVOKED', 'attendance.pending.v1': 'ATTENDANCE_REQUESTED', 'attendance.confirmed.v1': 'ATTENDANCE_CONFIRMED', 'attendance.rejected.v1': 'ATTENDANCE_REJECTED', 'attendance.waitlisted.v1': 'ATTENDANCE_WAITLISTED', 'attendance.promoted.v1': 'ATTENDANCE_PROMOTED', 'event.revised.v1': 'EVENT_REVISED', 'event.cancelled.v1': 'EVENT_CANCELLED', 'organizer-transfer.requested.v1': 'ORGANIZER_TRANSFER_RECEIVED', 'organizer-transfer.accepted.v1': 'ORGANIZER_TRANSFER_ACCEPTED', 'organizer-transfer.declined.v1': 'ORGANIZER_TRANSFER_DECLINED' };
    const recipientUserIds = delivery.eventName.startsWith('event.') ? await this.activeAttendeeIds(delivery.payload.eventId, delivery.payload.recipientUserId) : [delivery.payload.recipientUserId];
    let created = false;
    for (const recipientUserId of recipientUserIds) {
      const result = await this.dataSource.getRepository(NotificationRecord).createQueryBuilder().insert().values({ recipientUserId, type: types[delivery.eventName], eventId: delivery.payload.eventId, title: delivery.payload.title, body: delivery.payload.body, deduplicationKey: `${recipientUserId}:${delivery.messageId}`, readAt: null }).orIgnore().returning('id').execute();
      created ||= result.raw.length > 0;
      if (result.raw.length > 0) {
        await this.realtime?.emit({ kind: 'NOTIFICATIONS_CHANGED', recipientUserId });
        await this.realtime?.emit({
          kind: 'USER_EVENT_CHANGED',
          recipientUserId,
          eventId: delivery.payload.eventId,
          change: delivery.eventName.startsWith('attendance.') ? 'ATTENDANCE' : delivery.eventName.startsWith('invitation.') ? 'INVITATION' : 'EVENT',
        });
      }
    }
    return { created };
  }

  private item(row: NotificationRecord) { return { id: row.id, type: row.type, payload: { eventId: row.eventId, title: row.title, body: row.body }, readAt: row.readAt, createdAt: row.createdAt }; }
  private decodeCursor(value: string, userId: string) { try { const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { createdAt: string; id: string; userId: string }; if (cursor.userId !== userId || !cursor.id || Number.isNaN(new Date(cursor.createdAt).getTime())) throw new Error(); return cursor; } catch { throw new NotificationsBusinessError('INVALID_NOTIFICATION_CURSOR'); } }
  private async activeAttendeeIds(eventId: string, actorUserId: string) { const rows = await this.dataSource.getRepository(AttendanceRecord).find({ where: { eventId }, select: { userId: true, status: true } }); return rows.filter((row) => ['CONFIRMED', 'PENDING', 'WAITLISTED'].includes(row.status) && row.userId !== actorUserId).map((row) => row.userId); }
}
