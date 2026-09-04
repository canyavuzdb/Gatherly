export class ParticipationBusinessError extends Error {
  constructor(readonly code: 'FORBIDDEN' | 'CHECK_IN_UNAVAILABLE' | 'ATTENDANCE_NOT_ELIGIBLE' | 'CHECK_IN_ALREADY_RECORDED' | 'CHECK_IN_NOT_RECORDED') { super(code); }
}
