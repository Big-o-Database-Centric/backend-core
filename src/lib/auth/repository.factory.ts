import type { IUserRepository } from "@/domain/contracts/IUserRepository";
import type { ISessionRepository } from "@/domain/contracts/ISessionRepository";
import type { IAuditRepository } from "@/domain/contracts/ISessionRepository";
import { SqlServerUserRepository } from "@/repositories/SqlServerUserRepository";
import { SqlServerSessionRepository } from "@/repositories/SqlServerSessionRepository";
import { SqlServerAuditRepository } from "@/repositories/SqlServerAuditRepository";

let userRepo: IUserRepository | null = null;
let sessionRepo: ISessionRepository | null = null;
let auditRepo: IAuditRepository | null = null;

export function getUserRepository(): IUserRepository {
  if (!userRepo) userRepo = new SqlServerUserRepository();
  return userRepo;
}

export function getSessionRepository(): ISessionRepository {
  if (!sessionRepo) sessionRepo = new SqlServerSessionRepository();
  return sessionRepo;
}

export function getAuditRepository(): IAuditRepository {
  if (!auditRepo) auditRepo = new SqlServerAuditRepository();
  return auditRepo;
}