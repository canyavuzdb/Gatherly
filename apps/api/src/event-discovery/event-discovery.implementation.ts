import { DataSource, In } from 'typeorm';
import { AttendanceRecord, CategoryRecord, EventLocationRecord, EventRecord } from '../events/events.persistence';
import { ProfileRecord } from '../auth/auth.persistence';
import { EventDiscoveryBusinessError } from './event-discovery.errors';
import { InvitationRecord } from '../events/events.persistence';
import { EventMediaRecord, MediaAssetRecord } from '../media/media.persistence';
import { canonicalEventCity } from '../events/event-city';
import type { CalendarEventCard, CalendarPage, DiscoverEvents, EventCard, EventDetail, EventDiscoveryModule, EventPage, OpenEvent, PersonalCalendar } from './event-discovery.interface';
type Cursor = { startsAt: string; id: string; filter: string };
export class EventDiscoveryImplementation implements EventDiscoveryModule {
  constructor(private readonly dataSource: DataSource, private readonly now = () => new Date()) {}
  async discover(request: DiscoverEvents): Promise<EventPage> {
    const limit = request.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new EventDiscoveryBusinessError('INVALID_PAGE_LIMIT');
    const city = canonicalEventCity(request.city);
    if (!city || (request.startsAtFrom && request.startsAtBefore && request.startsAtFrom >= request.startsAtBefore)) throw new EventDiscoveryBusinessError('INVALID_DISCOVERY_FILTER');
    const filter = JSON.stringify({ city, district: request.district?.trim() || null, categoryId: request.categoryId ?? null, from: request.startsAtFrom?.toISOString() ?? null, before: request.startsAtBefore?.toISOString() ?? null });
    const cursor = request.after ? this.decodeCursor(request.after, filter) : undefined;
    const query = this.dataSource.getRepository(EventRecord).createQueryBuilder('event')
      .innerJoin(EventLocationRecord, 'location', 'location.event_id = event.id')
      .innerJoin(CategoryRecord, 'category', 'category.id = event.category_id')
      .select(['event.id AS id', 'event.title AS title', 'event.starts_at AS "startsAt"', 'event.ends_at AS "endsAt"', 'event.timezone AS timezone', 'event.status AS status', 'event.capacity AS capacity', 'event.confirmed_count AS "confirmedCount"', 'category.id AS "categoryId"', 'category.name AS "categoryName"', 'category.is_active AS "categoryIsActive"', 'location.city AS city', 'location.district AS district', 'location.venue_name AS "venueName"'])
      .addSelect((subquery) => subquery.select('cover.media_asset_id').from(EventMediaRecord, 'cover').innerJoin(MediaAssetRecord, 'coverAsset', "coverAsset.id = cover.media_asset_id AND coverAsset.status = 'READY'").where("cover.event_id = event.id AND cover.role = 'COVER'"), 'coverMediaAssetId')
      .where('event.status = :status', { status: 'PUBLISHED' }).andWhere('event.visibility = :visibility', { visibility: 'PUBLIC' }).andWhere('event.starts_at > :now', { now: this.now() }).andWhere('location.city = :city', { city });
    if (request.district?.trim()) query.andWhere('location.district = :district', { district: request.district.trim() });
    if (request.categoryId) query.andWhere('event.category_id = :categoryId', { categoryId: request.categoryId });
    if (request.startsAtFrom) query.andWhere('event.starts_at >= :from', { from: request.startsAtFrom });
    if (request.startsAtBefore) query.andWhere('event.starts_at < :before', { before: request.startsAtBefore });
    if (cursor) query.andWhere('(event.starts_at, event.id) > (:cursorStartsAt, :cursorId)', { cursorStartsAt: cursor.startsAt, cursorId: cursor.id });
    if (request.viewer) query.addSelect('attendance.status', 'ownAttendanceStatus').leftJoin(AttendanceRecord, 'attendance', 'attendance.event_id = event.id AND attendance.user_id = :viewerId', { viewerId: request.viewer.userId });
    const rows = await query.orderBy('event.starts_at', 'ASC').addOrderBy('event.id', 'ASC').limit(limit + 1).getRawMany();
    const hasMore = rows.length > limit; const visibleRows = rows.slice(0, limit); const last = visibleRows.at(-1);
    const activeCategories = await this.dataSource.getRepository(CategoryRecord).createQueryBuilder('category').select(['category.id AS id', 'category.name AS name']).where('category.is_active = true').orderBy('category.name', 'ASC').getRawMany();
    return { items: visibleRows.map((row) => this.card(row)), activeCategories, ...(hasMore && last ? { nextCursor: this.encodeCursor({ startsAt: new Date(last.startsAt).toISOString(), id: last.id, filter }) } : {}) };
  }
  async open(request: OpenEvent): Promise<EventDetail> {
    const event = await this.dataSource.getRepository(EventRecord).findOneBy({ id: request.eventId });
    const denied = () => { throw new EventDiscoveryBusinessError('EVENT_NOT_FOUND_OR_NOT_VIEWABLE'); };
    if (!event) return denied();
    const location = await this.dataSource.getRepository(EventLocationRecord).findOneBy({ eventId: event.id });
    const category = await this.dataSource.getRepository(CategoryRecord).findOneBy({ id: event.categoryId });
    if (!location || !category) return denied();
    const attendance = request.viewer ? await this.dataSource.getRepository(AttendanceRecord).findOneBy({ eventId: event.id, userId: request.viewer.userId }) : null;
    const activeAttendance = attendance && ['CONFIRMED', 'PENDING', 'WAITLISTED'].includes(attendance.status);
    const organizer = event.organizerId === request.viewer?.userId;
    const invitation = request.viewer ? await this.dataSource.getRepository(InvitationRecord).findOneBy({ eventId: event.id, recipientUserId: request.viewer.userId, status: 'PENDING' }) : null;
    const allowed = event.visibility === 'PUBLIC' && ['PUBLISHED', 'CANCELLED', 'COMPLETED'].includes(event.status) || event.visibility === 'UNLISTED' && (organizer || Boolean(activeAttendance) || request.shareToken === event.shareToken) || event.visibility === 'PRIVATE' && (organizer || Boolean(activeAttendance) || Boolean(invitation)) || event.status === 'DRAFT' && organizer;
    if (!allowed) return denied();
    const addressVisible = location.addressVisibility === 'EVENT_VIEWERS' || organizer || attendance?.status === 'CONFIRMED';
    const coverMedia = await this.dataSource.getRepository(EventMediaRecord).createQueryBuilder('eventMedia').innerJoin(MediaAssetRecord, 'asset', "asset.id = eventMedia.media_asset_id AND asset.status = 'READY'").select('eventMedia.media_asset_id', 'mediaAssetId').where("eventMedia.event_id = :eventId AND eventMedia.role = 'COVER'", { eventId: event.id }).getRawOne<{ mediaAssetId: string }>();
    const card: EventCard = { id: event.id, title: event.title, startsAt: event.startsAt, endsAt: event.endsAt, timezone: event.timezone, status: event.status as EventCard['status'], category: { id: category.id, name: category.name, isActive: category.isActive }, location: { city: location.city, district: location.district, venueName: location.venueName }, capacity: event.capacity === null ? { kind: 'UNLIMITED' } : { kind: 'LIMITED', capacity: event.capacity, confirmedCount: event.confirmedCount, availableSeats: event.capacity - event.confirmedCount }, ...(coverMedia ? { coverMediaAssetId: coverMedia.mediaAssetId } : {}), ...(attendance ? { ownAttendanceStatus: attendance.status } : {}) };
    const galleryMedia = await this.dataSource.getRepository(EventMediaRecord).createQueryBuilder('eventMedia').innerJoin(MediaAssetRecord, 'asset', "asset.id = eventMedia.media_asset_id AND asset.status = 'READY'").select('eventMedia.media_asset_id', 'mediaAssetId').where("eventMedia.event_id = :eventId AND eventMedia.role = 'GALLERY'", { eventId: event.id }).orderBy('eventMedia.position', 'ASC').addOrderBy('eventMedia.id', 'ASC').getRawMany<{ mediaAssetId: string }>();
    const hasJoinEligibility = event.joinPolicy !== 'INVITE_ONLY' || Boolean(invitation);
    const participantPreview = organizer || attendance?.status === 'CONFIRMED' ? await this.participantPreview(event.id) : undefined;
    const participantRoster = organizer ? await this.participantRoster(event.id) : undefined;
    const organizerPreview = await this.organizerPreview(event.organizerId, organizer || attendance?.status === 'CONFIRMED');
    return { ...card, status: event.status, description: event.description, visibility: event.visibility, joinPolicy: event.joinPolicy, ...(invitation?.status === 'PENDING' ? { invitationId: invitation.id } : {}), organizerPreview, ...(participantPreview ? { participantPreview } : {}), ...(participantRoster ? { participantRoster } : {}), isOrganizer: organizer, location: { ...card.location, address: addressVisible ? location.address : null }, galleryMediaAssetIds: galleryMedia.map((media) => media.mediaAssetId), canManageMedia: organizer && ['DRAFT', 'PUBLISHED'].includes(event.status) && event.startsAt > this.now(), joinAvailable: event.status === 'PUBLISHED' && event.startsAt > this.now() && Boolean(request.viewer) && hasJoinEligibility && (!attendance || attendance.status === 'CANCELLED' || attendance.status === 'REJECTED') };
  }
  async personalCalendar(request: PersonalCalendar): Promise<CalendarPage> {
    const limit = request.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new EventDiscoveryBusinessError('INVALID_PAGE_LIMIT');
    const scope = request.scope ?? 'UPCOMING';
    const filter = `calendar:${request.actor.userId}:${scope}`;
    const cursor = request.after ? this.decodeCursor(request.after, filter) : undefined;
    const now = this.now();
    const rows = await this.dataSource.getRepository(EventRecord).createQueryBuilder('event')
      .innerJoin(EventLocationRecord, 'location', 'location.event_id = event.id').innerJoin(CategoryRecord, 'category', 'category.id = event.category_id')
      .leftJoin(AttendanceRecord, 'attendance', "attendance.event_id = event.id AND attendance.user_id = :userId AND attendance.status IN ('CONFIRMED','PENDING','WAITLISTED')", { userId: request.actor.userId })
      .select(['event.id AS id', 'event.title AS title', 'event.starts_at AS "startsAt"', 'event.ends_at AS "endsAt"', 'event.timezone AS timezone', 'event.status AS status', 'event.capacity AS capacity', 'event.confirmed_count AS "confirmedCount"', 'category.id AS "categoryId"', 'category.name AS "categoryName"', 'category.is_active AS "categoryIsActive"', 'location.city AS city', 'location.district AS district', 'location.venue_name AS "venueName"', "CASE WHEN event.organizer_id = :userId THEN 'ORGANIZER' ELSE 'ATTENDEE' END AS relationship"])
      .addSelect((subquery) => subquery.select('cover.media_asset_id').from(EventMediaRecord, 'cover').innerJoin(MediaAssetRecord, 'coverAsset', "coverAsset.id = cover.media_asset_id AND coverAsset.status = 'READY'").where("cover.event_id = event.id AND cover.role = 'COVER'"), 'coverMediaAssetId')
      .where(scope === 'UPCOMING' ? 'event.starts_at > :now' : 'event.starts_at <= :now', { now })
      .andWhere(scope === 'UPCOMING' ? "event.status IN ('DRAFT','PUBLISHED','CANCELLED')" : "event.status IN ('PUBLISHED','CANCELLED','COMPLETED')")
      .andWhere('(event.organizer_id = :userId OR attendance.id IS NOT NULL)', { userId: request.actor.userId })
      .andWhere(cursor ? scope === 'UPCOMING' ? '(event.starts_at, event.id) > (:cursorStartsAt, :cursorId)' : '(event.starts_at, event.id) < (:cursorStartsAt, :cursorId)' : 'true', cursor ? { cursorStartsAt: cursor.startsAt, cursorId: cursor.id } : {})
      .orderBy('event.starts_at', scope === 'UPCOMING' ? 'ASC' : 'DESC').addOrderBy('event.id', scope === 'UPCOMING' ? 'ASC' : 'DESC').limit(limit + 1).getRawMany();
    const hasMore = rows.length > limit; const items = rows.slice(0, limit).map((row) => ({ ...this.card(row), status: row.status as CalendarEventCard['status'], relationship: row.relationship as CalendarEventCard['relationship'] })); const last = items.at(-1);
    return { items, ...(hasMore && last ? { nextCursor: this.encodeCursor({ startsAt: last.startsAt.toISOString(), id: last.id, filter }) } : {}) };
  }
  private async participantPreview(eventId: string) {
    const attendees = await this.dataSource.getRepository(AttendanceRecord).find({ where: { eventId, status: 'CONFIRMED' }, order: { confirmedAt: 'ASC', id: 'ASC' }, take: 8 });
    const profiles = attendees.length ? await this.dataSource.getRepository(ProfileRecord).findBy({ userId: In(attendees.map((attendee) => attendee.userId)) }) : [];
    const profilesByUserId = new Map(profiles.map((profile) => [profile.userId, profile]));
    return attendees.map((attendee, index) => {
      const profile = profilesByUserId.get(attendee.userId);
      if (!profile || profile.visibility === 'PRIVATE') return { kind: 'ANONYMOUS' as const, initials: `K${index + 1}` };
      const name = `${profile.firstName} ${profile.lastName}`.trim();
      const initials = `${profile.firstName[0] ?? ''}${profile.lastName[0] ?? ''}`.toLocaleUpperCase('tr-TR') || `K${index + 1}`;
      return { kind: 'VISIBLE' as const, userId: profile.userId, name, initials, ...(profile.avatarMediaAssetId ? { avatarMediaAssetId: profile.avatarMediaAssetId } : {}) };
    });
  }
  private async organizerPreview(organizerId: string, viewerIsConfirmedAttendee: boolean) {
    const profile = await this.dataSource.getRepository(ProfileRecord).findOneBy({ userId: organizerId });
    if (!profile || profile.visibility === 'PRIVATE' || (profile.visibility === 'EVENT_ATTENDEES' && !viewerIsConfirmedAttendee)) return { kind: 'ANONYMOUS' as const, initials: 'O' };
    const name = `${profile.firstName} ${profile.lastName}`.trim();
    const initials = `${profile.firstName[0] ?? ''}${profile.lastName[0] ?? ''}`.toLocaleUpperCase('tr-TR') || 'O';
    return { kind: 'VISIBLE' as const, userId: profile.userId, name, initials, ...(profile.avatarMediaAssetId ? { avatarMediaAssetId: profile.avatarMediaAssetId } : {}) };
  }
  private async participantRoster(eventId: string) {
    const attendees = await this.dataSource.getRepository(AttendanceRecord).find({ where: { eventId, status: 'CONFIRMED' }, order: { confirmedAt: 'ASC', id: 'ASC' }, take: 50 });
    const profiles = attendees.length ? await this.dataSource.getRepository(ProfileRecord).findBy({ userId: In(attendees.map((attendee) => attendee.userId)) }) : [];
    const profilesByUserId = new Map(profiles.map((profile) => [profile.userId, profile]));
    return attendees.map((attendee, index) => {
      const profile = profilesByUserId.get(attendee.userId);
      if (!profile) return { userId: attendee.userId, name: `Katılımcı ${index + 1}`, initials: `K${index + 1}` };
      const name = `${profile.firstName} ${profile.lastName}`.trim();
      const initials = `${profile.firstName[0] ?? ''}${profile.lastName[0] ?? ''}`.toLocaleUpperCase('tr-TR') || `K${index + 1}`;
      return { userId: profile.userId, name, initials, ...(profile.avatarMediaAssetId ? { avatarMediaAssetId: profile.avatarMediaAssetId } : {}) };
    });
  }
  private card(row: Record<string, unknown>): EventCard { const capacity = row.capacity === null ? { kind: 'UNLIMITED' as const } : { kind: 'LIMITED' as const, capacity: Number(row.capacity), confirmedCount: Number(row.confirmedCount), availableSeats: Number(row.capacity) - Number(row.confirmedCount) }; return { id: String(row.id), title: String(row.title), startsAt: new Date(String(row.startsAt)), endsAt: new Date(String(row.endsAt)), timezone: String(row.timezone), status: row.status as EventCard['status'], category: { id: String(row.categoryId), name: String(row.categoryName), isActive: Boolean(row.categoryIsActive) }, location: { city: String(row.city), district: String(row.district), venueName: row.venueName === null ? null : String(row.venueName) }, capacity, ...(row.coverMediaAssetId ? { coverMediaAssetId: String(row.coverMediaAssetId) } : {}), ...(row.ownAttendanceStatus ? { ownAttendanceStatus: row.ownAttendanceStatus as EventCard['ownAttendanceStatus'] } : {}) }; }
  private encodeCursor(cursor: Cursor) { return Buffer.from(JSON.stringify(cursor)).toString('base64url'); }
  private decodeCursor(value: string, filter: string): Cursor { try { const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Cursor; if (!cursor.startsAt || !cursor.id || cursor.filter !== filter || Number.isNaN(new Date(cursor.startsAt).getTime())) throw new Error(); return cursor; } catch { throw new EventDiscoveryBusinessError('INVALID_DISCOVERY_CURSOR'); } }
}
