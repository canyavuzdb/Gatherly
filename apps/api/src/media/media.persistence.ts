import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('media_assets')
export class MediaAssetRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId!: string;

  @Column({ name: 'storage_key', type: 'varchar', length: 512 })
  storageKey!: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 100 })
  mimeType!: 'image/jpeg' | 'image/png' | 'image/webp';

  @Column({ name: 'byte_size', type: 'integer' })
  byteSize!: number;

  @Column({ type: 'integer', nullable: true })
  width!: number | null;

  @Column({ type: 'integer', nullable: true })
  height!: number | null;

  @Column({ type: 'varchar' })
  status!: 'PENDING' | 'PROCESSING' | 'READY' | 'REJECTED' | 'DELETED';

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'updated_by_user_id', type: 'uuid', nullable: true })
  updatedByUserId!: string | null;

  @Column({ name: 'updated_by_kind', type: 'varchar' })
  updatedByKind!: 'USER' | 'SYSTEM';

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @Column({ name: 'deleted_by_user_id', type: 'uuid', nullable: true })
  deletedByUserId!: string | null;

  @Column({ type: 'integer' })
  version!: number;
}

@Entity('event_media')
export class EventMediaRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'event_id', type: 'uuid' })
  eventId!: string;

  @Column({ name: 'media_asset_id', type: 'uuid' })
  mediaAssetId!: string;

  @Column({ type: 'varchar' })
  role!: 'COVER' | 'GALLERY';

  @Column({ type: 'integer' })
  position!: number;

  @Column({ name: 'alt_text', type: 'varchar', length: 250, nullable: true })
  altText!: string | null;

  @Column({ name: 'added_by_user_id', type: 'uuid' })
  addedByUserId!: string;

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
