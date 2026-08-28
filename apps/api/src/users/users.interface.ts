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
  email: string;
  emailVerified: boolean;
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
export type OpenProfile = { viewer: UserIdentity | null; subjectUserId: UserId; decisionContext?: { eventId: string; purpose: 'ATTENDANCE_DECISION' } };
export type CurrentEventCreationQuota = { actor: UserIdentity };
export type QuotaView = { periodStart: string; createdCount: number; monthlyEventLimit: number; remainingCount: number };

export interface UsersModule {
  reviseMyProfile(command: ReviseMyProfile): Promise<OwnProfileView>;
  openMyProfile(actor: UserIdentity): Promise<OwnProfileView>;
  openProfile(query: OpenProfile): Promise<ProfileView>;
  currentEventCreationQuota(query: CurrentEventCreationQuota): Promise<QuotaView>;
}
