import { DataSource } from 'typeorm';
import { EventRecord } from '../events/events.persistence';
import { ParticipationOutcomeRecord } from '../participation/participation.persistence';
import { EventReviewRecord } from './feedback.persistence';
export class FeedbackBusinessError extends Error { constructor(readonly code: 'REVIEW_NOT_ELIGIBLE' | 'INVALID_REVIEW') { super(code); } }
export class FeedbackImplementation {
  constructor(private readonly dataSource: DataSource) {}
  async review(input: { eventId: string; actorUserId: string; subject: 'EVENT' | 'ORGANIZER'; rating: number; comment?: string }) {
    return this.dataSource.transaction(async (m) => { const event = await m.findOneBy(EventRecord, { id: input.eventId }); const attended = await m.findOneBy(ParticipationOutcomeRecord, { eventId: input.eventId, userId: input.actorUserId, outcome: 'ATTENDED' }); if (!event || !attended || event.organizerId === input.actorUserId) throw new FeedbackBusinessError('REVIEW_NOT_ELIGIBLE'); const previous = await m.getRepository(EventReviewRecord).findOne({ where: { eventId: input.eventId, authorUserId: input.actorUserId, subject: input.subject }, order: { createdAt: 'DESC', id: 'DESC' } }); return m.save(m.create(EventReviewRecord, { eventId: input.eventId, authorUserId: input.actorUserId, subject: input.subject, rating: input.rating, comment: input.comment?.trim() || null, supersedesReviewId: previous?.id ?? null })); });
  }
  async list(eventId: string, actorUserId?: string) { const rows = await this.dataSource.getRepository(EventReviewRecord).createQueryBuilder('review').where('review.event_id = :eventId', { eventId }).orderBy('review.created_at', 'DESC').addOrderBy('review.id', 'DESC').getMany(); const latest = new Map<string, EventReviewRecord>(); for (const row of rows) { const key = `${row.authorUserId}:${row.subject}`; if (!latest.has(key)) latest.set(key, row); } const current = [...latest.values()]; return { summary: (['EVENT','ORGANIZER'] as const).map((subject) => { const values = current.filter((r) => r.subject === subject); return { subject, count: values.length, average: values.length ? Math.round(values.reduce((sum, r) => sum + r.rating, 0) / values.length * 10) / 10 : null }; }), own: actorUserId ? current.filter((r) => r.authorUserId === actorUserId).map((r) => ({ subject: r.subject, rating: r.rating, comment: r.comment })) : [] }; }
}
