import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AiService } from './ai.service';
import { CreateAiChatDto } from './dto/create-ai-chat.dto';

@Controller('api/ai')
export class AiController {
  constructor(private readonly service: AiService) {}

  @Get('capabilities')
  capabilities(@Req() req: Request) {
    return this.service.capabilities(req.cookies?.session_token ?? null);
  }

  @Post('chat')
  chat(@Req() req: Request, @Body() dto: CreateAiChatDto) {
    return this.service.chat(req.cookies?.session_token ?? null, dto);
  }
}
