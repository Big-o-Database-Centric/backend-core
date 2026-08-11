import { ConfigService } from '@nestjs/config';
import { PolyServiceAiProvider } from './polyservice-ai.provider';

describe('PolyServiceAiProvider', () => {
  const input = {
    messages: [{ role: 'user' as const, content: 'Hola' }],
    maxTokens: 64,
  };
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;
  let provider: PolyServiceAiProvider;

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    const config = {
      getOrThrow: jest.fn().mockReturnValue('test-secret'),
      get: jest.fn().mockReturnValue('https://ia.polyrepo.andrescortes.dev'),
    } as unknown as ConfigService;
    provider = new PolyServiceAiProvider(config);
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('sends the fixed model and secret authorization only upstream', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'Hola' } }],
      usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const result = await provider.chat(input);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://ia.polyrepo.andrescortes.dev/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-secret' }),
        body: JSON.stringify({ model: 'llama-8b-nvidia', messages: [{ role: 'user', content: 'Hola' }], max_tokens: 64, stream: false }),
      }),
    );
    expect(result.message.content).toBe('Hola');
  });

  it.each([
    [429, 'quota'], [401, 'credential'], [403, 'credential'], [502, 'upstream'], [500, 'upstream'],
  ])('maps upstream %i to %s', async (status, code) => {
    fetchMock.mockResolvedValue(new Response('{}', { status }));

    await expect(provider.chat(input)).rejects.toMatchObject({ code, providerStatus: status });
  });

  it('maps aborts to timeout', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));

    await expect(provider.chat(input)).rejects.toMatchObject({ code: 'timeout' });
  });

  it('rejects an invalid success payload without leaking the key', async () => {
    fetchMock.mockResolvedValue(new Response('{"choices":[]}', { status: 200 }));

    const error = await provider.chat(input).catch((value: unknown) => value);

    expect(error).toMatchObject({ code: 'invalid_response' });
    expect(String(error)).not.toContain('test-secret');
  });
});
