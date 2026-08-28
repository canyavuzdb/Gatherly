import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  StreamableFile,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { AuthBusinessError } from '../auth/auth.errors';
import { AuthImplementation } from '../auth/auth.implementation';
import { MediaBusinessError } from './media.errors';
import { MediaImplementation } from './media.implementation';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
type UploadedImage = { buffer: Buffer; mimetype: string };

class AttachEventMediaRequest {
  @IsUUID()
  mediaAssetId!: string;

  @IsIn(['COVER', 'GALLERY'])
  role!: 'COVER' | 'GALLERY';

  @IsOptional()
  @IsString()
  @MaxLength(250)
  altText?: string;
}

class SetAvatarRequest {
  @IsUUID()
  mediaAssetId!: string;
}

@ApiTags('Media')
@Controller()
export class MediaHttpController {
  constructor(
    private readonly auth: AuthImplementation,
    private readonly media: MediaImplementation,
  ) {}

  @Post('media/images')
  @HttpCode(HttpStatus.CREATED)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: MAX_IMAGE_BYTES } }))
  async upload(
    @Headers('authorization') authorization: string | undefined,
    @UploadedFile() file: UploadedImage | undefined,
  ) {
    if (!file) throw new BadRequestException('IMAGE_REQUIRED');
    return this.withActor(authorization, (actor) => this.media.decide({
      kind: 'UPLOAD_IMAGE', actor, image: { bytes: file.buffer, declaredMimeType: file.mimetype },
    }));
  }

  @Get('media/me')
  async listOwned(@Headers('authorization') authorization: string | undefined) {
    return this.withActor(authorization, (actor) => this.media.listOwned({ actor }));
  }

  @Post('media/profile/avatar')
  async setProfileAvatar(
    @Headers('authorization') authorization: string | undefined,
    @Body() request: SetAvatarRequest,
  ) {
    return this.withActor(authorization, (actor) => this.media.decide({
      kind: 'SET_PROFILE_AVATAR', actor, mediaAssetId: request.mediaAssetId,
    }));
  }

  @Delete('media/profile/avatar')
  @HttpCode(HttpStatus.OK)
  async clearProfileAvatar(@Headers('authorization') authorization: string | undefined) {
    return this.withActor(authorization, (actor) => this.media.decide({ kind: 'CLEAR_PROFILE_AVATAR', actor }));
  }

  @Post('events/:eventId/media')
  async attachEventMedia(
    @Headers('authorization') authorization: string | undefined,
    @Param('eventId') eventId: string,
    @Body() request: AttachEventMediaRequest,
  ) {
    return this.withActor(authorization, (actor) => this.media.decide({
      kind: 'ATTACH_EVENT_MEDIA', actor, eventId, mediaAssetId: request.mediaAssetId,
      role: request.role, altText: request.altText,
    }));
  }

  @Delete('events/:eventId/media/:eventMediaId')
  @HttpCode(HttpStatus.OK)
  async detachEventMedia(
    @Headers('authorization') authorization: string | undefined,
    @Param('eventMediaId') eventMediaId: string,
  ) {
    return this.withActor(authorization, (actor) => this.media.decide({
      kind: 'DETACH_EVENT_MEDIA', actor, eventMediaId,
    }));
  }

  @Delete('media/:mediaAssetId')
  @HttpCode(HttpStatus.OK)
  async deleteAsset(
    @Headers('authorization') authorization: string | undefined,
    @Param('mediaAssetId') mediaAssetId: string,
  ) {
    return this.withActor(authorization, (actor) => this.media.decide({
      kind: 'DELETE_MEDIA_ASSET', actor, mediaAssetId,
    }));
  }

  @Get('media/:mediaAssetId')
  async open(
    @Headers('authorization') authorization: string | undefined,
    @Param('mediaAssetId') mediaAssetId: string,
    @Query('shareToken') shareToken: string | undefined,
  ) {
    const viewer = await this.optionalActor(authorization);
    try {
      const opened = await this.media.open({ mediaAssetId, viewer, eventShareToken: shareToken });
      return new StreamableFile(opened.bytes, { type: opened.mimeType, length: opened.byteSize });
    } catch (error) {
      if (error instanceof MediaBusinessError && error.code === 'MEDIA_NOT_VIEWABLE') throw new NotFoundException(error.code);
      throw this.mapMediaError(error);
    }
  }

  private async withActor<T>(authorization: string | undefined, operation: (actor: Awaited<ReturnType<AuthImplementation['authenticate']>>) => Promise<T>): Promise<T> {
    const actor = await this.requiredActor(authorization);
    try {
      return await operation(actor);
    } catch (error) {
      throw this.mapMediaError(error);
    }
  }

  private async requiredActor(authorization: string | undefined) {
    const accessToken = readBearerToken(authorization);
    if (!accessToken) throw new UnauthorizedException('ACCESS_TOKEN_INVALID');
    try {
      return await this.auth.authenticate(accessToken);
    } catch (error) {
      if (error instanceof AuthBusinessError) throw new UnauthorizedException(error.code);
      throw error;
    }
  }

  private async optionalActor(authorization: string | undefined) {
    if (!readBearerToken(authorization)) return null;
    return this.requiredActor(authorization);
  }

  private mapMediaError(error: unknown): Error {
    if (!(error instanceof MediaBusinessError)) return error as Error;
    if (['MEDIA_NOT_FOUND', 'EVENT_NOT_FOUND', 'EVENT_MEDIA_NOT_FOUND'].includes(error.code)) return new NotFoundException(error.code);
    if (['MEDIA_NOT_OWNED', 'EVENT_ORGANIZER_REQUIRED', 'USER_NOT_VERIFIED'].includes(error.code)) return new ForbiddenException(error.code);
    return new BadRequestException(error.code);
  }
}

function readBearerToken(authorization: string | undefined) {
  return /^Bearer (.+)$/.exec(authorization ?? '')?.[1];
}
