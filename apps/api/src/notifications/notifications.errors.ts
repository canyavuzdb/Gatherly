export class NotificationsBusinessError extends Error { constructor(readonly code: 'NOTIFICATION_NOT_FOUND_OR_NOT_OWNED' | 'INVALID_NOTIFICATION_CURSOR' | 'INVALID_PAGE_LIMIT') { super(code); } }
