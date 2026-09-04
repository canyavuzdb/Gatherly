export type RecordCheckIn = { kind: 'RECORD_CHECK_IN'; eventId: string; attendanceId: string; actorUserId: string };
export type RevokeCheckIn = { kind: 'REVOKE_CHECK_IN'; eventId: string; attendanceId: string; actorUserId: string };
export type SetAttendancePresence = { kind: 'SET_ATTENDANCE_PRESENCE'; eventId: string; attendanceId: string; actorUserId: string; presence: 'PRESENT' | 'ABSENT' | 'UNSET' };
export type FinalizeDueParticipation = { kind: 'FINALIZE_DUE_PARTICIPATION' };
export type ParticipationCommand = RecordCheckIn | RevokeCheckIn | SetAttendancePresence | FinalizeDueParticipation;
export type CheckInOutcome = { kind: 'CHECK_IN_RECORDED'; checkIn: { id: string; attendanceId: string; userId: string; recordedAt: Date } };
export type CheckInRevoked = { kind: 'CHECK_IN_REVOKED'; attendanceId: string };
export type AttendancePresenceSet = { kind: 'ATTENDANCE_PRESENCE_SET'; attendanceId: string; presence: 'PRESENT' | 'ABSENT' | 'UNSET' };
export type ParticipationFinalized = { kind: 'PARTICIPATION_FINALIZED'; finalizedEventIds: string[] };
export type ParticipationOutcome = CheckInOutcome | CheckInRevoked | AttendancePresenceSet | ParticipationFinalized;
export interface ParticipationModule { decide(command: ParticipationCommand): Promise<ParticipationOutcome>; }
