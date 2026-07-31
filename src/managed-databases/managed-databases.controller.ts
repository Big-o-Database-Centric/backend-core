import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CreateManagedDatabaseDto } from './dto/create-managed-database.dto';
import { ManagedDatabasesService } from './managed-databases.service';

@Controller('api/managed-databases')
export class ManagedDatabasesController {
  constructor(private readonly service: ManagedDatabasesService) {}

  @Post()
  create(@Req() req: Request, @Body() dto: CreateManagedDatabaseDto) {
    return this.service.create(req.cookies?.session_token ?? null, dto);
  }

  @Get()
  list(@Req() req: Request) {
    return this.service.list(req.cookies?.session_token ?? null);
  }

  @Get('capabilities')
  capabilities() {
    return this.service.capabilities();
  }
}
