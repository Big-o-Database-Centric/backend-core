import { HttpException } from '@nestjs/common';
import { MongodbProvisionService } from './mongodb-provision.service';

describe('MongodbProvisionService', () => {
  const originalApiKey = process.env.MONGODB_PROVISION_API_KEY;
  const originalApiUrl = process.env.MONGODB_PROVISION_API_URL;

  beforeEach(() => {
    process.env.MONGODB_PROVISION_API_KEY = 'test-key';
    process.env.MONGODB_PROVISION_API_URL = 'https://mongo.test';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env.MONGODB_PROVISION_API_KEY = originalApiKey;
    process.env.MONGODB_PROVISION_API_URL = originalApiUrl;
  });

  it('sends the API key and creates a database', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ id: 'db_1' }), { status: 201 }),
      );
    const service = new MongodbProvisionService();

    await expect(service.create('empresa-abc')).resolves.toEqual({
      id: 'db_1',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://mongo.test/databases',
      expect.objectContaining({
        method: 'POST',
        // Jest's asymmetric matcher is intentionally untyped.
        headers: expect.objectContaining({
          'X-API-Key': 'test-key',
        }) as unknown,
        body: JSON.stringify({ databaseName: 'empresa-abc' }),
      }),
    );
  });

  it('normalizes wrapped database lists', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ databases: [{ id: 'db_1' }] }), {
        status: 200,
      }),
    );
    const service = new MongodbProvisionService();

    await expect(service.list()).resolves.toEqual([{ id: 'db_1' }]);
  });

  it('preserves the provider error contract', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'DATABASE_EXISTS',
            message: 'Database already exists',
          },
        }),
        { status: 409 },
      ),
    );
    const service = new MongodbProvisionService();

    const error = service.create('empresa-abc');
    await expect(error).rejects.toBeInstanceOf(HttpException);
    await expect(error).rejects.toMatchObject({
      response: {
        error: { code: 'DATABASE_EXISTS', message: 'Database already exists' },
      },
      status: 409,
    });
  });
});
