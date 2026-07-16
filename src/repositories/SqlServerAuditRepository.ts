import { executeStoredProcedure } from "@/db/sqlserver";
import type {
  IAuditRepository,
  CreateAuditLogParams,
} from "@/domain/contracts/ISessionRepository";

export class SqlServerAuditRepository implements IAuditRepository {
  async log(params: CreateAuditLogParams): Promise<void> {
    await executeStoredProcedure("sp_LogAudit", {
      user_id: params.user_id ?? undefined,
      action: params.action,
      target: params.target ?? undefined,
      ip_address: params.ip_address ?? undefined,
      details: params.details ?? undefined,
    });
  }
}