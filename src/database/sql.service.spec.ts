import { Test, TestingModule } from '@nestjs/testing';
import * as sql from 'mssql';
import { SqlService } from './sql.service';

describe('SqlService', () => {
  let service: SqlService;
  let mockRequest: { input: jest.Mock; execute: jest.Mock };
  let mockPool: { request: jest.Mock };

  beforeEach(async () => {
    mockRequest = {
      input: jest.fn().mockReturnThis(),
      execute: jest.fn(),
    };
    mockPool = { request: jest.fn().mockReturnValue(mockRequest) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [SqlService, { provide: 'MSSQL_POOL', useValue: mockPool }],
    }).compile();

    service = module.get(SqlService);
  });

  it('parametrizes every input and executes the named stored procedure', async () => {
    mockRequest.execute.mockResolvedValue({ recordset: [{ Success: true }] });

    const result = await service.execute('sp_Login', {
      Email: { type: sql.NVarChar, value: 'a@b.com' },
    });

    expect(mockPool.request).toHaveBeenCalledTimes(1);
    expect(mockRequest.input).toHaveBeenCalledWith('Email', sql.NVarChar, 'a@b.com');
    expect(mockRequest.execute).toHaveBeenCalledWith('sp_Login');
    expect(result).toEqual([{ Success: true }]);
  });

  it('returns an empty array when the SP returns no rows', async () => {
    mockRequest.execute.mockResolvedValue({ recordset: undefined });

    const result = await service.execute('sp_GetPlatformStats');

    expect(result).toEqual([]);
  });
});
