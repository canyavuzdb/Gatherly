export type RequestAttendance = { kind: 'REQUEST_ATTENDANCE'; eventId: string; actorUserId: string; waitlistOptIn: boolean };
export type EnrollWaitlist = { kind: 'ENROLL_WAITLIST'; eventId: string; actorUserId: string };
export type CancelAttendance = { kind: 'CANCEL_ATTENDANCE'; eventId: string; actorUserId: string };
export type MarkAttendanceMaybe = { kind: 'MARK_ATTENDANCE_MAYBE'; eventId: string; actorUserId: string };
export type DecideAttendance = { kind: 'DECIDE_ATTENDANCE'; eventId: string; attendanceId: string; actorUserId: string; decision: 'CONFIRM' | 'REJECT'; rejectionReason?: string };
export type AcceptInvitation = { kind: 'ACCEPT_INVITATION'; invitationId: string; actorUserId: string; ifFull: 'REJECT' | 'JOIN_WAITLIST' };
export type AttendanceOutcome = { attendance: { id: string; userId: string; status: 'PENDING' | 'CONFIRMED' | 'WAITLISTED' | 'REJECTED' | 'CANCELLED' | 'MAYBE'; version: number }; capacity: { capacity: number | null; confirmedCount: number; availableCount: number | null } };
export interface AttendanceModule { decide(command: RequestAttendance | EnrollWaitlist | CancelAttendance | MarkAttendanceMaybe | DecideAttendance | AcceptInvitation): Promise<AttendanceOutcome>; }
