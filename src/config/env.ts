import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  AUTH_SECRET: z
    .string()
    .min(32)
    .default("build-only-secret-32-chars-long-ok-here"),
  AUTH_TRUST_HOST: z
    .string()
    .optional()
    .default("true")
    .transform((v) => v !== "false"),

  AUTH_GOOGLE_ID: z.string().optional().default(""),
  AUTH_GOOGLE_SECRET: z.string().optional().default(""),

  AUTH_GITHUB_ID: z.string().optional().default(""),
  AUTH_GITHUB_SECRET: z.string().optional().default(""),

  SQL_SERVER_HOST: z.string().default("not-configured"),
  SQL_SERVER_PORT: z.coerce.number().default(1433),
  SQL_SERVER_USER: z.string().default("not-configured"),
  SQL_SERVER_PASSWORD: z.string().default("not-configured"),
  SQL_SERVER_DATABASE: z.string().default("not-configured"),
  SQL_SERVER_ENCRYPT: z
    .string()
    .optional()
    .default("true")
    .transform((v) => v === "true"),
  SQL_SERVER_TRUST_SERVER_CERT: z
    .string()
    .optional()
    .default("false")
    .transform((v) => v === "true"),
  SQL_SERVER_POOL_MAX: z.coerce.number().default(10),
  SQL_SERVER_REQUEST_TIMEOUT: z.coerce.number().default(30000),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("[env] Variables de entorno inválidas:");
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error("Configuración de entorno inválida");
  }
  return parsed.data;
}

export const env = loadEnv();