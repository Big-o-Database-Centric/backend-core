import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { CreateAiChatDto } from './dto/create-ai-chat.dto';

describe('AiController', () => {
  const service = {
    capabilities: jest.fn(),
    chat: jest.fn(),
  };
  const controller = new AiController(service as unknown as AiService);

  beforeEach(() => jest.clearAllMocks());

  it('propagates only the session token cookie to capabilities', async () => {
    service.capabilities.mockResolvedValue({
      models: ['llama-8b-nvidia'],
      defaultModel: 'llama-8b-nvidia',
      maxTokens: 512,
      defaultMaxTokens: 256,
      perUser: { perMinute: 3, perDay: 10 },
      remaining: { today: 9 },
    });

    await expect(controller.capabilities({
      cookies: { session_token: 'session-1', provider_key: 'must-not-propagate' },
    } as any)).resolves.toEqual(expect.objectContaining({
      models: ['llama-8b-nvidia'],
      remaining: { today: 9 },
    }));
    expect(service.capabilities).toHaveBeenCalledWith('session-1');
    expect(service.capabilities).toHaveBeenCalledTimes(1);
  });

  it('propagates the session token and validated DTO to chat', async () => {
    const requestDto: CreateAiChatDto = {
      messages: [{ role: 'user', content: 'Hola' }],
      maxTokens: 256,
    };
    service.chat.mockResolvedValue({
      model: 'llama-8b-nvidia',
      message: { role: 'assistant', content: 'Hola' },
      usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 },
      remaining: { today: 9 },
    });

    await expect(controller.chat({
      cookies: { session_token: 'session-1', provider_key: 'must-not-propagate' },
    } as any, requestDto)).resolves.toEqual({
      model: 'llama-8b-nvidia',
      message: { role: 'assistant', content: 'Hola' },
      usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 },
      remaining: { today: 9 },
    });
    expect(service.chat).toHaveBeenCalledWith('session-1', requestDto);
    expect(service.chat).toHaveBeenCalledTimes(1);
  });

  it('uses null when the session cookie is absent', async () => {
    service.capabilities.mockResolvedValue({});
    service.chat.mockResolvedValue({});
    const requestDto: CreateAiChatDto = {
      messages: [{ role: 'user', content: 'Hola' }],
      maxTokens: 256,
    };

    await controller.capabilities({ cookies: {} } as any);
    await controller.chat({} as any, requestDto);

    expect(service.capabilities).toHaveBeenCalledWith(null);
    expect(service.chat).toHaveBeenCalledWith(null, requestDto);
  });

  it('registers the AI controller in the root application module', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider('MSSQL_POOL')
      .useValue({ request: () => ({ input: () => {}, execute: async () => ({ recordset: [] }) }) })
      .overrideProvider(ConfigService)
      .useValue({
        get: (key: string) => `test-${key}`,
        getOrThrow: (key: string) => key === 'DATABASE_CREDENTIALS_KEY'
          ? Buffer.alloc(32, 1).toString('base64')
          : `test-${key}`,
      })
      .compile();

    expect(moduleRef.get(AiController)).toBeInstanceOf(AiController);
    await moduleRef.close();
  });
});
