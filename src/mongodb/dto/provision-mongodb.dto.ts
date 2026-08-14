import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

export class ProvisionMongodbDto {
  @ApiProperty({ example: 'mongodb', required: false })
  @IsOptional()
  @IsIn(['mongodb'], { message: 'Only the mongodb engine is supported here' })
  engine?: 'mongodb';

  @ApiProperty({ example: 'empresa-abc' })
  @IsString()
  @MinLength(3)
  @Matches(/^[a-z][a-z0-9_-]{2,62}$/, {
    message:
      'databaseName must start with a lowercase letter and contain only lowercase letters, numbers, underscores or hyphens',
  })
  databaseName: string;
}
