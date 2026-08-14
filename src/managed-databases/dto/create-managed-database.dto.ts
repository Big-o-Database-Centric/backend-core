import { IsIn, Matches } from 'class-validator';
import { MANAGED_ENGINES, ManagedEngine } from '../managed-database.types';

export class CreateManagedDatabaseDto {
  @IsIn(MANAGED_ENGINES)
  engine!: ManagedEngine;

  @Matches(/^[a-z][a-z0-9_]{2,62}$/)
  databaseName!: string;
}
