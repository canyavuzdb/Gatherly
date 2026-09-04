import { DataSource, In, LessThanOrEqual } from 'typeorm';
import { AttendanceRecord, EventRecord } from '../events/events.persistence';
import { CheckInRecord, ParticipationOutcomeRecord } from './participation.persistence';
import { ParticipationBusinessError } from './participation.errors';
import type { ParticipationCommand, ParticipationModule, ParticipationOutcome, RecordCheckIn, RevokeCheckIn, SetAttendancePresence } from './participation.interface';

const CHECK_IN_EARLY_WINDOW_MS = 30 * 60 * 1000;
const CHECK_IN_LATE_WINDOW_MS = 2 * 60 * 60 * 1000;

export class ParticipationImplementation implements ParticipationModule {
  constructor(private readonly dataSource: DataSource, private readonly now = () => new Date()) {}

  async decide(command: ParticipationCommand): Promise<ParticipationOutcome> {
    if (command.kind === 'FINALIZE_DUE_PARTICIPATION') return this.finalizeDueParticipation();
    if (command.kind === 'SET_ATTENDANCE_PRESENCE') return this.setAttendancePresence(command);
    if (command.kind === 'REVOKE_CHECK_IN') return this.revokeCheckIn(command);
    return this.recordCheckIn(command);
  }

  private async setAttendancePresence(command: SetAttendancePresence): Promise<ParticipationOutcome> {
    return this.dataSource.transaction(async (manager) => {
      const event = await manager.findOne(EventRecord, { where: { id: command.eventId }, lock: { mode: 'pessimistic_write' } });
      const nowMs = this.now().getTime();
      if (!event || event.organizerId !== command.actorUserId) throw new ParticipationBusinessError('FORBIDDEN');
      if (!['PUBLISHED', 'COMPLETED'].includes(event.status) || nowMs < event.startsAt.getTime() - CHECK_IN_EARLY_WINDOW_MS || nowMs > event.endsAt.getTime() + CHECK_IN_LATE_WINDOW_MS) throw new ParticipationBusinessError('CHECK_IN_UNAVAILABLE');
      const attendance = await manager.findOneBy(AttendanceRecord, { id: command.attendanceId, eventId: event.id });
      if (!attendance || attendance.status !== 'CONFIRMED') throw new ParticipationBusinessError('ATTENDANCE_NOT_ELIGIBLE');
      const recordKind = command.presence === 'PRESENT' ? 'CHECKED_IN' : command.presence === 'ABSENT' ? 'MARKED_ABSENT' : 'CLEARED';
      await manager.save(manager.create(CheckInRecord, { eventId: event.id, attendanceId: attendance.id, userId: attendance.userId, kind: recordKind, method: 'ORGANIZER_MANUAL', recordedByUserId: command.actorUserId, reversesCheckInRecordId: null }));
      return { kind: 'ATTENDANCE_PRESENCE_SET', attendanceId: attendance.id, presence: command.presence };
    });
  }

  private async recordCheckIn(command: RecordCheckIn): Promise<ParticipationOutcome> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const event = await manager.findOne(EventRecord, { where: { id: command.eventId }, lock: { mode: 'pessimistic_write' } });
        const now = this.now();
        if (!event || event.organizerId !== command.actorUserId) throw new ParticipationBusinessError('FORBIDDEN');
        const nowMs = now.getTime();
        if (!['PUBLISHED', 'COMPLETED'].includes(event.status) || nowMs < new Date(event.startsAt).getTime() - CHECK_IN_EARLY_WINDOW_MS || nowMs > new Date(event.endsAt).getTime() + CHECK_IN_LATE_WINDOW_MS) throw new ParticipationBusinessError('CHECK_IN_UNAVAILABLE');
        const attendance = await manager.findOneBy(AttendanceRecord, { id: command.attendanceId, eventId: event.id });
        if (!attendance || attendance.status !== 'CONFIRMED') throw new ParticipationBusinessError('ATTENDANCE_NOT_ELIGIBLE');
        const existing = await this.activeCheckIn(manager, attendance.id);
        if (existing) throw new ParticipationBusinessError('CHECK_IN_ALREADY_RECORDED');
        const checkIn = await manager.save(manager.create(CheckInRecord, { eventId: event.id, attendanceId: attendance.id, userId: attendance.userId, kind: 'CHECKED_IN', method: 'ORGANIZER_MANUAL', recordedByUserId: command.actorUserId, reversesCheckInRecordId: null }));
        return { kind: 'CHECK_IN_RECORDED', checkIn: { id: checkIn.id, attendanceId: checkIn.attendanceId, userId: checkIn.userId, recordedAt: checkIn.createdAt } };
      });
    } catch (error) {
      if (error instanceof ParticipationBusinessError) throw error;
      if ((error as { code?: string }).code === '23505') throw new ParticipationBusinessError('CHECK_IN_ALREADY_RECORDED');
      throw error;
    }
  }

  private async revokeCheckIn(command: RevokeCheckIn): Promise<ParticipationOutcome> {
    return this.dataSource.transaction(async (manager) => {
      const event = await manager.findOne(EventRecord, { where: { id: command.eventId }, lock: { mode: 'pessimistic_write' } });
      const nowMs = this.now().getTime();
      if (!event || event.organizerId !== command.actorUserId) throw new ParticipationBusinessError('FORBIDDEN');
      if (!['PUBLISHED', 'COMPLETED'].includes(event.status) || nowMs < event.startsAt.getTime() - CHECK_IN_EARLY_WINDOW_MS || nowMs > event.endsAt.getTime() + CHECK_IN_LATE_WINDOW_MS) throw new ParticipationBusinessError('CHECK_IN_UNAVAILABLE');
      const attendance = await manager.findOneBy(AttendanceRecord, { id: command.attendanceId, eventId: event.id });
      if (!attendance || attendance.status !== 'CONFIRMED') throw new ParticipationBusinessError('ATTENDANCE_NOT_ELIGIBLE');
      const existing = await this.activeCheckIn(manager, attendance.id);
      if (!existing) throw new ParticipationBusinessError('CHECK_IN_NOT_RECORDED');
      await manager.save(manager.create(CheckInRecord, { eventId: event.id, attendanceId: attendance.id, userId: attendance.userId, kind: 'REVOKED', method: 'ORGANIZER_MANUAL', recordedByUserId: command.actorUserId, reversesCheckInRecordId: existing.id }));
      return { kind: 'CHECK_IN_REVOKED', attendanceId: attendance.id };
    });
  }

  private activeCheckIn(manager: DataSource['manager'], attendanceId: string): Promise<CheckInRecord | null> {
    return manager.getRepository(CheckInRecord).createQueryBuilder('checkIn')
      .leftJoin(CheckInRecord, 'revocation', "revocation.reverses_check_in_record_id = checkIn.id AND revocation.kind = 'REVOKED'")
      .where("checkIn.attendance_id = :attendanceId AND checkIn.kind = 'CHECKED_IN'", { attendanceId })
      .andWhere('revocation.id IS NULL').orderBy('checkIn.created_at', 'DESC').getOne();
  }

  private async finalizeDueParticipation(): Promise<ParticipationOutcome> {
    const deadline = new Date(this.now().getTime() - CHECK_IN_LATE_WINDOW_MS);
    const events = await this.dataSource.getRepository(EventRecord).find({ where: { status: In(['PUBLISHED', 'COMPLETED']), endsAt: LessThanOrEqual(deadline) } });
    const finalizedEventIds: string[] = [];
    for (const event of events) {
      const finalized = await this.dataSource.transaction(async (manager) => {
        const lockedEvent = await manager.findOne(EventRecord, { where: { id: event.id }, lock: { mode: 'pessimistic_write' } });
        if (!lockedEvent || lockedEvent.status === 'CANCELLED' || lockedEvent.endsAt > deadline) return false;
        const attendances = await manager.findBy(AttendanceRecord, { eventId: lockedEvent.id, status: 'CONFIRMED' });
        const existing = await manager.findBy(ParticipationOutcomeRecord, { eventId: lockedEvent.id });
        const completedAttendanceIds = new Set(existing.map((outcome) => outcome.attendanceId));
        const presenceRecords = await manager.find(CheckInRecord, { where: { eventId: lockedEvent.id }, order: { createdAt: 'ASC', id: 'ASC' } });
        const presenceByAttendanceId = new Map<string, 'PRESENT' | 'ABSENT' | 'UNSET'>();
        for (const record of presenceRecords) presenceByAttendanceId.set(record.attendanceId, record.kind === 'CHECKED_IN' ? 'PRESENT' : record.kind === 'MARKED_ABSENT' ? 'ABSENT' : 'UNSET');
        const missing = attendances.filter((attendance) => !completedAttendanceIds.has(attendance.id));
        if (!missing.length) return false;
        await manager.save(missing.map((attendance) => manager.create(ParticipationOutcomeRecord, { eventId: lockedEvent.id, attendanceId: attendance.id, userId: attendance.userId, outcome: presenceByAttendanceId.get(attendance.id) === 'PRESENT' ? 'ATTENDED' : 'NO_SHOW' })));
        return true;
      });
      if (finalized) finalizedEventIds.push(event.id);
    }
    return { kind: 'PARTICIPATION_FINALIZED', finalizedEventIds };
  }
}
