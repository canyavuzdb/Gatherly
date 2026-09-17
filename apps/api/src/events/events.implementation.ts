import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { UserRecord } from '../auth/auth.persistence';
import { EventsBusinessError } from './events.errors';
import { canonicalEventCity } from './event-city';
import { MessagingImplementation } from '../messaging/messaging.implementation';
import type { CommittedFact } from '../messaging/messaging.interface';
import type { RealtimeModule } from '../realtime/realtime.interface';
import type {
  CompleteEventDefinition,
  CompleteDueEvents,
  CancelEvent,
  CreateDraft,
  DraftCreated,
  EventCommand,
  EventModule,
  EventOutcome,
  EventSnapshot,
  PublishEvent,
  RequestOrganizerTransfer,
  RespondToOrganizerTransfer,
  ReviseEvent,
} from './events.interface';
import {
  AttendanceRecord,
  CategoryRecord,
  EventCreationQuotaUsageRecord,
  EventLocationRecord,
  EventOrganizerTransferRecord,
  EventRecord,
  InvitationRecord,
} from './events.persistence';

type EventsDependencies = {
  now?: () => Date;
  newShareToken?: () => string;
};

export class EventsImplementation implements EventModule {
  private readonly now: () => Date;
  private readonly newShareToken: () => string;

  constructor(
    private readonly dataSource: DataSource,
    dependencies: EventsDependencies = {},
    private readonly messaging?: MessagingImplementation,
    private readonly realtime?: RealtimeModule,
  ) {
    this.now = dependencies.now ?? (() => new Date());
    this.newShareToken = dependencies.newShareToken ?? randomUUID;
  }
  private async enqueue(manager: EntityManager, facts: readonly CommittedFact[]): Promise<void> {
    if (!this.messaging) return;
    const messaging = this.messaging as unknown as { enqueue?: (manager: EntityManager, facts: readonly CommittedFact[]) => Promise<void>; publish: (facts: readonly CommittedFact[]) => Promise<void> };
    if (messaging.enqueue) return messaging.enqueue(manager, facts);
    await messaging.publish(facts);
  }

  async decide(command: EventCommand): Promise<EventOutcome> {
    if (command.kind === 'CREATE_DRAFT') return this.createDraft(command);
    if (command.kind === 'PUBLISH_EVENT') return this.emitPublicChange(await this.publishEvent(command), 'EVENT');
    if (command.kind === 'CANCEL_EVENT') return this.emitPublicChange(await this.cancelEvent(command), 'EVENT');
    if (command.kind === 'REQUEST_ORGANIZER_TRANSFER') return this.requestOrganizerTransfer(command);
    if (command.kind === 'RESPOND_TO_ORGANIZER_TRANSFER') return this.respondToOrganizerTransfer(command);
    if (command.kind === 'COMPLETE_DUE_EVENTS') return this.completeDueEvents(command);
    return this.emitPublicChange(await this.reviseEvent(command), 'EVENT');
  }
  private async emitPublicChange(outcome: EventOutcome, change: 'EVENT' | 'CAPACITY') { if ('event' in outcome && outcome.event.visibility === 'PUBLIC') await this.realtime?.emit({ kind: 'PUBLIC_EVENT_CHANGED', eventId: outcome.event.id, change }); return outcome; }

  private async completeDueEvents(_command: CompleteDueEvents): Promise<EventOutcome> {
    const now = this.now();
    const completed = await this.dataSource.transaction(async (manager) => {
      const dueEvents = await manager.createQueryBuilder(EventRecord, 'event')
        .setLock('pessimistic_write')
        .where('event.status = :status', { status: 'PUBLISHED' })
        .andWhere('event.ends_at <= :now', { now })
        .getMany();
      for (const event of dueEvents) {
        event.status = 'COMPLETED';
        event.updatedByUserId = null;
        event.updatedByKind = 'SYSTEM';
        event.version += 1;
      }
      if (dueEvents.length) await manager.save(dueEvents);
      for (const event of dueEvents) await this.enqueue(manager, [{ messageId: `event:${event.id}:${event.version}`, eventName: 'event.completed.v1', eventVersion: 1, occurredAt: now, correlationId: event.id, payload: { recipientUserId: event.organizerId, eventId: event.id, title: 'Event completed', body: 'This event has ended.' } }, { messageId: `attendance-finalization:${event.id}:${event.version}`, eventName: 'attendance.finalization-needed.v1', eventVersion: 1, occurredAt: now, correlationId: event.id, payload: { recipientUserId: event.organizerId, eventId: event.id, title: 'Katılım sonuçlarını tamamla', body: 'Etkinliğin sona erdi. Katılımcıların geldi veya gelmedi durumlarını kontrol edebilirsin.' } }]);
      return dueEvents;
    });
    for (const event of completed) {
      if (event.visibility === 'PUBLIC') {
        await this.realtime?.emit({ kind: 'PUBLIC_EVENT_CHANGED', eventId: event.id, change: 'EVENT' });
      } else {
        const attendees = await this.dataSource.getRepository(AttendanceRecord).find({ where: { eventId: event.id }, select: { userId: true, status: true } });
        for (const attendee of attendees) if (['CONFIRMED', 'PENDING', 'WAITLISTED'].includes(attendee.status)) await this.realtime?.emit({ kind: 'USER_EVENT_CHANGED', recipientUserId: attendee.userId, eventId: event.id, change: 'EVENT' });
      }
    }
    return { kind: 'DUE_EVENTS_COMPLETED', completedEventIds: completed.map((event) => event.id) };
  }

  private async cancelEvent(command: CancelEvent): Promise<EventOutcome> {
    return this.dataSource.transaction(async (manager) => {
      const event = await manager.findOne(EventRecord, { where: { id: command.eventId }, lock: { mode: 'pessimistic_write' } });
      if (!event || event.version !== command.expectedVersion) throw new EventsBusinessError('EVENT_VERSION_CONFLICT');
      if (event.organizerId !== command.actorUserId) throw new EventsBusinessError('NOT_ORGANIZER');
      if ((event.status !== 'DRAFT' && event.status !== 'PUBLISHED') || event.startsAt <= this.now()) {
        throw new EventsBusinessError('EVENT_NOT_CANCELLABLE');
      }
      const location = await manager.findOneBy(EventLocationRecord, { eventId: event.id });
      if (!location) throw new EventsBusinessError('EVENT_NOT_CANCELLABLE');
      event.status = 'CANCELLED';
      event.updatedByUserId = command.actorUserId;
      event.updatedByKind = 'USER';
      event.version += 1;
      await manager.save(event);
      const pendingInvitations = await manager.findBy(InvitationRecord, { eventId: event.id, status: 'PENDING' });
      if (pendingInvitations.length) {
        const now = this.now();
        for (const invitation of pendingInvitations) {
          invitation.status = 'REVOKED';
          invitation.revokedAt = now;
          invitation.updatedByUserId = command.actorUserId;
          invitation.updatedByKind = 'USER';
          invitation.version += 1;
        }
        await manager.save(pendingInvitations);
      }
      const pendingTransfers = await manager.findBy(EventOrganizerTransferRecord, { eventId: event.id, status: 'PENDING' });
      if (pendingTransfers.length) {
        const now = this.now();
        for (const transfer of pendingTransfers) {
          transfer.status = 'REVOKED'; transfer.respondedAt = now; transfer.updatedByUserId = command.actorUserId; transfer.updatedByKind = 'USER'; transfer.version += 1;
        }
        await manager.save(pendingTransfers);
      }
      await this.enqueue(manager, [{ messageId: `event:${event.id}:${event.version}`, eventName: 'event.cancelled.v1', eventVersion: 1, occurredAt: this.now(), correlationId: event.id, payload: { recipientUserId: command.actorUserId, eventId: event.id, title: 'Event updated', body: 'An event you attend was updated.' } }]);
      return { ...draftOutcome(event, location), kind: 'EVENT_CANCELLED' };
    });
  }

  private async requestOrganizerTransfer(command: RequestOrganizerTransfer) {
    const transfer = await this.dataSource.transaction(async (manager) => {
      const event = await manager.findOne(EventRecord, { where: { id: command.eventId }, lock: { mode: 'pessimistic_write' } });
      if (!event || event.organizerId !== command.actorUserId) throw new EventsBusinessError('NOT_ORGANIZER');
      if (event.status !== 'PUBLISHED' || event.startsAt <= this.now()) throw new EventsBusinessError('EVENT_NOT_TRANSFERABLE');
      const recipientAttendance = await manager.findOneBy(AttendanceRecord, { eventId: event.id, userId: command.recipientUserId });
      if (!recipientAttendance || recipientAttendance.status !== 'CONFIRMED' || command.recipientUserId === event.organizerId) throw new EventsBusinessError('INVALID_ORGANIZER_TRANSFER');
      const existing = await manager.findOne(EventOrganizerTransferRecord, { where: { eventId: event.id, status: 'PENDING' }, lock: { mode: 'pessimistic_write' } });
      if (existing) {
        existing.status = 'REVOKED'; existing.respondedAt = this.now(); existing.updatedByUserId = command.actorUserId; existing.updatedByKind = 'USER'; existing.version += 1;
        await manager.save(existing);
      }
      const transfer = await manager.save(manager.create(EventOrganizerTransferRecord, { eventId: event.id, fromUserId: command.actorUserId, toUserId: command.recipientUserId, status: 'PENDING', respondedAt: null, updatedByUserId: command.actorUserId, updatedByKind: 'USER', version: 1 }));
      await this.enqueue(manager, [{ messageId: `organizer-transfer:${transfer.id}:${transfer.version}`, eventName: 'organizer-transfer.requested.v1', eventVersion: 1, occurredAt: this.now(), correlationId: transfer.id, payload: { recipientUserId: transfer.toUserId, eventId: transfer.eventId, title: 'Organizatörlük devri', body: 'Bu etkinliğin organizatörlüğü sana devredilmek isteniyor.' } }]);
      return transfer;
    });
    return { kind: 'ORGANIZER_TRANSFER_REQUESTED' as const, transferId: transfer.id };
  }

  private async respondToOrganizerTransfer(command: RespondToOrganizerTransfer) {
    const result = await this.dataSource.transaction(async (manager) => {
      const transfer = await manager.findOne(EventOrganizerTransferRecord, { where: { id: command.transferId }, lock: { mode: 'pessimistic_write' } });
      if (!transfer || transfer.status !== 'PENDING' || transfer.toUserId !== command.actorUserId) throw new EventsBusinessError('INVALID_ORGANIZER_TRANSFER');
      const event = await manager.findOne(EventRecord, { where: { id: transfer.eventId }, lock: { mode: 'pessimistic_write' } });
      const attendee = event ? await manager.findOneBy(AttendanceRecord, { eventId: event.id, userId: command.actorUserId }) : null;
      if (!event || event.organizerId !== transfer.fromUserId || event.status !== 'PUBLISHED' || event.startsAt <= this.now() || attendee?.status !== 'CONFIRMED') throw new EventsBusinessError('EVENT_NOT_TRANSFERABLE');
      transfer.status = command.response === 'ACCEPT' ? 'ACCEPTED' : 'DECLINED'; transfer.respondedAt = this.now(); transfer.updatedByUserId = command.actorUserId; transfer.updatedByKind = 'USER'; transfer.version += 1;
      await manager.save(transfer);
      if (command.response === 'ACCEPT') {
        event.organizerId = command.actorUserId; event.updatedByUserId = command.actorUserId; event.updatedByKind = 'USER'; event.version += 1;
        await manager.save(event);
      }
      const eventName = command.response === 'ACCEPT' ? 'organizer-transfer.accepted.v1' : 'organizer-transfer.declined.v1';
      await this.enqueue(manager, [{ messageId: `organizer-transfer:${transfer.id}:${transfer.version}`, eventName, eventVersion: 1, occurredAt: this.now(), correlationId: transfer.id, payload: { recipientUserId: transfer.fromUserId, eventId: transfer.eventId, title: command.response === 'ACCEPT' ? 'Organizatörlük devri kabul edildi' : 'Organizatörlük devri reddedildi', body: command.response === 'ACCEPT' ? 'Etkinliğin organizatörlüğü artık yeni katılımcıda.' : 'Etkinlik organizatörlüğü sende kalıyor.' } }]);
      return { transfer, event };
    });
    if (command.response === 'ACCEPT' && result.event.visibility === 'PUBLIC') await this.realtime?.emit({ kind: 'PUBLIC_EVENT_CHANGED', eventId: result.event.id, change: 'EVENT' });
    return { kind: command.response === 'ACCEPT' ? 'ORGANIZER_TRANSFER_ACCEPTED' as const : 'ORGANIZER_TRANSFER_DECLINED' as const, transferId: result.transfer.id };
  }


  private async publishEvent(command: PublishEvent): Promise<EventOutcome> {
    return this.dataSource.transaction(async (manager) => {
      const event = await manager.findOne(EventRecord, { where: { id: command.eventId }, lock: { mode: 'pessimistic_write' } });
      if (!event || event.version !== command.expectedVersion) throw new EventsBusinessError('EVENT_VERSION_CONFLICT');
      if (event.organizerId !== command.actorUserId) throw new EventsBusinessError('NOT_ORGANIZER');
      if (event.status !== 'DRAFT' || event.startsAt <= this.now()) throw new EventsBusinessError('EVENT_NOT_PUBLISHABLE');
      const location = await manager.findOneBy(EventLocationRecord, { eventId: event.id });
      if (!location) throw new EventsBusinessError('EVENT_NOT_PUBLISHABLE');
      event.status = 'PUBLISHED';
      event.updatedByUserId = command.actorUserId;
      event.updatedByKind = 'USER';
      event.version += 1;
      await manager.save(event);
      return { ...draftOutcome(event, location), kind: 'EVENT_PUBLISHED' };
    });
  }

  private async reviseEvent(command: ReviseEvent): Promise<EventOutcome> {
    const definition = this.normalizeDefinition(command.definition);
    const result = await this.dataSource.transaction(async (manager) => {
      const event = await manager.findOne(EventRecord, {
        where: { id: command.eventId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!event || event.version !== command.expectedVersion) {
        throw new EventsBusinessError('EVENT_VERSION_CONFLICT');
      }
      if (event.organizerId !== command.actorUserId) {
        throw new EventsBusinessError('NOT_ORGANIZER');
      }
      if (event.startsAt <= this.now()) {
        throw new EventsBusinessError('EVENT_NOT_EDITABLE');
      }
      if (definition.categoryId !== event.categoryId) {
        const category = await manager.findOneBy(CategoryRecord, { id: definition.categoryId });
        if (!category?.isActive) throw new EventsBusinessError('CATEGORY_INACTIVE');
      }
      const location = await manager.findOneBy(EventLocationRecord, { eventId: event.id });
      if (!location) throw new EventsBusinessError('EVENT_VERSION_CONFLICT');
      event.categoryId = definition.categoryId;
      event.title = definition.title;
      event.description = definition.description;
      event.startsAt = definition.startsAt;
      event.endsAt = definition.endsAt;
      event.timezone = definition.timezone;
      if (definition.capacity !== null && definition.capacity < event.confirmedCount) {
        throw new EventsBusinessError('CAPACITY_BELOW_CONFIRMED_COUNT');
      }
      const capacityIncreased = event.joinPolicy === 'OPEN' && (definition.capacity === null || (event.capacity !== null && definition.capacity > event.capacity));
      event.capacity = definition.capacity;
      const promoted: AttendanceRecord[] = [];
      if (capacityIncreased) {
        const waitlisted = await manager.find(AttendanceRecord, { where: { eventId: event.id, status: 'WAITLISTED' }, order: { waitlistedAt: 'ASC', id: 'ASC' }, lock: { mode: 'pessimistic_write' } });
        for (const attendance of waitlisted) {
          if (event.capacity !== null && event.confirmedCount >= event.capacity) break;
          attendance.status = 'CONFIRMED'; attendance.confirmedAt = this.now(); attendance.version += 1; attendance.updatedByUserId = command.actorUserId; attendance.updatedByKind = 'USER';
          await manager.save(attendance); event.confirmedCount += 1; promoted.push(attendance);
        }
      }
      event.visibility = definition.visibility;
      event.joinPolicy = definition.joinPolicy;
      event.version += 1;
      location.city = definition.location.city;
      location.district = definition.location.district;
      location.venueName = definition.location.venueName;
      location.address = definition.location.address;
      location.latitude = definition.location.latitude;
      location.longitude = definition.location.longitude;
      location.routeMode = definition.location.routeMode;
      location.routeEndLatitude = definition.location.routeEndLatitude;
      location.routeEndLongitude = definition.location.routeEndLongitude;
      location.addressVisibility = definition.location.addressVisibility;
      location.updatedByUserId = command.actorUserId;
      location.updatedByKind = 'USER';
      location.version += 1;
      await manager.save(event);
      await manager.save(location);
      await this.enqueue(manager, [{ messageId: `event:${event.id}:${event.version}`, eventName: 'event.revised.v1', eventVersion: 1, occurredAt: this.now(), correlationId: event.id, payload: { recipientUserId: command.actorUserId, eventId: event.id, title: 'Event updated', body: 'An event you attend was updated.' } }]);
      for (const attendance of promoted) await this.enqueue(manager, [{ messageId: `attendance:${attendance.id}:${attendance.version}`, eventName: 'attendance.promoted.v1', eventVersion: 1, occurredAt: this.now(), correlationId: attendance.id, payload: { recipientUserId: attendance.userId, eventId: event.id, title: 'You are in!', body: 'A place opened up and your attendance was confirmed.' } }]);
      return { outcome: { ...draftOutcome(event, location), kind: 'EVENT_REVISED' } as EventOutcome, promoted };
    });
    return result.outcome;
  }

  private async createDraft(command: CreateDraft): Promise<EventOutcome> {
    const definition = this.normalizeDefinition(command.definition);
    const now = this.now();

    return this.dataSource.transaction(async (manager) => {
      const user = await manager.findOne(UserRecord, {
        where: { id: command.actorUserId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user || user.status !== 'ACTIVE') {
        throw new EventsBusinessError('ACTOR_NOT_ACTIVE');
      }
      if (!user.emailVerifiedAt) {
        throw new EventsBusinessError('ACTOR_NOT_VERIFIED');
      }

      const existing = await manager.findOne(EventRecord, {
        where: { id: command.eventId },
        lock: { mode: 'pessimistic_write' },
      });
      if (existing) {
        const location = await manager.findOneBy(EventLocationRecord, { eventId: existing.id });
        if (!location || !sameDraftIntent(existing, location, user.id, definition)) {
          throw new EventsBusinessError('INVALID_EVENT_DEFINITION');
        }
        return draftOutcome(existing, location);
      }

      const category = await manager.findOneBy(CategoryRecord, { id: definition.categoryId });
      if (!category?.isActive) {
        throw new EventsBusinessError('CATEGORY_INACTIVE');
      }

      const periodStart = utcMonthStart(now);
      await manager.query(
        `INSERT INTO event_creation_quota_usage
          (user_id, period_start, created_count, monthly_event_limit, updated_by_user_id, updated_by_kind, version)
         VALUES ($1, $2, 0, 8, $1, 'USER', 1)
         ON CONFLICT (user_id, period_start) DO NOTHING`,
        [user.id, periodStart],
      );
      const quota = await manager.findOne(EventCreationQuotaUsageRecord, {
        where: { userId: user.id, periodStart },
        lock: { mode: 'pessimistic_write' },
      });
      if (!quota || quota.createdCount >= quota.monthlyEventLimit) {
        throw new EventsBusinessError('EVENT_CREATION_QUOTA_EXHAUSTED');
      }
      quota.createdCount += 1;
      quota.updatedByUserId = user.id;
      quota.updatedByKind = 'USER';
      quota.version += 1;
      await manager.save(quota);

      const event = await manager.save(
        manager.create(EventRecord, {
          id: command.eventId,
          organizerId: user.id,
          categoryId: definition.categoryId,
          title: definition.title,
          description: definition.description,
          startsAt: definition.startsAt,
          endsAt: definition.endsAt,
          timezone: definition.timezone,
          capacity: definition.capacity,
          confirmedCount: 1,
          visibility: definition.visibility,
          joinPolicy: definition.joinPolicy,
          status: 'DRAFT',
          shareToken: definition.visibility === 'UNLISTED' ? this.newShareToken() : null,
          createdByUserId: user.id,
          updatedByUserId: user.id,
          updatedByKind: 'USER',
          version: 1,
        }),
      );
      await manager.save(
        manager.create(EventLocationRecord, {
          eventId: event.id,
          ...definition.location,
          updatedByUserId: user.id,
          updatedByKind: 'USER',
          version: 1,
        }),
      );
      await manager.save(
        manager.create(AttendanceRecord, {
          eventId: event.id,
          userId: user.id,
          status: 'CONFIRMED',
          waitlistOptIn: false,
          requestedAt: now,
          waitlistedAt: null,
          confirmedAt: now,
          rejectedAt: null,
          rejectionReason: null,
          cancelledAt: null,
          updatedByUserId: user.id,
          updatedByKind: 'USER',
          version: 1,
        }),
      );

      return draftOutcome(event, definition.location);
    });
  }

  private normalizeDefinition(definition: CompleteEventDefinition): CompleteEventDefinition {
    const normalized: CompleteEventDefinition = {
      ...definition,
      title: definition.title.trim(),
      description: definition.description.trim(),
      timezone: definition.timezone.trim(),
      location: {
        ...definition.location,
        city: canonicalEventCity(definition.location.city),
        district: definition.location.district.trim(),
        venueName: definition.location.venueName?.trim() || null,
        address: definition.location.address?.trim() || null,
        latitude: definition.location.latitude ?? null,
        longitude: definition.location.longitude ?? null,
        routeMode: definition.location.routeMode ?? 'NONE',
        routeEndLatitude: definition.location.routeEndLatitude ?? null,
        routeEndLongitude: definition.location.routeEndLongitude ?? null,
      },
    };
    if (normalized.endsAt <= normalized.startsAt) {
      throw new EventsBusinessError('INVALID_EVENT_TIMING');
    }
    if (
      !normalized.title || normalized.title.length > 160 ||
      !normalized.description || !normalized.timezone || normalized.timezone.length > 64 ||
      !normalized.location.city || normalized.location.city.length > 100 ||
      !normalized.location.district || normalized.location.district.length > 100 ||
      (normalized.location.venueName?.length ?? 0) > 160 ||
      (normalized.location.latitude === null) !== (normalized.location.longitude === null) ||
      (normalized.location.routeEndLatitude === null) !== (normalized.location.routeEndLongitude === null) ||
      (normalized.location.routeMode === 'NONE' && normalized.location.routeEndLatitude !== null) ||
      (normalized.location.routeMode !== 'NONE' && (normalized.location.latitude === null || normalized.location.routeEndLatitude === null)) ||
      (normalized.location.latitude !== null && (!Number.isFinite(normalized.location.latitude) || normalized.location.latitude < -90 || normalized.location.latitude > 90 || !Number.isFinite(normalized.location.longitude!) || normalized.location.longitude! < -180 || normalized.location.longitude! > 180)) ||
      (normalized.capacity !== null && (!Number.isInteger(normalized.capacity) || normalized.capacity < 1)) ||
      (normalized.capacity !== null && normalized.capacity < 1)
    ) {
      throw new EventsBusinessError('INVALID_EVENT_DEFINITION');
    }
    if (normalized.capacity !== null && normalized.capacity < 1) {
      throw new EventsBusinessError('INVALID_EVENT_DEFINITION');
    }
    if (normalized.visibility === 'PRIVATE' && normalized.joinPolicy !== 'INVITE_ONLY') {
      throw new EventsBusinessError('PRIVATE_EVENT_REQUIRES_INVITE_ONLY');
    }
    return normalized;
  }
}

function draftOutcome(event: EventRecord, location: EventLocationRecord | CompleteEventDefinition['location']): DraftCreated {
  return {
    kind: 'DRAFT_CREATED',
    event: { id: event.id, organizerId: event.organizerId, categoryId: event.categoryId, title: event.title, description: event.description, startsAt: event.startsAt, endsAt: event.endsAt, timezone: event.timezone, capacity: event.capacity, confirmedCount: event.confirmedCount, visibility: event.visibility, joinPolicy: event.joinPolicy, status: event.status, shareToken: event.shareToken, version: event.version, location: { city: location.city, district: location.district, venueName: location.venueName, address: location.address, latitude: location.latitude, longitude: location.longitude, routeMode: location.routeMode, routeEndLatitude: location.routeEndLatitude, routeEndLongitude: location.routeEndLongitude, addressVisibility: location.addressVisibility } },
    capacity: { capacity: event.capacity, confirmedCount: event.confirmedCount, availableCount: event.capacity === null ? null : event.capacity - event.confirmedCount },
  };
}

function sameDraftIntent(event: EventRecord, location: EventLocationRecord, organizerId: string, definition: CompleteEventDefinition) {
  return event.organizerId === organizerId && event.status === 'DRAFT' && event.categoryId === definition.categoryId && event.title === definition.title && event.description === definition.description && event.startsAt.getTime() === definition.startsAt.getTime() && event.endsAt.getTime() === definition.endsAt.getTime() && event.timezone === definition.timezone && event.capacity === definition.capacity && event.visibility === definition.visibility && event.joinPolicy === definition.joinPolicy && location.city === definition.location.city && location.district === definition.location.district && location.venueName === definition.location.venueName && location.address === definition.location.address && location.addressVisibility === definition.location.addressVisibility;
}

function utcMonthStart(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}
