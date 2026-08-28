import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export interface MediaStorage {
  put(storageKey: string, bytes: Uint8Array): Promise<void>;
  read(storageKey: string): Promise<Buffer>;
  remove(storageKey: string): Promise<void>;
}

export class LocalMediaStorage implements MediaStorage {
  private readonly directory: string;

  constructor(directory: string) {
    this.directory = resolve(directory);
  }

  async put(storageKey: string, bytes: Uint8Array): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await writeFile(this.pathFor(storageKey), bytes, { flag: 'wx' });
  }

  read(storageKey: string): Promise<Buffer> {
    return readFile(this.pathFor(storageKey));
  }

  async remove(storageKey: string): Promise<void> {
    await rm(this.pathFor(storageKey), { force: true });
  }

  private pathFor(storageKey: string): string {
    if (!/^[0-9a-f-]+\.(jpeg|png|webp)$/.test(storageKey)) throw new Error('Invalid media storage key.');
    return join(this.directory, storageKey);
  }
}
