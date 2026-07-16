import type { AuthSession } from "@/domain/entities";

export interface ISessionRepository {
  create(params: CreateSessionParams): Promise<AuthSession>;
  findBySessionId(sessionId: string): Promise<AuthSession | null>;
  revoke(sessionId: string): Promise<void>;
}

export interface CreateSessionParams {
  user_id: string;
  provider: string;
  ip_address: string | null;
  user_agent: string | null;
  expires_at: Date;
}

export interface IAuditRepository {
  log(params: CreateAuditLogParams): Promise<void>;
}

export interface CreateAuditLogParams {
  user_id: string | null;
  action: string;
  target: string | null;
  ip_address: string | null;
  details: string | null;
}