import { executeStoredProcedure } from "@/db/sqlserver";
import type {
  ISessionRepository,
  CreateSessionParams,
} from "@/domain/contracts/ISessionRepository";
import type { AuthSession } from "@/domain/entities";

function toRecord(p: CreateSessionParams): Record<string, unknown> {
  return {
    user_id: p.user_id,
    provider: p.provider,
    ip_address: p.ip_address ?? undefined,
    user_agent: p.user_agent ?? undefined,
    expires_at: p.expires_at.toISOString(),
  };
}

export class SqlServerSessionRepository implements ISessionRepository {
  async create(params: CreateSessionParams): Promise<AuthSession> {
    const spParams = toRecord(params);
    const result = await executeStoredProcedure("sp_CreateSession", {
      ...spParams,
      session_id_output: { type: "output" },
    });
    const sessionId = result.output.session_id_output as string | undefined;
    return {
      session_id: sessionId ?? "",
      user_id: params.user_id,
      provider: params.provider,
      ip_address: params.ip_address,
      user_agent: params.user_agent,
      created_at: new Date(),
      expires_at: params.expires_at,
    };
  }

  async findBySessionId(sessionId: string): Promise<AuthSession | null> {
    const result = await executeStoredProcedure("sp_FindSession", {
      session_id: sessionId,
    });
    if (!result.rows.length) return null;
    const r = result.rows[0];
    return {
      session_id: String(r.session_id),
      user_id: String(r.user_id),
      provider: String(r.provider),
      ip_address: r.ip_address ? String(r.ip_address) : null,
      user_agent: r.user_agent ? String(r.user_agent) : null,
      created_at: new Date(String(r.created_at)),
      expires_at: new Date(String(r.expires_at)),
    };
  }

  async revoke(sessionId: string): Promise<void> {
    await executeStoredProcedure("sp_RevokeSession", {
      session_id: sessionId,
    });
  }
}