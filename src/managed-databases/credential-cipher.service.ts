import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

@Injectable()
export class CredentialCipherService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = Buffer.from(config.getOrThrow<string>('DATABASE_CREDENTIALS_KEY'), 'base64');
    if (this.key.length !== 32) throw new Error('DATABASE_CREDENTIALS_KEY must decode to 32 bytes');
  }

  encrypt(plainText: string): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), encrypted]);
  }

  decrypt(payload: Buffer): string {
    if (payload[0] !== 1 || payload.length < 30) throw new Error('Unsupported encrypted credential');
    const decipher = createDecipheriv('aes-256-gcm', this.key, payload.subarray(1, 13));
    decipher.setAuthTag(payload.subarray(13, 29));
    return Buffer.concat([decipher.update(payload.subarray(29)), decipher.final()]).toString('utf8');
  }
}
