import { Injectable, InternalServerErrorException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ProvisionN8nRequest {
  external_user_ref: string;
  email: string;
}

export interface ProvisionN8nResponse {
  account_id: string;
  status: string;
  access_type: string;
  credential: string;
}

const DEFAULT_N8N_BASE_URL = 'https://api.snapshot.andrescortes.dev';

@Injectable()
export class N8nService {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = (this.config.get<string>('N8N_BASE_URL') ?? DEFAULT_N8N_BASE_URL).replace(/\/$/, '');
    this.apiKey = this.config.get<string>('N8N_API_KEY')?.trim() || undefined;
  }

  async provisionAccount(userId: number, email: string): Promise<ProvisionN8nResponse> {
    if (!this.apiKey) {
      throw new ServiceUnavailableException('N8N provisioning is not configured');
    }

    const body: ProvisionN8nRequest = {
      external_user_ref: String(userId),
      email,
    };

    const response = await fetch(`${this.baseUrl}/n8n/external/provision`, {
      method: 'POST',
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new InternalServerErrorException(
        errorBody.message ?? `N8N provisioning failed: ${response.status} ${response.statusText}`,
      );
    }

    return response.json() as Promise<ProvisionN8nResponse>;
  }
}