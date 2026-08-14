import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProvisionMongodbDto } from './dto/provision-mongodb.dto';
import { MongodbProvisionService } from './mongodb-provision.service';

@ApiTags('Managed databases')
@Controller('api/managed-databases')
export class MongodbController {
  constructor(private readonly provisionService: MongodbProvisionService) {}

  @Get()
  @ApiOperation({ summary: 'List MongoDB databases' })
  list() {
    return this.provisionService.list();
  }

  @Get('capabilities')
  @ApiOperation({ summary: 'List MongoDB managed database capabilities' })
  capabilities() {
    return { engines: ['mongodb'] };
  }

  @Post()
  @ApiOperation({ summary: 'Provision a MongoDB database' })
  create(@Body() dto: ProvisionMongodbDto) {
    return this.provisionService.create(dto.databaseName);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a MongoDB database' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.provisionService.remove(id);
  }

  @Post(':id/credentials/reset')
  @ApiOperation({ summary: 'Rotate MongoDB credentials' })
  resetCredentials(@Param('id') id: string) {
    return this.provisionService.resetCredentials(id);
  }

  @Get('mongodb/health')
  @ApiOperation({ summary: 'Check the MongoDB provisioning provider' })
  health() {
    return this.provisionService.health();
  }
}
