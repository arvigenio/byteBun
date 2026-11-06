// Builds the SQL Server connection string Prisma's CLI (migrate) needs, from the DB_* variables,
// so DB settings are defined once. Values are wrapped in {} so symbols like ; or = in the
// password are passed through safely.
// Also imported by prisma.config.ts, so keep it dependency-free.
const wrap = (value: string) => `{${String(value).replace(/}/g, '}}')}}`;

export function buildDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const { DB_HOST, DB_PORT = '1433', DB_NAME, DB_USER, DB_PASSWORD } = env;
  if (!DB_HOST || !DB_NAME || !DB_USER || !DB_PASSWORD) return undefined;
  const trust = ['1', 'true', 'yes', 'on'].includes(String(env.DB_TRUST_SERVER_CERT ?? 'true').toLowerCase());
  return [
    `sqlserver://${DB_HOST}:${DB_PORT}`,
    `database=${wrap(DB_NAME)}`,
    `user=${wrap(DB_USER)}`,
    `password=${wrap(DB_PASSWORD)}`,
    'encrypt=true',
    `trustServerCertificate=${trust}`,
  ].join(';');
}
