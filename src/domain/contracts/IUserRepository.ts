import type { User } from "@/domain/entities";

export interface IUserRepository {
  upsertOAuthUser(params: UpsertOAuthUserParams): Promise<User>;
  findByProvider(params: FindByProviderParams): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  updateLastLogin(id: string): Promise<void>;
}

export interface UpsertOAuthUserParams {
  email: string | null;
  name: string | null;
  avatar: string | null;
  provider: string;
  provider_account_id: string;
}

export interface FindByProviderParams {
  provider: string;
  provider_account_id: string;
}