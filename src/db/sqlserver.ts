import sql, { type ConnectionPool, type ISqlType, type IResult, type IRecordSet } from "mssql";
import { env } from "@/config/env";

type SqlTypeFactory = () => ISqlType;

const sqlTypesByJsType: Record<string, SqlTypeFactory> = {
  string: sql.NVarChar as unknown as SqlTypeFactory,
  number: sql.Int as unknown as SqlTypeFactory,
  boolean: sql.Bit as unknown as SqlTypeFactory,
  bigint: sql.BigInt as unknown as SqlTypeFactory,
  date: sql.DateTime2 as unknown as SqlTypeFactory,
};

function resolveSqlType(value: unknown): SqlTypeFactory {
  if (value instanceof Date) return sql.DateTime2 as unknown as SqlTypeFactory;
  if (typeof value === "bigint") return sql.BigInt as unknown as SqlTypeFactory;
  const t = typeof value;
  return sqlTypesByJsType[t] ?? (sql.NVarChar as unknown as SqlTypeFactory);
}

let pool: ConnectionPool | null = null;

export async function getPool(): Promise<ConnectionPool> {
  if (pool && pool.connected) return pool;
  if (pool && pool.connecting) {
    await pool.connect();
    return pool;
  }

  pool = new sql.ConnectionPool({
    server: env.SQL_SERVER_HOST,
    port: env.SQL_SERVER_PORT,
    user: env.SQL_SERVER_USER,
    password: env.SQL_SERVER_PASSWORD,
    database: env.SQL_SERVER_DATABASE,
    options: {
      encrypt: env.SQL_SERVER_ENCRYPT,
      trustServerCertificate: env.SQL_SERVER_TRUST_SERVER_CERT,
      enableArithAbort: true,
    },
    pool: {
      max: env.SQL_SERVER_POOL_MAX,
      min: 0,
      idleTimeoutMillis: 30000,
    },
  });

  pool.on("error", (err) => {
    console.error("[mssql] pool error:", err);
    pool = null;
  });

  await pool.connect();
  return pool;
}

export type SpParam = Record<string, unknown>;

export interface SpOutputParam {
  type: "output";
  sqlType?: SqlTypeFactory;
}

export interface SpResult {
  rows: Record<string, unknown>[];
  rowsAffected: number[];
  returnValue: unknown;
  output: Record<string, unknown>;
}

function createRequest(conn: ConnectionPool, timeout: number) {
  const req = conn.request();
  (req as unknown as { overrides: { requestTimeout: number } }).overrides = {
    requestTimeout: timeout,
  };
  return req;
}

function isOutputParam(v: unknown): v is SpOutputParam {
  return typeof v === "object" && v !== null && (v as SpOutputParam).type === "output";
}

export async function executeStoredProcedure(
  procedureName: string,
  params: SpParam = {},
): Promise<SpResult> {
  const conn = await getPool();
  const req = createRequest(conn, env.SQL_SERVER_REQUEST_TIMEOUT);
  req.verbose = false;

  for (const [name, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (isOutputParam(value)) {
      req.output(name, value.sqlType ?? (sql.NVarChar as unknown as SqlTypeFactory));
    } else {
      const sqlType = resolveSqlType(value);
      req.input(name, sqlType, value);
    }
  }

  const result = await req.execute(procedureName);

  const rs = result.recordsets;
  const firstSet: IRecordSet<unknown>[] = Array.isArray(rs)
    ? rs
    : Object.values(rs) as IRecordSet<unknown>[];
  return {
    rows: (firstSet[0] ?? []) as unknown as Record<string, unknown>[],
    rowsAffected: result.rowsAffected ?? [],
    returnValue: result.returnValue,
    output: result.output,
  };
}

export async function executeView(
  viewName: string,
  where?: SpParam,
): Promise<Record<string, unknown>[]> {
  const conn = await getPool();
  const req = createRequest(conn, env.SQL_SERVER_REQUEST_TIMEOUT);

  let query = `SELECT * FROM ${viewName}`;
  const conditions: string[] = [];
  let i = 0;
  if (where) {
    for (const [name, value] of Object.entries(where)) {
      if (value === undefined) continue;
      const paramId = `p${i++}`;
      req.input(paramId, resolveSqlType(value), value);
      const col = name.replace(/[^\w.]/g, "");
      conditions.push(`${col} = @${paramId}`);
    }
  }
  if (conditions.length) query += " WHERE " + conditions.join(" AND ");

  const result: IResult<unknown> = await req.query(query);
  return result.recordset
    ? (result.recordset as unknown as Record<string, unknown>[])
    : [];
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.close();
    pool = null;
  }
}

export { sql };
