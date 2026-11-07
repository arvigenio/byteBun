// Builds the PostgreSQL connection string Prisma's CLI (migrate) needs, from the DB_* variables,
// so DB settings are defined once. Each part is URL-encoded, so symbols like @, :, / or # in
// the password are passed through safely.
// Also imported by prisma.config.ts, so keep it dependency-free.
const enc = (value: string) => encodeURIComponent(String(value));

export function buildDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const { DB_HOST, DB_PORT = '5432', DB_NAME, DB_USER, DB_PASSWORD } = env;
  if (!DB_HOST || !DB_NAME || !DB_USER || !DB_PASSWORD) return undefined;
  const ssl = ['1', 'true', 'yes', 'on'].includes(String(env.DB_SSL ?? 'false').toLowerCase());
  return `postgresql://${enc(DB_USER)}:${enc(DB_PASSWORD)}@${DB_HOST}:${DB_PORT}/${enc(DB_NAME)}?sslmode=${ssl ? 'require' : 'disable'}`;
}
