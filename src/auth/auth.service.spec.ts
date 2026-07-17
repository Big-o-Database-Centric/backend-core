import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { SqlService } from '../database/sql.service';

describe('AuthService', () => {
  let service: AuthService;
  let sqlService: { execute: jest.Mock };

  beforeEach(async () => {
    sqlService = { execute: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [AuthService, { provide: SqlService, useValue: sqlService }],
    }).compile();

    service = module.get(AuthService);
  });

  it('calls sp_Register with Name/Email/Password and returns the first row', async () => {
    sqlService.execute.mockResolvedValue([{ Success: true, Message: 'Registered', UserId: 1 }]);

    const result = await service.register('Ada', 'ada@example.com', 'secret');

    expect(sqlService.execute).toHaveBeenCalledWith(
      'sp_Register',
      expect.objectContaining({
        Name: expect.objectContaining({ value: 'Ada' }),
        Email: expect.objectContaining({ value: 'ada@example.com' }),
        Password: expect.objectContaining({ value: 'secret' }),
      }),
    );
    expect(result).toEqual({ Success: true, Message: 'Registered', UserId: 1 });
  });

  it('calls sp_Login with Email/Password and returns the first row', async () => {
    sqlService.execute.mockResolvedValue([
      { Success: true, Message: 'OK', UserId: 1, SessionToken: 'tok', Name: 'Ada', Email: 'ada@example.com' },
    ]);

    const result = await service.login('ada@example.com', 'secret');

    expect(sqlService.execute).toHaveBeenCalledWith(
      'sp_Login',
      expect.objectContaining({
        Email: expect.objectContaining({ value: 'ada@example.com' }),
        Password: expect.objectContaining({ value: 'secret' }),
      }),
    );
    expect(result.SessionToken).toBe('tok');
  });
});
