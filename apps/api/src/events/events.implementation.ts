import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { UserRecord } from '../auth/auth.persistence';
import { EventsBusinessError } from './events.errors';
import { MessagingImplementation } from '../messaging/messaging.implementation';
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
  ReviseEvent,
} from './events.interface';
import {
  AttendanceRecord,
  CategoryRecord,
  EventCreationQuotaUsageRecord,
  EventLocationRecord,
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
  ) {
    this.now = dependencies.now ?? (() => new Date());
    this.newShareToken = dependencies.newShareToken ?? randomUUID;
  }

  async decide(command: EventCommand): Promise<EventOutcome> {
    if (command.kind === 'CREATE_DRAFT') return this.createDraft(command);
    if (command.kind === 'PUBLISH_EVENT') return this.publishEvent(command);
    if (command.kind === 'CANCEL_EVENT') return this.cancelEvent(command);
    if (command.kind === 'COMPLETE_DUE_EVENTS') return this.completeDueEvents(command);
    return this.reviseEvent(command);
  }

  private async completeDueEvents(_command: CompleteDueEvents): Promise<EventOutcome> {
    const now = this.now();
    return this.dataSource.transaction(async (manager) => {
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
      return { kind: 'DUE_EVENTS_COMPLETED', completedEventIds: dueEvents.map((event) => event.id) };
    });
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
      return { ...draftOutcome(event, location), kind: 'EVENT_CANCELLED' };
    });
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
    return this.dataSource.transaction(async (manager) => {
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
      event.capacity = definition.capacity;
      event.visibility = definition.visibility;
      event.joinPolicy = definition.joinPolicy;
      event.version += 1;
      location.city = definition.location.city;
      location.district = definition.location.district;
      location.venueName = definition.location.venueName;
      location.address = definition.location.address;
      location.addressVisibility = definition.location.addressVisibility;
      location.updatedByUserId = command.actorUserId;
      location.updatedByKind = 'USER';
      location.version += 1;
      await manager.save(event);
      await manager.save(location);
      return { ...draftOutcome(event, location), kind: 'EVENT_REVISED' };
    });
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
        city: definition.location.city.trim(),
        district: definition.location.district.trim(),
        venueName: definition.location.venueName?.trim() || null,
        address: definition.location.address?.trim() || null,
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
    event: { id: event.id, organizerId: event.organizerId, categoryId: event.categoryId, title: event.title, description: event.description, startsAt: event.startsAt, endsAt: event.endsAt, timezone: event.timezone, capacity: event.capacity, confirmedCount: event.confirmedCount, visibility: event.visibility, joinPolicy: event.joinPolicy, status: event.status, shareToken: event.shareToken, version: event.version, location: { city: location.city, district: location.district, venueName: location.venueName, address: location.address, addressVisibility: location.addressVisibility } },
    capacity: { capacity: event.capacity, confirmedCount: event.confirmedCount, availableCount: event.capacity === null ? null : event.capacity - event.confirmedCount },
  };
}

function sameDraftIntent(event: EventRecord, location: EventLocationRecord, organizerId: string, definition: CompleteEventDefinition) {
  return event.organizerId === organizerId && event.status === 'DRAFT' && event.categoryId === definition.categoryId && event.title === definition.title && event.description === definition.description && event.startsAt.getTime() === definition.startsAt.getTime() && event.endsAt.getTime() === definition.endsAt.getTime() && event.timezone === definition.timezone && event.capacity === definition.capacity && event.visibility === definition.visibility && event.joinPolicy === definition.joinPolicy && location.city === definition.location.city && location.district === definition.location.district && location.venueName === definition.location.venueName && location.address === definition.location.address && location.addressVisibility === definition.location.addressVisibility;
}

function utcMonthStart(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}
