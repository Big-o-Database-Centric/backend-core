import {
  HttpException,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';

type ProviderError = {
  error?: {
    code?: string;
    message?: string;
  };
  message?: string;
};

@Injectable()
export class MongodbProvisionService {
  private readonly baseUrl = (
    process.env.MONGODB_PROVISION_API_URL ?? 'https://mongo.szapatar.dev'
  ).replace(/\/$/, '');

  private get apiKey(): string {
    const apiKey = process.env.MONGODB_PROVISION_API_KEY;

    if (!apiKey) {
      throw new InternalServerErrorException({
        error: {
          code: 'MONGODB_API_KEY_NOT_CONFIGURED',
          message: 'MongoDB provisioning is not configured',
        },
      });
    }

    return apiKey;
  }

  async list() {
    const result = await this.request<unknown>('/databases');
    return this.extractItems(result);
  }

  async create(databaseName: string) {
    return this.request('/databases', {
      method: 'POST',
      body: JSON.stringify({ databaseName }),
    });
  }

  async remove(id: string): Promise<void> {
    await this.request(`/databases/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async resetCredentials(id: string) {
    return this.request(
      `/databases/${encodeURIComponent(id)}/credentials/reset`,
      { method: 'POST' },
    );
  }

  async health() {
    return this.request('/health');
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const apiKey = this.apiKey;
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(10_000),
        headers: {
          Accept: 'application/json',
          'X-API-Key': apiKey,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
        },
      });
    } catch {
      throw new ServiceUnavailableException({
        error: {
          code: 'MONGODB_PROVIDER_UNAVAILABLE',
          message: 'MongoDB provisioning service is unavailable',
        },
      });
    }

    const body = await this.parseBody(response);

    if (!response.ok) {
      const providerError = body as ProviderError;
      const code = providerError?.error?.code ?? 'INTERNAL_ERROR';
      const message =
        providerError?.error?.message ??
        providerError?.message ??
        'MongoDB provisioning request failed';

      throw new HttpException({ error: { code, message } }, response.status);
    }

    return body as T;
  }

  private async parseBody(response: Response): Promise<unknown> {
    if (response.status === 204) return undefined;

    const text = await response.text();
    if (!text) return undefined;

    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private extractItems(result: unknown): unknown[] {
    if (Array.isArray(result)) return result;
    if (!result || typeof result !== 'object') return [];

    const body = result as {
      databases?: unknown;
      items?: unknown;
      data?: unknown;
    };

    for (const value of [body.databases, body.items, body.data]) {
      if (Array.isArray(value)) return value;
    }

    return [];
  }
}
