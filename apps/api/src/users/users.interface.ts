import type { UserId, UserIdentity } from '../auth/auth.interface';

export type ProfileVisibility = 'PUBLIC' | 'EVENT_ATTENDEES' | 'PRIVATE';

export type ProfileView = {
  userId: UserId;
  firstName: string;
  lastName: string;
  bio: string | null;
  avatar: { mediaAssetId: string } | null;
};

export type OwnProfileView = ProfileView & {
  visibility: ProfileVisibility;
  version: number;
};

export type ReviseMyProfile = {
  actor: UserIdentity;
  expectedVersion: number;
  firstName: string;
  lastName: string;
  bio: string | null;
  visibility: ProfileVisibility;
};

export interface UsersModule {
  reviseMyProfile(command: ReviseMyProfile): Promise<OwnProfileView>;
}
