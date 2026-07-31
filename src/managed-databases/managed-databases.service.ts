import { ConflictException, Inject, Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { CredentialCipherService } from './credential-cipher.service';
import { DATABASE_PROVISIONERS, DatabaseProvisioner } from './database-provisioner';
import { CreateManagedDatabaseDto } from './dto/create-managed-database.dto';
import { MANAGED_DATABASE_REPOSITORY, ManagedDatabaseRepository } from './managed-database.repository';
import { ManagedEngine } from './managed-database.types';

@Injectable()
export class ManagedDatabasesService {
  private readonly byEngine: Map<ManagedEngine, DatabaseProvisioner>;

  constructor(
    @Inject(MANAGED_DATABASE_REPOSITORY) private readonly repository: ManagedDatabaseRepository,
    @Inject(DATABASE_PROVISIONERS) provisioners: DatabaseProvisioner[],
    private readonly cipher: CredentialCipherService,
  ) {
    this.byEngine = new Map(provisioners.map((provisioner) => [provisioner.engine, provisioner]));
  }

  async create(sessionToken: string | null, dto: CreateManagedDatabaseDto) {
    const reservation = await this.repository.reserve(sessionToken, dto.databaseName, dto.engine);
    if (!reservation?.Success) {
      if (reservation?.Message === 'Unauthorized') throw new UnauthorizedException();
      throw new ConflictException(reservation?.Message ?? 'Unable to reserve database');
    }

    const provisioner = this.byEngine.get(dto.engine);
    if (!provisioner || !reservation.DatabaseId || !reservation.InstanceId || !reservation.Email) {
      if (reservation?.DatabaseId) await this.repository.fail(reservation.DatabaseId, 'Provisioner unavailable');
      throw new InternalServerErrorException('Database engine is unavailable');
    }

    const username = reservation.Email;
    const password = randomBytes(24).toString('base64url');
    try {
      const connection = await provisioner.provision({
        instanceId: reservation.InstanceId,
        databaseName: dto.databaseName,
        username,
        password,
      });
      const activated = await this.repository.activate(reservation.DatabaseId, connection, this.cipher.encrypt(password));
      if (!activated) {
        await provisioner.destroy(reservation.InstanceId);
        throw new Error('Reservation was not active');
      }
      return { databaseId: reservation.DatabaseId, databaseName: dto.databaseName, engine: dto.engine, ...connection, password, quotaBytes: 20971520 };
    } catch (error) {
      await this.repository.fail(reservation.DatabaseId, 'Provisioning failed');
      throw new InternalServerErrorException('Database provisioning failed');
    }
  }

  async list(sessionToken: string | null) {
    const records = await this.repository.list(sessionToken);
    if (records.length === 1 && (records[0] as any).Success === false) throw new UnauthorizedException();
    return records;
  }
}
