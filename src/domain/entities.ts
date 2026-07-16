export interface User {
  id: string;
  email: string | null;
  name: string | null;
  avatar: string | null;
  provider: string;
  provider_account_id: string;
  created_at: Date;
  last_login_at: Date | null;
}

export interface AuthSession {
  session_id: string;
  user_id: string;
  provider: string;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
  expires_at: Date;
}

export interface AuditLog {
  audit_id: string;
  user_id: string | null;
  action: string;
  target: string | null;
  ip_address: string | null;
  details: string | null;
  created_at: Date;
}