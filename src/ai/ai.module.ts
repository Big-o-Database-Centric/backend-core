import { Module } from '@nestjs/common';
import { AI_PROVIDER } from './ai-provider';
import { AI_USAGE_REPOSITORY } from './ai-usage.repository';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { PolyServiceAiProvider } from './polyservice-ai.provider';
import { SqlServerAiUsageRepository } from './sql-server-ai-usage.repository';

@Module({
  controllers: [AiController],
  providers: [
    AiService,
    { provide: AI_USAGE_REPOSITORY, useClass: SqlServerAiUsageRepository },
    { provide: AI_PROVIDER, useClass: PolyServiceAiProvider },
  ],
})
export class AiModule {}
