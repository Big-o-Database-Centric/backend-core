import { Test, TestingModule } from '@nestjs/testing';
import { N8nService, ProvisionN8nResponse } from './n8n.service';
import { ConfigService } from '@nestjs/config';

global.fetch = jest.fn();

describe('N8nService', () => {
  let service: N8nService;
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    configService = { get: jest.fn() };
    configService.get.mockImplementation((key: string) => {
      if (key === 'N8N_BASE_URL') return 'https://api.snapshot.andrescortes.dev';
      if (key === 'N8N_API_KEY') return 'test-api-key';
      return undefined;
    });

    (global.fetch as jest.Mock).mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [N8nService, { provide: ConfigService, useValue: configService }],
    }).compile();

    service = module.get(N8nService);
  });

  it('provisions N8N account and returns the credential link', async () => {
    const mockResponse: ProvisionN8nResponse = {
      account_id: 'uuid-123',
      status: 'active',
      access_type: 'invite_link',
      credential: 'https://n8n.example.com/signup?inviterId=...&inviteeId=...',
    };
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await service.provisionAccount(42, 'user@example.com');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.snapshot.andrescortes.dev/n8n/external/provision',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-API-Key': 'test-api-key',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ external_user_ref: '42', email: 'user@example.com' }),
      }),
    );
    expect(result).toEqual(mockResponse);
  });

  it('throws on non-ok response', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ message: 'Invalid API key' }),
    });

    await expect(service.provisionAccount(42, 'user@example.com')).rejects.toThrow(
      'Invalid API key',
    );
  });

  it('throws on network error', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

    await expect(service.provisionAccount(42, 'user@example.com')).rejects.toThrow('Network error');
  });

  it('throws when N8N is not configured', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'N8N_BASE_URL') return 'https://api.snapshot.andrescortes.dev';
      return undefined;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [N8nService, { provide: ConfigService, useValue: configService }],
    }).compile();

    const unconfigured = module.get(N8nService);

    await expect(unconfigured.provisionAccount(42, 'user@example.com')).rejects.toThrow(
      'N8N provisioning is not configured',
    );
  });
});