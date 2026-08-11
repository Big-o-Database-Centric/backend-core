import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { AiRole } from '../ai-provider';

export class ChatMessageDto {
  @IsIn(['system', 'user', 'assistant'])
  role!: AiRole;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content!: string;
}
