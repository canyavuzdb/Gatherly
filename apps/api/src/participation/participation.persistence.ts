import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('check_in_records')
export class CheckInRecord {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'event_id', type: 'uuid' }) eventId!: string;
  @Column({ name: 'attendance_id', type: 'uuid' }) attendanceId!: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId!: string;
  @Column({ type: 'varchar' }) kind!: 'CHECKED_IN' | 'MARKED_ABSENT' | 'CLEARED' | 'REVOKED';
  @Column({ type: 'varchar', length: 32 }) method!: 'ORGANIZER_MANUAL';
  @Column({ name: 'recorded_by_user_id', type: 'uuid' }) recordedByUserId!: string;
  @Column({ name: 'reverses_check_in_record_id', type: 'uuid', nullable: true }) reversesCheckInRecordId!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

@Entity('participation_outcomes')
export class ParticipationOutcomeRecord {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'event_id', type: 'uuid' }) eventId!: string;
  @Column({ name: 'attendance_id', type: 'uuid' }) attendanceId!: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId!: string;
  @Column({ type: 'varchar' }) outcome!: 'ATTENDED' | 'NO_SHOW';
  @CreateDateColumn({ name: 'derived_at', type: 'timestamptz' }) derivedAt!: Date;
}
