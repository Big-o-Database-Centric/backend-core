import { executeStoredProcedure, type SpResult } from "@/db/sqlserver";
import type {
  IUserRepository,
  UpsertOAuthUserParams,
  FindByProviderParams,
} from "@/domain/contracts/IUserRepository";
import type { User } from "@/domain/entities";

function mapUserRow(r: Record<string, unknown>): User {
  return {
    id: String(r.id || r.user_id || ""),
    email: r.email ? String(r.email) : null,
    name: r.name ? String(r.name) : null,
    avatar: r.avatar ? String(r.avatar) : null,
    provider: String(r.provider || ""),
    provider_account_id: String(r.provider_account_id || ""),
    created_at: new Date(String(r.created_at ?? "")),
    last_login_at: r.last_login_at ? new Date(String(r.last_login_at)) : null,
  };
}

export class SqlServerUserRepository implements IUserRepository {
  async upsertOAuthUser(params: UpsertOAuthUserParams): Promise<User> {
    const result: SpResult = await executeStoredProcedure(
      "sp_UpsertOAuthUser",
      params as unknown as Record<string, unknown>,
    );
    if (!result.rows.length) {
      throw new Error("sp_UpsertOAuthUser no devolvió filas");
    }
    return mapUserRow(result.rows[0]);
  }

  async findByProvider(params: FindByProviderParams): Promise<User | null> {
    const result: SpResult = await executeStoredProcedure(
      "sp_FindUserByProvider",
      params as unknown as Record<string, unknown>,
    );
    if (!result.rows.length) return null;
    return mapUserRow(result.rows[0]);
  }

  async findById(id: string): Promise<User | null> {
    const result: SpResult = await executeStoredProcedure("sp_FindUserById", {
      user_id: id,
    });
    if (!result.rows.length) return null;
    return mapUserRow(result.rows[0]);
  }

  async updateLastLogin(id: string): Promise<void> {
    await executeStoredProcedure("sp_UpdateLastLogin", { user_id: id });
  }
}