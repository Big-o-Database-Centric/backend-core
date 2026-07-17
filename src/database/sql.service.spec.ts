import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as sql from 'mssql';
import { SqlService } from './sql.service';

jest.mock('mssql', () => ({
  ConnectionPool: jest.fn(),
  NVarChar: Symbol('NVarChar'),
}));

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

describe('SqlService.createPool', () => {
  let mockConfigService: Partial<ConfigService>;
  let mockPoolInstance: { connect: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();

    mockPoolInstance = {
      connect: jest.fn().mockResolvedValue(undefined),
    };

    const getOrThrowMock = jest.fn((key: string) => {
      const required: Record<string, string> = {
        SQL_SERVER: 'localhost',
        SQL_DATABASE: 'test_db',
        SQL_USER: 'test_user',
        SQL_PASSWORD: 'test_password',
      };
      if (key in required) {
        return required[key];
      }
      throw new Error(`Config key ${key} not found`);
    });

    const getMock = jest.fn((key: string, defaultValue?: string) => {
      const defaults: Record<string, string> = {
        SQL_PORT: '1433',
        SQL_SERVER_ENCRYPT: 'true',
        SQL_SERVER_TRUST_SERVER_CERT: 'false',
      };
      return defaults[key] ?? defaultValue;
    });

    mockConfigService = {
      getOrThrow: getOrThrowMock as any,
      get: getMock as any,
    };

    (sql.ConnectionPool as unknown as jest.Mock).mockReturnValue(mockPoolInstance);
  });

  it('constructs pool with correct options from config with defaults', async () => {
    await SqlService.createPool(mockConfigService as ConfigService);

    expect(sql.ConnectionPool as unknown as jest.Mock).toHaveBeenCalledWith({
      server: 'localhost',
      database: 'test_db',
      user: 'test_user',
      password: 'test_password',
      port: 1433,
      options: {
        encrypt: true,
        trustServerCertificate: false,
      },
    });

    expect(mockPoolInstance.connect).toHaveBeenCalledTimes(1);
  });

  it('parses SQL_PORT as a number', async () => {
    const getMock = jest.fn((key: string, defaultValue?: string) => {
      const values: Record<string, string> = {
        SQL_PORT: '1434',
        SQL_SERVER_ENCRYPT: 'true',
        SQL_SERVER_TRUST_SERVER_CERT: 'false',
      };
      return values[key] ?? defaultValue;
    });
    (mockConfigService.get as any) = getMock;

    await SqlService.createPool(mockConfigService as ConfigService);

    expect(sql.ConnectionPool as unknown as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 1434,
      }),
    );
  });

  it('converts SQL_SERVER_ENCRYPT string to boolean true', async () => {
    const getMock = jest.fn((key: string, defaultValue?: string) => {
      const values: Record<string, string> = {
        SQL_PORT: '1433',
        SQL_SERVER_ENCRYPT: 'true',
        SQL_SERVER_TRUST_SERVER_CERT: 'false',
      };
      return values[key] ?? defaultValue;
    });
    (mockConfigService.get as any) = getMock;

    await SqlService.createPool(mockConfigService as ConfigService);

    expect(sql.ConnectionPool as unknown as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          encrypt: true,
        }),
      }),
    );
  });

  it('converts SQL_SERVER_ENCRYPT string to boolean false', async () => {
    const getMock = jest.fn((key: string, defaultValue?: string) => {
      const values: Record<string, string> = {
        SQL_PORT: '1433',
        SQL_SERVER_ENCRYPT: 'false',
        SQL_SERVER_TRUST_SERVER_CERT: 'false',
      };
      return values[key] ?? defaultValue;
    });
    (mockConfigService.get as any) = getMock;

    await SqlService.createPool(mockConfigService as ConfigService);

    expect(sql.ConnectionPool as unknown as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          encrypt: false,
        }),
      }),
    );
  });

  it('converts SQL_SERVER_TRUST_SERVER_CERT string to boolean true', async () => {
    const getMock = jest.fn((key: string, defaultValue?: string) => {
      const values: Record<string, string> = {
        SQL_PORT: '1433',
        SQL_SERVER_ENCRYPT: 'true',
        SQL_SERVER_TRUST_SERVER_CERT: 'true',
      };
      return values[key] ?? defaultValue;
    });
    (mockConfigService.get as any) = getMock;

    await SqlService.createPool(mockConfigService as ConfigService);

    expect(sql.ConnectionPool as unknown as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          trustServerCertificate: true,
        }),
      }),
    );
  });

  it('converts SQL_SERVER_TRUST_SERVER_CERT string to boolean false', async () => {
    const getMock = jest.fn((key: string, defaultValue?: string) => {
      const values: Record<string, string> = {
        SQL_PORT: '1433',
        SQL_SERVER_ENCRYPT: 'true',
        SQL_SERVER_TRUST_SERVER_CERT: 'false',
      };
      return values[key] ?? defaultValue;
    });
    (mockConfigService.get as any) = getMock;

    await SqlService.createPool(mockConfigService as ConfigService);

    expect(sql.ConnectionPool as unknown as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          trustServerCertificate: false,
        }),
      }),
    );
  });

  it('returns the result of pool.connect()', async () => {
    const expectedConnection = { some: 'connection' };
    mockPoolInstance.connect.mockResolvedValue(expectedConnection);

    const result = await SqlService.createPool(mockConfigService as ConfigService);

    expect(result).toEqual(expectedConnection);
  });
});
