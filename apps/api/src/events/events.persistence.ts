import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('categories')
export class CategoryRecord {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 80 })
  name!: string;

  @Column({ type: 'varchar', length: 80 })
  slug!: string;

  @Column({ name: 'is_active', type: 'boolean' })
  isActive!: boolean;
}

@Entity('events')
export class EventRecord {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'organizer_id', type: 'uuid' })
  organizerId!: string;

  @Column({ name: 'category_id', type: 'uuid' })
  categoryId!: string;

  @Column({ type: 'varchar', length: 160 })
  title!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ name: 'starts_at', type: 'timestamptz' })
  startsAt!: Date;

  @Column({ name: 'ends_at', type: 'timestamptz' })
  endsAt!: Date;

  @Column({ type: 'varchar', length: 64 })
  timezone!: string;

  @Column({ type: 'integer', nullable: true })
  capacity!: number | null;

  @Column({ name: 'confirmed_count', type: 'integer' })
  confirmedCount!: number;

  @Column({ type: 'varchar' })
  visibility!: 'PUBLIC' | 'UNLISTED' | 'PRIVATE';

  @Column({ name: 'join_policy', type: 'varchar' })
  joinPolicy!: 'OPEN' | 'APPROVAL_REQUIRED' | 'INVITE_ONLY';

  @Column({ type: 'varchar' })
  status!: 'DRAFT' | 'PUBLISHED' | 'CANCELLED' | 'COMPLETED';

  @Column({ name: 'share_token', type: 'uuid', nullable: true })
  shareToken!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId!: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'updated_by_user_id', type: 'uuid', nullable: true })
  updatedByUserId!: string | null;

  @Column({ name: 'updated_by_kind', type: 'varchar' })
  updatedByKind!: 'USER' | 'SYSTEM';

  @Column({ type: 'integer' })
  version!: number;
}

@Entity('event_locations')
export class EventLocationRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'event_id', type: 'uuid' })
  eventId!: string;

  @Column({ type: 'varchar', length: 100 })
  city!: string;

  @Column({ type: 'varchar', length: 100 })
  district!: string;

  @Column({ name: 'venue_name', type: 'varchar', length: 160, nullable: true })
  venueName!: string | null;

  @Column({ type: 'text', nullable: true })
  address!: string | null;

  @Column({ name: 'address_visibility', type: 'varchar' })
  addressVisibility!: 'EVENT_VIEWERS' | 'CONFIRMED_ATTENDEES';

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'updated_by_user_id', type: 'uuid', nullable: true })
  updatedByUserId!: string | null;

  @Column({ name: 'updated_by_kind', type: 'varchar' })
  updatedByKind!: 'USER' | 'SYSTEM';

  @Column({ type: 'integer' })
  version!: number;
}

@Entity('event_creation_quota_usage')
export class EventCreationQuotaUsageRecord {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @PrimaryColumn({ name: 'period_start', type: 'date' })
  periodStart!: string;

  @Column({ name: 'created_count', type: 'integer' })
  createdCount!: number;

  @Column({ name: 'monthly_event_limit', type: 'integer' })
  monthlyEventLimit!: number;

  @Column({ name: 'updated_by_user_id', type: 'uuid', nullable: true })
  updatedByUserId!: string | null;

  @Column({ name: 'updated_by_kind', type: 'varchar' })
  updatedByKind!: 'USER' | 'SYSTEM';

  @Column({ type: 'integer' })
  version!: number;
}

@Entity('attendances')
export class AttendanceRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'event_id', type: 'uuid' })
  eventId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar' })
  status!: 'PENDING' | 'CONFIRMED' | 'WAITLISTED' | 'REJECTED' | 'CANCELLED';

  @Column({ name: 'waitlist_opt_in', type: 'boolean' })
  waitlistOptIn!: boolean;

  @Column({ name: 'requested_at', type: 'timestamptz' })
  requestedAt!: Date;

  @Column({ name: 'waitlisted_at', type: 'timestamptz', nullable: true })
  waitlistedAt!: Date | null;

  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmedAt!: Date | null;

  @Column({ name: 'rejected_at', type: 'timestamptz', nullable: true })
  rejectedAt!: Date | null;

  @Column({ name: 'rejection_reason', type: 'varchar', length: 300, nullable: true })
  rejectionReason!: string | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;

  @Column({ name: 'updated_by_user_id', type: 'uuid', nullable: true })
  updatedByUserId!: string | null;

  @Column({ name: 'updated_by_kind', type: 'varchar' })
  updatedByKind!: 'USER' | 'SYSTEM';

  @Column({ type: 'integer' })
  version!: number;
}

@Entity('invitations')
export class InvitationRecord {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'event_id', type: 'uuid' }) eventId!: string;
  @Column({ name: 'recipient_user_id', type: 'uuid' }) recipientUserId!: string;
  @Column({ name: 'invited_by_user_id', type: 'uuid' }) invitedByUserId!: string;
  @Column({ type: 'varchar' }) status!: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt!: Date;
  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true }) acceptedAt!: Date | null;
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true }) revokedAt!: Date | null;
  @Column({ name: 'updated_by_user_id', type: 'uuid', nullable: true }) updatedByUserId!: string | null;
  @Column({ name: 'updated_by_kind', type: 'varchar' }) updatedByKind!: 'USER' | 'SYSTEM';
  @Column({ type: 'integer' }) version!: number;
}
