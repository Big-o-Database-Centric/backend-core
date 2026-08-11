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

  const configWithKey = (apiKey: string | undefined) => ({
    getOrThrow: jest.fn().mockReturnValue(apiKey),
    get: jest.fn().mockReturnValue('https://ia.polyrepo.andrescortes.dev'),
  }) as unknown as ConfigService;

  const configWithMissingKey = (detail: string) => ({
    getOrThrow: jest.fn(() => {
      throw new Error(detail);
    }),
    get: jest.fn().mockReturnValue('https://ia.polyrepo.andrescortes.dev'),
  }) as unknown as ConfigService;

  const validResponse = () => new Response(JSON.stringify({
    choices: [{ message: { role: 'assistant', content: 'Hola' } }],
    usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    provider = new PolyServiceAiProvider(configWithKey('test-secret'));
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends the fixed model and secret authorization only upstream', async () => {
    fetchMock.mockResolvedValue(validResponse());

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

  it('replaces missing-key lookup details with only the fixed safe message', () => {
    const originalDetail = 'configuration backend leaked detail';
    let thrown: unknown;

    try {
      new PolyServiceAiProvider(configWithMissingKey(originalDetail));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('POLYSERVICE_AI_KEY is required');
    expect(String(thrown)).not.toContain(originalDetail);
  });

  it.each([
    ['empty', ''],
    ['whitespace-only', '   '],
  ])('rejects a %s API key during construction without exposing it', (_label, apiKey) => {
    expect(() => new PolyServiceAiProvider(configWithKey(apiKey)))
      .toThrow('POLYSERVICE_AI_KEY is required');
  });

  it('trims an otherwise valid API key before sending it upstream', async () => {
    provider = new PolyServiceAiProvider(configWithKey('  spaced-secret  '));
    fetchMock.mockResolvedValue(validResponse());

    await provider.chat(input);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer spaced-secret' }),
      }),
    );
  });

  it.each([
    [429, 'quota'], [401, 'credential'], [403, 'credential'], [504, 'timeout'], [502, 'upstream'], [500, 'upstream'],
  ])('maps upstream %i to %s', async (status, code) => {
    fetchMock.mockResolvedValue(new Response('{}', { status }));

    await expect(provider.chat(input)).rejects.toMatchObject({ code, providerStatus: status });
  });

  it('maps aborts to timeout', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));

    await expect(provider.chat(input)).rejects.toMatchObject({ code: 'timeout' });
  });

  it.each(['AbortError', 'TimeoutError'])(
    'preserves a post-header %s body-read failure as timeout',
    async (name) => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockRejectedValue(Object.assign(new Error('body read failed'), { name })),
      } as unknown as Response);

      await expect(provider.chat(input)).rejects.toMatchObject({
        code: 'timeout',
        providerStatus: 200,
      });
    },
  );

  it('measures post-header timeout latency through the body-read failure', async () => {
    jest.spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_010)
      .mockReturnValueOnce(1_080);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockRejectedValue(Object.assign(new Error('body stalled'), {
        name: 'TimeoutError',
      })),
    } as unknown as Response);

    await expect(provider.chat(input)).rejects.toMatchObject({
      code: 'timeout',
      providerStatus: 200,
      latencyMs: 80,
    });
  });

  it('measures successful latency after response body parsing', async () => {
    jest.spyOn(Date, 'now')
      .mockReturnValueOnce(2_000)
      .mockReturnValueOnce(2_020)
      .mockReturnValueOnce(2_090);
    fetchMock.mockResolvedValue(validResponse());

    await expect(provider.chat(input)).resolves.toMatchObject({ latencyMs: 90 });
  });

  it('retains time-to-headers latency for a non-OK response', async () => {
    jest.spyOn(Date, 'now')
      .mockReturnValueOnce(3_000)
      .mockReturnValueOnce(3_030)
      .mockReturnValueOnce(3_090);
    fetchMock.mockResolvedValue(new Response('{}', { status: 504 }));

    await expect(provider.chat(input)).rejects.toMatchObject({
      code: 'timeout',
      providerStatus: 504,
      latencyMs: 30,
    });
  });

  it('maps a non-timeout body-read failure to invalid response', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockRejectedValue(new SyntaxError('malformed JSON')),
    } as unknown as Response);

    await expect(provider.chat(input)).rejects.toMatchObject({
      code: 'invalid_response',
      providerStatus: 200,
    });
  });

  it('rejects an invalid success payload without leaking the key', async () => {
    fetchMock.mockResolvedValue(new Response('{"choices":[]}', { status: 200 }));

    const error = await provider.chat(input).catch((value: unknown) => value);

    expect(error).toMatchObject({ code: 'invalid_response' });
    expect(String(error)).not.toContain('test-secret');
  });
});
