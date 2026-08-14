import { Transform } from 'class-transformer';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { AiRole } from '../ai-provider';

export class ChatMessageDto {
  @IsIn(['system', 'user', 'assistant'])
  role!: AiRole;

  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content!: string;
}
