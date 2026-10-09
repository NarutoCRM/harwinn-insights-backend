import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const target = process.env.TEST_DATABASE_URL;
if (!target) throw new Error('TEST_DATABASE_URL is required; no fallback to the application database');
try { const url = new URL(target); if (!/^postgres(ql)?:$/.test(url.protocol)) throw new Error(); }
catch { throw new Error('Invalid TEST_DATABASE_URL; its value is withheld'); }
const cli = fileURLToPath(new URL('../node_modules/prisma/build/index.js', import.meta.url));
const result = spawnSync(process.execPath, [cli, 'migrate', 'deploy'], {
  env: { ...process.env, DATABASE_URL: target },
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  encoding: 'utf8',
  timeout: 120000,
});
// Withhold CLI output because error output can contain connection details.
if (result.error || result.status !== 0) {
  console.error('Test database migration failed. Run npm run db:check -- --test and inspect server logs.');
  process.exitCode = 1;
} else console.log('Committed migrations applied successfully to TEST_DATABASE_URL.');
