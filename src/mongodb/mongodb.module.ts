import { Module } from '@nestjs/common';
import { MongodbController } from './mongodb.controller';
import { MongodbProvisionService } from './mongodb-provision.service';

@Module({
  controllers: [MongodbController],
  providers: [MongodbProvisionService],
  exports: [MongodbProvisionService],
})
export class MongodbModule {}
