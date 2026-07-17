import { Test, TestingModule } from '@nestjs/testing';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

describe('StatsController', () => {
  let controller: StatsController;
  let statsService: { getStats: jest.Mock };

  beforeEach(async () => {
    statsService = { getStats: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StatsController],
      providers: [{ provide: StatsService, useValue: statsService }],
    }).compile();

    controller = module.get(StatsController);
  });

  it('returns whatever the service resolves, unmodified', async () => {
    const stats = { TotalUsers: 3, TotalDatabases: 5 };
    statsService.getStats.mockResolvedValue(stats);

    const result = await controller.getStats();

    expect(result).toBe(stats);
  });
});
