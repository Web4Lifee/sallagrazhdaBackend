import { z } from 'zod';

/** Reads "true"/"false"/"1"/"0" style env values. */
const bool = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

/** Comma-separated list, e.g. "https://a.com,https://b.com". */
const list = z
  .string()
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.url()));

/**
 * TRUST_PROXY: which reverse proxies may set X-Forwarded-For (used for rate limits and logs).
 * "false" (default: direct connections), or a comma-separated list of proxy IPs / CIDRs /
 * presets ("loopback", "linklocal", "uniquelocal"). Behind the bundled Caddy use "uniquelocal"
 * (Docker's private network) — safe only because the API port is not published to the internet.
 */
const trustProxy = z.string().transform((v, ctx): false | string[] => {
  const value = v.trim().toLowerCase();
  if (value === '' || value === 'false' || value === '0') return false;
  if (value === 'true' || /^\d+$/.test(value)) {
    ctx.addIssue({
      code: 'custom',
      message:
        'Use proxy IPs/CIDRs or "uniquelocal" instead of "true" or a hop count (those let clients fake their IP)',
    });
    return z.NEVER;
  }
  return value.split(',').map((s) => s.trim());
});

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Human-readable logs for `npm run dev` (needs the pino-pretty dev dependency). JSON otherwise. */
  LOG_PRETTY: bool.default(false),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  /** "disable" for the bundled Docker database, "require" or "verify-full" for a managed database. */
  DATABASE_SSL: z.enum(['disable', 'require', 'verify-full']).default('disable'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

  /** Browser origins allowed to call the API (only needed for the web build of the app). */
  CORS_ORIGINS: list.default([]),
  TRUST_PROXY: trustProxy.default(false),

  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /** Requests per minute per IP across the whole API. */
  RATE_LIMIT_MAX: z.coerce.number().int().min(10).max(100_000).default(300),
  /** Failed-or-not login attempts allowed per IP per 15 minutes. */
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(1000).default(10),

  /** Start seasons automatically when their start date arrives (like the app does). */
  AUTO_START_SEASONS: bool.default(true),
  SEASON_CHECK_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(1440).default(60),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  const config = parsed.data;

  if (config.NODE_ENV === 'production') {
    // Refuse to run in production with the placeholder secrets from the example files.
    if (/change[_-]?me|localdev/i.test(config.DATABASE_URL)) {
      throw new Error('DATABASE_URL still contains a placeholder password. Set a strong, unique password.');
    }
    if (config.CORS_ORIGINS.some((o) => o.startsWith('http://') && !o.startsWith('http://localhost'))) {
      throw new Error('CORS_ORIGINS must use https:// in production.');
    }
  }

  return {
    env: config.NODE_ENV,
    isProduction: config.NODE_ENV === 'production',
    host: config.HOST,
    port: config.PORT,
    logLevel: config.LOG_LEVEL,
    logPretty: config.LOG_PRETTY && config.NODE_ENV !== 'production',
    database: {
      url: config.DATABASE_URL,
      ssl: config.DATABASE_SSL,
      poolMax: config.DATABASE_POOL_MAX,
    },
    corsOrigins: config.CORS_ORIGINS,
    trustProxy: config.TRUST_PROXY,
    sessionTtlDays: config.SESSION_TTL_DAYS,
    rateLimitMax: config.RATE_LIMIT_MAX,
    loginRateLimitMax: config.LOGIN_RATE_LIMIT_MAX,
    autoStartSeasons: config.AUTO_START_SEASONS,
    seasonCheckIntervalMinutes: config.SEASON_CHECK_INTERVAL_MINUTES,
  };
}
