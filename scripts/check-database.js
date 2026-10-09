import 'dotenv/config';
import { existsSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

// Output only fixed statuses and validated Prisma codes, never connection metadata.
const target = process.argv.includes('--test') ? 'TEST_DATABASE_URL' : 'DATABASE_URL';
const raw = process.env[target];
const status = message => console.log(message);
const fail = (error, fallback = 'CONNECTION_CHECK_FAILED') => {
  const candidate = error?.errorCode || error?.code;
  const code = typeof candidate === 'string' && /^P[0-9]{4}$/.test(candidate) ? candidate : fallback;
  console.error(code);
  process.exitCode = 1;
};

status(existsSync('.env') ? 'ENV_FILE_PRESENT' : 'ENV_FILE_ABSENT');
status(process.argv.includes('--test') ? 'TEST_TARGET_SELECTED' : 'APPLICATION_TARGET_SELECTED');
status(process.env.AUTH_SECRET?.length >= 32 ? 'AUTH_SECRET_CONFIGURED' : 'AUTH_SECRET_NOT_CONFIGURED');
status(process.env.SEED_ADMIN_EMAIL ? 'SEED_EMAIL_SUPPLIED' : 'SEED_EMAIL_ABSENT');
status(process.env.SEED_ADMIN_PASSWORD ? 'SEED_PASSWORD_SUPPLIED' : 'SEED_PASSWORD_ABSENT');

if (!raw) {
  fail(null, 'CONNECTION_CONFIGURATION_MISSING');
} else {
  try {
    const url = new URL(raw);
    if (!/^postgres(ql)?:$/.test(url.protocol)) throw new Error();
    // Preserve parsing checks without exposing decoded connection identity.
    decodeURIComponent(url.pathname.slice(1));
    decodeURIComponent(url.username);
    status('CONNECTION_CONFIGURATION_VALID');
    status(url.password ? 'PASSWORD_SUPPLIED' : 'PASSWORD_ABSENT');
    const tls = url.searchParams.get('sslmode');
    status(tls === 'require' ? 'TLS_REQUIRED' : tls === 'prefer' ? 'TLS_PREFERRED' : tls === 'disable' ? 'TLS_DISABLED' : tls === null ? 'TLS_NOT_EXPLICITLY_CONFIGURED' : 'TLS_MODE_UNRECOGNIZED');
  } catch {
    fail(null, 'CONNECTION_CONFIGURATION_INVALID');
  }

  if (!process.exitCode) {
    let db;
    try {
      db = new PrismaClient({ datasourceUrl: raw, log: [] });
      const tables = await db.$transaction(async tx => {
        // Fail closed if read-only mode is unsupported; no SELECT runs first.
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await tx.$queryRaw`SELECT current_database() AS database, current_user AS username`;
        return tx.$queryRaw`SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename IN ('Admin', 'AdminSession', 'Project', 'TrackingRecord', '_prisma_migrations') ORDER BY tablename`;
      });
      // Prisma closes the transaction on success and rolls it back on failure.
      status('CONNECTION_CHECK_PASSED');
      const present = new Set(tables.map(row => row.tablename));
      for (const [table, found, missing] of [
        ['Admin', 'ADMIN_TABLE_PRESENT', 'ADMIN_TABLE_ABSENT'],
        ['AdminSession', 'ADMIN_SESSION_TABLE_PRESENT', 'ADMIN_SESSION_TABLE_ABSENT'],
        ['Project', 'PROJECT_TABLE_PRESENT', 'PROJECT_TABLE_ABSENT'],
        ['TrackingRecord', 'TRACKING_RECORD_TABLE_PRESENT', 'TRACKING_RECORD_TABLE_ABSENT'],
        ['_prisma_migrations', 'MIGRATION_TABLE_PRESENT', 'MIGRATION_TABLE_ABSENT'],
      ]) status(present.has(table) ? found : missing);
    } catch (error) {
      fail(error);
    } finally {
      if (db) {
        try { await db.$disconnect(); }
        catch (error) { fail(error, 'CONNECTION_CLEANUP_FAILED'); }
      }
    }
  }
}
