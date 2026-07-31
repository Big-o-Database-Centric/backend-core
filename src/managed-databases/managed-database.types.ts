export const MANAGED_ENGINES = ['mysql', 'postgresql', 'mongodb', 'sqlserver'] as const;
export type ManagedEngine = (typeof MANAGED_ENGINES)[number];

export interface ManagedDatabaseRecord {
  DatabaseId: number;
  DatabaseName: string;
  Engine: ManagedEngine;
  InstanceId: string;
  HostName: string | null;
  Port: number | null;
  DatabaseUser: string | null;
  QuotaBytes: number;
  State: 'pending' | 'active' | 'deleting' | 'failed' | 'inactive';
  FailureReason: string | null;
  CreatedAt: string;
  ActivatedAt: string | null;
}

export interface ReservationResult {
  Success: boolean;
  Message: string;
  DatabaseId: number | null;
  UserId: number | null;
  Email: string | null;
  InstanceId: string | null;
}

export interface DeleteReservationResult {
  Success: boolean;
  Message: string;
  DatabaseId: number | null;
  Engine: ManagedEngine | null;
  InstanceId: string | null;
}
