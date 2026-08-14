import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthRepository } from './auth.repository';

@Module({
  controllers: [AuthController],
  providers: [
    {
      provide: 'IAuthRepository',
      useClass: AuthRepository
    }
  ]
})
export class AuthModule {}
