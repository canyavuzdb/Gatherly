import { DataSource } from 'typeorm';
import { ProfileRecord, UserRecord } from '../auth/auth.persistence';
import { UsersBusinessError } from './users.errors';
import type {
  OwnProfileView,
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
