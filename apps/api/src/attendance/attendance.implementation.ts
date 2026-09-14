import { DataSource, EntityManager } from 'typeorm';
import { UserRecord } from '../auth/auth.persistence';
import { AttendanceRecord, EventRecord, InvitationRecord } from '../events/events.persistence';
import { MessagingImplementation } from '../messaging/messaging.implementation';
import type { CommittedFact } from '../messaging/messaging.interface';
import type { RealtimeModule } from '../realtime/realtime.interface';
import { AttendanceBusinessError } from './attendance.errors';
import type { AcceptInvitation, AttendanceModule, AttendanceOutcome, CancelAttendance, DecideAttendance, EnrollWaitlist, MarkAttendanceMaybe, RequestAttendance } from './attendance.interface';
export class AttendanceImplementation implements AttendanceModule {
  constructor(private readonly dataSource: DataSource, private readonly now = () => new Date(), private readonly messaging?: MessagingImplementation, private readonly realtime?: RealtimeModule) {}
  private async enqueue(manager: EntityManager, facts: readonly CommittedFact[]): Promise<void> {
    if (!this.messaging) return;
    const messaging = this.messaging as unknown as { enqueue?: (manager: EntityManager, facts: readonly CommittedFact[]) => Promise<void>; publish: (facts: readonly CommittedFact[]) => Promise<void> };
    if (messaging.enqueue) return messaging.enqueue(manager, facts);
    await messaging.publish(facts);
  }
  async decide(command: RequestAttendance | EnrollWaitlist | CancelAttendance | MarkAttendanceMaybe | DecideAttendance | AcceptInvitation): Promise<AttendanceOutcome> {
    if (command.kind === 'ENROLL_WAITLIST') return this.emitUserChange(command.eventId, await this.enrollWaitlist(command));
    if (command.kind === 'CANCEL_ATTENDANCE') return this.emitUserChange(command.eventId, await this.cancelAttendance(command));
    if (command.kind === 'MARK_ATTENDANCE_MAYBE') return this.emitUserChange(command.eventId, await this.markMaybe(command));
    if (command.kind === 'DECIDE_ATTENDANCE') return this.emitUserChange(command.eventId, await this.decideAttendance(command));
    if (command.kind === 'ACCEPT_INVITATION') return this.acceptInvitation(command);
    const outcome = await this.dataSource.transaction(async (manager) => {
      const event = await manager.findOne(EventRecord, { where: { id: command.eventId }, lock: { mode: 'pessimistic_write' } });
      if (!event || event.status !== 'PUBLISHED' || (event.joinPolicy !== 'OPEN' && event.joinPolicy !== 'APPROVAL_REQUIRED') || event.startsAt <= this.now()) throw new AttendanceBusinessError('EVENT_NOT_JOINABLE');
      const user = await manager.findOneBy(UserRecord, { id: command.actorUserId });
      if (!user || user.status !== 'ACTIVE' || !user.emailVerifiedAt) throw new AttendanceBusinessError('ACTOR_NOT_ACTIVE');
      const existing = await manager.findOneBy(AttendanceRecord, { eventId: event.id, userId: user.id });
      if (existing && existing.status !== 'CANCELLED' && existing.status !== 'MAYBE') {
        if (existing.status === 'REJECTED') throw new AttendanceBusinessError('INVALID_ATTENDANCE_TRANSITION');
        return this.outcome(existing, event, existing.status);
      }
      const isApprovalRequired = event.joinPolicy === 'APPROVAL_REQUIRED';
      if (!isApprovalRequired && event.capacity !== null && event.confirmedCount >= event.capacity) throw new AttendanceBusinessError('EVENT_AT_CAPACITY');
      const status: AttendanceOutcome['attendance']['status'] = isApprovalRequired ? 'PENDING' : 'CONFIRMED';
      const now = this.now();
      const attendance = existing
        ? await manager.save(Object.assign(existing, { status, waitlistOptIn: command.waitlistOptIn, requestedAt: now, waitlistedAt: null, confirmedAt: isApprovalRequired ? null : now, rejectedAt: null, rejectionReason: null, cancelledAt: null, updatedByUserId: user.id, updatedByKind: 'USER', version: existing.version + 1 }))
        : await manager.save(manager.create(AttendanceRecord, { eventId: event.id, userId: user.id, status, waitlistOptIn: command.waitlistOptIn, requestedAt: now, waitlistedAt: null, confirmedAt: isApprovalRequired ? null : now, rejectedAt: null, rejectionReason: null, cancelledAt: null, updatedByUserId: user.id, updatedByKind: 'USER', version: 1 }));
      if (!isApprovalRequired) { event.confirmedCount += 1; await manager.save(event); }
      const outcome = { attendance: { id: attendance.id, userId: attendance.userId, status, version: attendance.version }, capacity: { capacity: event.capacity, confirmedCount: event.confirmedCount, availableCount: event.capacity === null ? null : event.capacity - event.confirmedCount } };
      if (status === 'PENDING') await this.enqueue(manager, [{ messageId: `attendance:${attendance.id}:${attendance.version}`, eventName: 'attendance.pending.v1', eventVersion: 1, occurredAt: this.now(), correlationId: attendance.id, payload: { recipientUserId: event.organizerId, eventId: event.id, title: 'Attendance request', body: 'A guest requested to join your event.' } }]);
      return outcome;
    });
    return this.emitUserChange(command.eventId, outcome);
  }
  private async emitUserChange(eventId: string, outcome: AttendanceOutcome) {
    await this.realtime?.emit({ kind: 'USER_EVENT_CHANGED', recipientUserId: outcome.attendance.userId, eventId, change: 'ATTENDANCE' });
    if (outcome.attendance.status === 'CONFIRMED' || outcome.attendance.status === 'CANCELLED' || outcome.attendance.status === 'MAYBE') {
      const event = await this.dataSource.getRepository(EventRecord).findOneBy({ id: eventId });
      if (event?.status === 'PUBLISHED' && event.visibility === 'PUBLIC') {
        await this.realtime?.emit({ kind: 'PUBLIC_EVENT_CHANGED', eventId, change: 'CAPACITY' });
      }
    }
    return outcome;
  }
  private async acceptInvitation(command: AcceptInvitation): Promise<AttendanceOutcome> {
    return this.dataSource.transaction(async (manager) => {
      const invitation = await manager.findOne(InvitationRecord, { where: { id: command.invitationId }, lock: { mode: 'pessimistic_write' } });
      if (!invitation || invitation.status !== 'PENDING' || invitation.recipientUserId !== command.actorUserId || invitation.expiresAt <= this.now()) throw new AttendanceBusinessError('INVALID_ATTENDANCE_TRANSITION');
      const user = await manager.findOneBy(UserRecord, { id: command.actorUserId });
      if (!user || user.status !== 'ACTIVE' || !user.emailVerifiedAt) throw new AttendanceBusinessError('ACTOR_NOT_ACTIVE');
      const event = await manager.findOne(EventRecord, { where: { id: invitation.eventId }, lock: { mode: 'pessimistic_write' } });
      if (!event || event.status !== 'PUBLISHED' || event.startsAt <= this.now()) throw new AttendanceBusinessError('EVENT_NOT_JOINABLE');
      const existing = await manager.findOneBy(AttendanceRecord, { eventId: event.id, userId: user.id });
      if (existing && existing.status !== 'CANCELLED' && existing.status !== 'MAYBE' && existing.status !== 'REJECTED') throw new AttendanceBusinessError('INVALID_ATTENDANCE_TRANSITION');
      const full = event.capacity !== null && event.confirmedCount >= event.capacity;
      if (full && command.ifFull === 'REJECT') throw new AttendanceBusinessError('EVENT_AT_CAPACITY');
      const status = event.joinPolicy === 'APPROVAL_REQUIRED' ? 'PENDING' : full ? 'WAITLISTED' : 'CONFIRMED';
      const now = this.now();
      const row = existing
        ? await manager.save(Object.assign(existing, { status, waitlistOptIn: command.ifFull === 'JOIN_WAITLIST', requestedAt: now, waitlistedAt: status === 'WAITLISTED' ? now : null, confirmedAt: status === 'CONFIRMED' ? now : null, rejectedAt: null, rejectionReason: null, cancelledAt: null, updatedByUserId: user.id, updatedByKind: 'USER', version: existing.version + 1 }))
        : await manager.save(manager.create(AttendanceRecord, { eventId: event.id, userId: user.id, status, waitlistOptIn: command.ifFull === 'JOIN_WAITLIST', requestedAt: now, waitlistedAt: status === 'WAITLISTED' ? now : null, confirmedAt: status === 'CONFIRMED' ? now : null, rejectedAt: null, rejectionReason: null, cancelledAt: null, updatedByUserId: user.id, updatedByKind: 'USER', version: 1 }));
      invitation.status = 'ACCEPTED'; invitation.acceptedAt = now; invitation.updatedByUserId = user.id; invitation.updatedByKind = 'USER'; invitation.version += 1;
      await manager.save(invitation);
      if (status === 'CONFIRMED') { event.confirmedCount += 1; await manager.save(event); }
      const outcome = this.outcome(row, event, status);
      if (status === 'PENDING') await this.enqueue(manager, [{ messageId: `attendance:${row.id}:${row.version}`, eventName: 'attendance.pending.v1', eventVersion: 1, occurredAt: this.now(), correlationId: row.id, payload: { recipientUserId: event.organizerId, eventId: event.id, title: 'Attendance request', body: 'A guest requested to join your event.' } }]);
      return outcome;
    });
  }
  private async decideAttendance(command: DecideAttendance): Promise<AttendanceOutcome> {
    return this.dataSource.transaction(async (manager) => {
      const event = await manager.findOne(EventRecord, { where: { id: command.eventId }, lock: { mode: 'pessimistic_write' } });
      if (!event || event.organizerId !== command.actorUserId) throw new AttendanceBusinessError('FORBIDDEN');
      if (event.status !== 'PUBLISHED' || event.startsAt <= this.now() || event.joinPolicy !== 'APPROVAL_REQUIRED') throw new AttendanceBusinessError('EVENT_NOT_JOINABLE');
      const row = await manager.findOneBy(AttendanceRecord, { id: command.attendanceId, eventId: event.id });
      if (!row || (row.status !== 'PENDING' && row.status !== 'WAITLISTED')) throw new AttendanceBusinessError('INVALID_ATTENDANCE_TRANSITION');
      if (row.status === 'WAITLISTED') {
        const oldest = await manager.findOne(AttendanceRecord, {
          where: { eventId: event.id, status: 'WAITLISTED' },
          order: { waitlistedAt: 'ASC', id: 'ASC' },
          lock: { mode: 'pessimistic_write' },
        });
        if (!oldest || oldest.id !== row.id) {
          throw new AttendanceBusinessError('INVALID_ATTENDANCE_TRANSITION');
        }
      }
      row.version += 1;
      row.updatedByUserId = command.actorUserId;
      if (command.decision === 'REJECT') {
        row.status = 'REJECTED'; row.rejectedAt = this.now(); row.rejectionReason = command.rejectionReason?.trim() || null;
        await manager.save(row);
        const outcome = this.outcome(row, event, 'REJECTED');
        await this.enqueue(manager, [{ messageId: `attendance:${row.id}:${row.version}`, eventName: 'attendance.rejected.v1', eventVersion: 1, occurredAt: this.now(), correlationId: row.id, payload: { recipientUserId: row.userId, eventId: event.id, title: 'Attendance updated', body: 'Your attendance status was updated.' } }]);
        return outcome;
      }
      if (event.capacity !== null && event.confirmedCount >= event.capacity) {
        if (!row.waitlistOptIn) throw new AttendanceBusinessError('EVENT_AT_CAPACITY');
        row.status = 'WAITLISTED'; row.waitlistedAt = this.now();
        await manager.save(row);
        const outcome = this.outcome(row, event, 'WAITLISTED');
        await this.enqueue(manager, [{ messageId: `attendance:${row.id}:${row.version}`, eventName: 'attendance.waitlisted.v1', eventVersion: 1, occurredAt: this.now(), correlationId: row.id, payload: { recipientUserId: row.userId, eventId: event.id, title: 'Attendance updated', body: 'Your attendance status was updated.' } }]);
        return outcome;
      }
      row.status = 'CONFIRMED'; row.confirmedAt = this.now();
      await manager.save(row);
      event.confirmedCount += 1;
      await manager.save(event);
      const outcome = this.outcome(row, event, 'CONFIRMED');
      await this.enqueue(manager, [{ messageId: `attendance:${row.id}:${row.version}`, eventName: 'attendance.confirmed.v1', eventVersion: 1, occurredAt: this.now(), correlationId: row.id, payload: { recipientUserId: row.userId, eventId: event.id, title: 'Attendance updated', body: 'Your attendance status was updated.' } }]);
      return outcome;
    });
  }

  private async markMaybe(command: MarkAttendanceMaybe): Promise<AttendanceOutcome> {
    const result = await this.dataSource.transaction(async (manager) => {
      const event = await manager.findOne(EventRecord, { where: { id: command.eventId }, lock: { mode: 'pessimistic_write' } });
      if (!event || event.status !== 'PUBLISHED' || event.startsAt <= this.now()) throw new AttendanceBusinessError('EVENT_NOT_JOINABLE');
      const user = await manager.findOneBy(UserRecord, { id: command.actorUserId });
      if (!user || user.status !== 'ACTIVE' || !user.emailVerifiedAt) throw new AttendanceBusinessError('ACTOR_NOT_ACTIVE');
      const row = await manager.findOneBy(AttendanceRecord, { eventId: event.id, userId: user.id });
      const invitation = await manager.findOneBy(InvitationRecord, { eventId: event.id, recipientUserId: user.id, status: 'PENDING' });
      if (event.joinPolicy === 'INVITE_ONLY' && !row && !invitation) throw new AttendanceBusinessError('EVENT_NOT_JOINABLE');
      if (row?.status === 'REJECTED') throw new AttendanceBusinessError('INVALID_ATTENDANCE_TRANSITION');
      if (row?.status === 'MAYBE') return { outcome: this.outcome(row, event, 'MAYBE'), promoted: null };
      const now = this.now();
      const wasConfirmed = row?.status === 'CONFIRMED';
      const maybe = row
        ? await manager.save(Object.assign(row, { status: 'MAYBE' as const, waitlistOptIn: false, requestedAt: now, waitlistedAt: null, confirmedAt: null, rejectedAt: null, rejectionReason: null, cancelledAt: null, updatedByUserId: user.id, updatedByKind: 'USER' as const, version: row.version + 1 }))
        : await manager.save(manager.create(AttendanceRecord, { eventId: event.id, userId: user.id, status: 'MAYBE', waitlistOptIn: false, requestedAt: now, waitlistedAt: null, confirmedAt: null, rejectedAt: null, rejectionReason: null, cancelledAt: null, updatedByUserId: user.id, updatedByKind: 'USER', version: 1 }));
      if (wasConfirmed) event.confirmedCount -= 1;
      let promoted: AttendanceRecord | null = null;
      if (wasConfirmed && event.joinPolicy === 'OPEN' && (event.capacity === null || event.confirmedCount < event.capacity)) {
        const next = await manager.findOne(AttendanceRecord, { where: { eventId: event.id, status: 'WAITLISTED' }, order: { waitlistedAt: 'ASC', id: 'ASC' }, lock: { mode: 'pessimistic_write' } });
        if (next) {
          next.status = 'CONFIRMED'; next.confirmedAt = now; next.version += 1;
          await manager.save(next);
          await this.enqueue(manager, [{ messageId: `attendance:${next.id}:${next.version}`, eventName: 'attendance.promoted.v1', eventVersion: 1, occurredAt: this.now(), correlationId: next.id, payload: { recipientUserId: next.userId, eventId: event.id, title: 'You are in!', body: 'A place opened up and your attendance was confirmed.' } }]);
          event.confirmedCount += 1; promoted = next;
        }
      }
      if (wasConfirmed) await manager.save(event);
      return { outcome: this.outcome(maybe, event, 'MAYBE'), promoted };
    });
    return result.outcome;
  }

  private outcome(row: AttendanceRecord, event: EventRecord, status: AttendanceOutcome['attendance']['status']): AttendanceOutcome {
    return { attendance: { id: row.id, userId: row.userId, status, version: row.version }, capacity: { capacity: event.capacity, confirmedCount: event.confirmedCount, availableCount: event.capacity === null ? null : event.capacity - event.confirmedCount } };
  }
  private async cancelAttendance(command: CancelAttendance): Promise<AttendanceOutcome> {
    return this.dataSource.transaction(async (manager) => {
      const event = await manager.findOne(EventRecord, { where: { id: command.eventId }, lock: { mode: 'pessimistic_write' } });
      if (!event || event.organizerId === command.actorUserId) throw new AttendanceBusinessError(event ? 'FORBIDDEN' : 'EVENT_NOT_JOINABLE');
      const row = await manager.findOneBy(AttendanceRecord, { eventId: event.id, userId: command.actorUserId });
      if (!row) {
        if (event.status !== 'PUBLISHED' || event.startsAt <= this.now()) throw new AttendanceBusinessError('EVENT_NOT_JOINABLE');
        const now = this.now();
        const cancelled = await manager.save(manager.create(AttendanceRecord, { eventId: event.id, userId: command.actorUserId, status: 'CANCELLED', waitlistOptIn: false, requestedAt: now, waitlistedAt: null, confirmedAt: null, rejectedAt: null, rejectionReason: null, cancelledAt: now, updatedByUserId: command.actorUserId, updatedByKind: 'USER', version: 1 }));
        return this.outcome(cancelled, event, 'CANCELLED');
      }
      if (row.status === 'CANCELLED') return this.outcome(row, event, 'CANCELLED');
      if (row.status !== 'CONFIRMED' && row.status !== 'MAYBE' && (event.startsAt <= this.now() || (row.status !== 'PENDING' && row.status !== 'WAITLISTED'))) throw new AttendanceBusinessError('INVALID_ATTENDANCE_TRANSITION');
      const wasConfirmed = Boolean(row.confirmedAt);
      row.status = 'CANCELLED'; row.cancelledAt = this.now(); row.version += 1; row.updatedByUserId = command.actorUserId;
      await manager.save(row);
      if (wasConfirmed) event.confirmedCount -= 1;
      if (event.status === 'PUBLISHED' && event.joinPolicy === 'OPEN' && event.startsAt > this.now() && wasConfirmed) {
        const next = await manager.findOne(AttendanceRecord, { where: { eventId: event.id, status: 'WAITLISTED' }, order: { waitlistedAt: 'ASC', id: 'ASC' }, lock: { mode: 'pessimistic_write' } });
        if (next && (event.capacity === null || event.confirmedCount < event.capacity)) {
          next.status = 'CONFIRMED'; next.confirmedAt = this.now(); next.version += 1;
          await manager.save(next);
          await this.enqueue(manager, [{ messageId: `attendance:${next.id}:${next.version}`, eventName: 'attendance.promoted.v1', eventVersion: 1, occurredAt: this.now(), correlationId: next.id, payload: { recipientUserId: next.userId, eventId: event.id, title: 'You are in!', body: 'A place opened up and your attendance was confirmed.' } }]);
          event.confirmedCount += 1;
        }
      }
      await manager.save(event);
      return this.outcome(row, event, 'CANCELLED');
    });
  }
  private async enrollWaitlist(command: EnrollWaitlist): Promise<AttendanceOutcome> {
    return this.dataSource.transaction(async (manager) => {
      const event = await manager.findOne(EventRecord, { where: { id: command.eventId }, lock: { mode: 'pessimistic_write' } });
      if (!event || event.status !== 'PUBLISHED' || event.joinPolicy !== 'OPEN' || event.startsAt <= this.now()) throw new AttendanceBusinessError('EVENT_NOT_JOINABLE');
      const user = await manager.findOneBy(UserRecord, { id: command.actorUserId });
      if (!user || user.status !== 'ACTIVE' || !user.emailVerifiedAt) throw new AttendanceBusinessError('ACTOR_NOT_ACTIVE');
      if (event.capacity === null || event.confirmedCount < event.capacity) throw new AttendanceBusinessError('WAITLIST_UNAVAILABLE');
      const existing = await manager.findOneBy(AttendanceRecord, { eventId: event.id, userId: user.id });
      if (existing && existing.status !== 'CANCELLED' && existing.status !== 'MAYBE') return this.outcome(existing, event, existing.status);
      const now = this.now();
      const row = existing
        ? await manager.save(Object.assign(existing, { status: 'WAITLISTED', waitlistOptIn: true, requestedAt: now, waitlistedAt: now, confirmedAt: null, rejectedAt: null, rejectionReason: null, cancelledAt: null, updatedByUserId: user.id, updatedByKind: 'USER', version: existing.version + 1 }))
        : await manager.save(manager.create(AttendanceRecord, { eventId: event.id, userId: user.id, status: 'WAITLISTED', waitlistOptIn: true, requestedAt: now, waitlistedAt: now, confirmedAt: null, rejectedAt: null, rejectionReason: null, cancelledAt: null, updatedByUserId: user.id, updatedByKind: 'USER', version: 1 }));
      return { attendance: { id: row.id, userId: row.userId, status: 'WAITLISTED', version: row.version }, capacity: { capacity: event.capacity, confirmedCount: event.confirmedCount, availableCount: event.capacity === null ? null : event.capacity - event.confirmedCount } };
    });
  }
}
