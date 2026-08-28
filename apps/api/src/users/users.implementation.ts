import { DataSource } from 'typeorm';
import { ProfileRecord, UserRecord } from '../auth/auth.persistence';
import { AttendanceRecord, EventRecord } from '../events/events.persistence';
import { EventCreationQuotaUsageRecord } from '../events/events.persistence';
import { UsersBusinessError } from './users.errors';
import type {
  OwnProfileView,
  OpenProfile,
  ProfileView,
  ReviseMyProfile,
  UsersModule,
} from './users.interface';

export class UsersImplementation implements UsersModule {
  constructor(private readonly dataSource: DataSource) {}

  async reviseMyProfile(command: ReviseMyProfile): Promise<OwnProfileView> {
    const firstName = command.firstName.trim();
    const lastName = command.lastName.trim();
    const bio = command.bio?.trim() || null;
    this.assertProfileInput(firstName, lastName, bio);

    return this.dataSource.transaction(async (manager) => {
      const user = await manager.findOneBy(UserRecord, { id: command.actor.userId });
      if (!user || user.status !== 'ACTIVE') {
        throw new UsersBusinessError('ACTOR_NOT_ACTIVE');
      }

      const profile = await manager.findOne(ProfileRecord, {
        where: { userId: user.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!profile || profile.version !== command.expectedVersion) {
        throw new UsersBusinessError('PROFILE_VERSION_CONFLICT');
      }

      profile.firstName = firstName;
      profile.lastName = lastName;
      profile.bio = bio;
      profile.visibility = command.visibility;
      profile.updatedByUserId = user.id;
      profile.updatedByKind = 'USER';
      profile.version += 1;
      await manager.save(profile);

      return {
        userId: profile.userId,
        email: user.email,
        emailVerified: Boolean(user.emailVerifiedAt),
        firstName: profile.firstName,
        lastName: profile.lastName,
        bio: profile.bio,
        avatar: profile.avatarMediaAssetId
          ? { mediaAssetId: profile.avatarMediaAssetId }
          : null,
        visibility: profile.visibility,
        version: profile.version,
      };
    });
  }

  async openProfile(query: OpenProfile): Promise<ProfileView> {
    const profile = await this.dataSource.getRepository(ProfileRecord).findOneBy({ userId: query.subjectUserId });
    if (!profile) {
      throw new UsersBusinessError('PROFILE_NOT_FOUND_OR_NOT_VIEWABLE');
    }
    const isSelf = query.viewer?.userId === profile.userId;
    const canView = profile.visibility === 'PUBLIC' || isSelf || (profile.visibility === 'EVENT_ATTENDEES' && await this.hasSharedConfirmedEvent(query.viewer?.userId, profile.userId)) || (query.viewer && query.decisionContext?.purpose === 'ATTENDANCE_DECISION' && await this.isOrganizerDecisionViewer(query.viewer.userId, profile.userId, query.decisionContext.eventId));
    if (!canView) throw new UsersBusinessError('PROFILE_NOT_FOUND_OR_NOT_VIEWABLE');
    return { userId: profile.userId, firstName: profile.firstName, lastName: profile.lastName, bio: profile.bio, avatar: profile.avatarMediaAssetId ? { mediaAssetId: profile.avatarMediaAssetId } : null };
  }

  async openMyProfile(actor: import('../auth/auth.interface').UserIdentity): Promise<OwnProfileView> {
    const [profile, user] = await Promise.all([
      this.dataSource.getRepository(ProfileRecord).findOneBy({ userId: actor.userId }),
      this.dataSource.getRepository(UserRecord).findOneBy({ id: actor.userId }),
    ]);
    if (!profile || !user) throw new UsersBusinessError('PROFILE_NOT_FOUND_OR_NOT_VIEWABLE');
    return {
      userId: profile.userId,
      email: user.email,
      emailVerified: Boolean(user.emailVerifiedAt),
      firstName: profile.firstName,
      lastName: profile.lastName,
      bio: profile.bio,
      avatar: profile.avatarMediaAssetId ? { mediaAssetId: profile.avatarMediaAssetId } : null,
      visibility: profile.visibility,
      version: profile.version,
    };
  }

  async currentEventCreationQuota(query: import('./users.interface').CurrentEventCreationQuota): Promise<import('./users.interface').QuotaView> {
    const periodStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString().slice(0, 10);
    const row = await this.dataSource.getRepository(EventCreationQuotaUsageRecord).findOneBy({ userId: query.actor.userId, periodStart });
    const createdCount = row?.createdCount ?? 0; const monthlyEventLimit = row?.monthlyEventLimit ?? 8;
    return { periodStart, createdCount, monthlyEventLimit, remainingCount: Math.max(monthlyEventLimit - createdCount, 0) };
  }

  private async hasSharedConfirmedEvent(viewerUserId: string | undefined, subjectUserId: string) { if (!viewerUserId) return false; const match = await this.dataSource.getRepository(AttendanceRecord).createQueryBuilder('subject').innerJoin(AttendanceRecord, 'viewer', "viewer.event_id = subject.event_id AND viewer.user_id = :viewerUserId AND viewer.status = 'CONFIRMED'").where("subject.user_id = :subjectUserId AND subject.status = 'CONFIRMED'", { viewerUserId, subjectUserId }).getOne(); return Boolean(match); }
  private async isOrganizerDecisionViewer(viewerUserId: string, subjectUserId: string, eventId: string) { const event = await this.dataSource.getRepository(EventRecord).findOneBy({ id: eventId, organizerId: viewerUserId }); if (!event) return false; const attendance = await this.dataSource.getRepository(AttendanceRecord).findOneBy({ eventId, userId: subjectUserId }); return attendance?.status === 'PENDING' || attendance?.status === 'WAITLISTED'; }

  private assertProfileInput(
    firstName: string,
    lastName: string,
    bio: string | null,
  ) {
    if (!firstName || !lastName || firstName.length > 100 || lastName.length > 100) {
      throw new UsersBusinessError('INVALID_PROFILE_NAME');
    }
    if (bio && bio.length > 500) {
      throw new UsersBusinessError('BIO_TOO_LONG');
    }
  }
}
