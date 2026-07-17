import { Injectable } from '@nestjs/common';
import { SqlService } from '../database/sql.service';

@Injectable()
export class StatsService {
  constructor(private readonly sqlService: SqlService) {}

  async getStats(): Promise<Record<string, number>> {
    const [row] = await this.sqlService.execute<Record<string, number>>('sp_GetPlatformStats');
    return row;
  }
}
