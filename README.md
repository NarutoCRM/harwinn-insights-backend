# HARWINN INSIGHTS backend

Node.js (22+), Express 5, PostgreSQL and Prisma 6.12. JavaScript ES modules. Backend only.

## Setup

1. Install Node.js 22+ and PostgreSQL. Create a database and a least-privileged application role; use a separate migration role where supported. Production connections should use TLS with certificate validation as required by your PostgreSQL provider.
2. Run `npm ci` (the lockfile is included). Copy `.env.example` to `.env` and provide your database URL and a random AUTH_SECRET of at least 32 characters. Generate a random secret in your local password manager and save it directly in `.env`; do not print it or share it in chat. Never commit it.
3. Run `npm run prisma:validate`, `npm run prisma:generate` and `npm run db:migrate`. The committed initial migration includes PostgreSQL constraints and indexes. For later schema changes use `npm run db:dev -- --name change_name` in development, inspect SQL, then deploy committed migrations using `db:migrate`.
4. In development only, set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (12+ characters), run `npm run db:seed`, then remove these seed variables. The seed creates no default credentials, leaves an existing password untouched and refuses production. Provision production admins through a reviewed deployment procedure using the same password helper.
5. Run `npm test` and `npm run dev` (or `npm start`).

## Tables

- Admin: UUID, unique normalized email, salted scrypt password hash, active flag, creation time.
- AdminSession: UUID, HMAC digest of a random bearer token, admin foreign key, expiry, creation time. Raw tokens are returned once and never stored. Logout revokes a session; inactive admins cannot authenticate. Schedule deletion of expired sessions operationally.
- Project: UUID, unique external PID, name, active flag, creation time.
- TrackingRecord: BIGSERIAL unique serial (JSON string), project foreign key, UID, optional username, outcome enum, optional in-time, server out-time, nullable LOI in seconds, network IP (INET), nullable country, transaction ID and server creation time. PID is resolved through Project, avoiding inconsistent duplicated PIDs. Project deletion is restricted while records exist.

## APIs

| Method | Path | Access / behavior |
| --- | --- | --- |
| GET | /health | Process liveness |
| GET | /ready | Database connectivity; 503 on database errors |
| POST | /api/auth/login | Email/password; returns random bearer token and expiry |
| GET | /api/auth/me | Bearer admin session |
| POST | /api/auth/logout | Bearer session; revokes token, 204 |
| POST | /api/projects | Bearer session; JSON `{pid,name}` |
| GET | /api/projects | Bearer session; page, pageSize |
| GET | /api/records | Bearer session; exact filters pid, uid, status, country; from/to ISO timestamps (inclusive createdAt range); page, pageSize |
| GET or POST | /redirect/:pid/:status | Public callback foundation; GET query or POST JSON |

Statuses are case-sensitive COMPLETE, TERMINATE, QUOTAFUL and DISQUALIFY. Our initial API accepts `uid` and `transactionId` (required), `username` and `inTime` (optional). IDs are 1–128 characters, begin with an alphanumeric character and allow letters, digits, underscore, dot, colon, @ and hyphen. These are our contract choices, not assumptions about a client's contract. Duplicate query values, unknown parameters and malformed timestamps are rejected. Missing path segments return 404; missing/invalid input IDs return 400; unknown/inactive PID returns 404. A project must exist before receiving callbacks.

Example after provisioning project PID DEMO:

```sh
curl 'http://localhost:3000/redirect/DEMO/COMPLETE?uid=respondent-1&transactionId=transaction-1'
```

Without a configured destination, success returns JSON with the outcome and record (201 for a new row, 200 for identical retries). Every outcome uses the same route pattern. Configure REDIRECT_PARAM_MAP to map our four logical fields to agreed external parameter names. PID and status remain route parameters; other client layouts require a reviewed adapter once supplied. No external redirect happens by default. OUTCOME_URLS may configure a fixed HTTPS URL for each outcome with percent-encoded placeholders `{pid}`, `{uid}`, `{status}`, `{transactionId}`; after persistence the response is 303. Request-supplied destination URLs are rejected. Confirm these optional redirect semantics with the client before enabling them.

A unique database constraint on (projectId, transactionId) prevents duplicates including concurrent requests. The same transaction ID can exist in different projects. Identical UID/status/username/in-time retries return the original row; changed data returns 409. Changed IP/country on a retry does not alter the original metadata. A transaction ID is mandatory: the caller must provide a stable value for retries. There is no assumed one-record-per-UID rule or assumed transition between outcomes.

Out-time and createdAt are server timestamps; in-time is caller-provided, validated and cannot be in the future. LOI is the floored elapsed number of seconds and remains null without in-time. The server cannot verify caller-reported start time: add a server start-event contract if authoritative LOI is required. All timestamps use timestamptz and ISO output; date filters use createdAt.

## Security and deployment

Passwords use asynchronous scrypt with random 16-byte salts, N=32768, r=8, p=1 and timing-safe comparison. Tokens expire and are stored as keyed digests; changing AUTH_SECRET invalidates existing tokens. Require HTTPS in production. Tokens are bearer credentials; future dashboard storage and cross-origin policy must be designed with the frontend. No permissive CORS configuration or cookie authentication is added.

Helmet headers, bounded JSON bodies, strict validation, request IDs, centralized sanitized errors and IP-based rate limits are enabled. Logs contain method, generated request ID and response status, excluding query strings, body, credentials and IP metadata. ORM queries are parameterized; readiness uses a fixed tagged SQL query. IP comes from Express's network peer by default; X-Forwarded-For is ignored unless TRUST_PROXY explicitly lists your proxy IPs/CIDRs. Your edge must overwrite forwarded headers. Do not set blanket proxy trust. Client IP/country parameters are rejected. Country is null by default; createApp accepts a server-owned countryResolver(ip) using an approved reliable lookup source, not arbitrary request headers. Resolver failure or invalid output leaves country null.

Rate limits use an in-memory store and must be replaced with a shared store for multiple instances. Tune limits to approved respondent throughput and proxy topology. No public registration or password reset is included. Public callback authentication is deliberately unspecified: do not expose callbacks to untrusted traffic for production reporting until client authenticity rules are agreed. The server cannot prove the reported outcome without that contract. Set retention, access, backups and monitoring for respondent identifiers/IPs before production.

## Verification

`npm test` runs HTTP/service/security tests with a fake repository. The PostgreSQL integration test is opt-in and skips unless TEST_DATABASE_URL is set. To verify persistence against a disposable test database, first apply migrations with DATABASE_URL pointing to it, then set TEST_DATABASE_URL to the same URL and run `npm run test:db`. Tests insert uniquely named projects and delete only their own rows; no database reset is performed. Use a disposable database anyway. Integration coverage includes every enum value, timing constraints, project isolation and concurrent unique enforcement. Unit tests inject database failures; they do not prove actual connection-failure handling.

Prisma CLI is a development dependency pinned with the matching client. Migration/build jobs need development dependencies installed (`npm ci --include=dev`); generate the client before pruning development dependencies for runtime. Prisma 6.12 is pinned to avoid advisories in the newer 6.x CLI dependency tree; review both packages together before upgrading.

## Client details pending

Confirm external parameter names and transport/path layout; PID provisioning; ID character rules; stable retry transaction identifier and scope; whether repeated outcomes or status transitions are allowed; start-time provenance/LOI units; callback signatures or other authenticity verification; destination URL formats and redirect method; reliable country provider and proxy topology; expected throughput; data retention; dashboard token/CORS policy. No client credentials or callback rules have been invented.

## Implementation verification (2026-10-09)

- Node v24.20.0; Prisma schema validation and client generation (6.12.0) passed.
- Generated Prisma migration SQL was reviewed against the committed schema migration; additional timing/country CHECK constraints are intentional.
- Final `npm test`: 20 passed, 0 failed, 1 PostgreSQL integration test skipped because TEST_DATABASE_URL was absent.
- Online `npm audit --json`: zero reported vulnerabilities across installed dependencies.
- Local migration attempt using the example URL reached localhost:5432 but failed with P1000 authentication failure. No valid DATABASE_URL or TEST_DATABASE_URL was supplied; no migration was applied and PostgreSQL persistence/constraints remain unverified. Supply valid credentials, run migrations and the opt-in database test before deployment.

## Local PostgreSQL connection diagnosis and setup

Read-only checks on 2026-10-09 found PostgreSQL 18 service `postgresql-x64-18` running, listening on port 5432 on IPv4 and IPv6. The installed `pg_hba.conf` requires `scram-sha-256` for local/loopback connections. Recent server logs explicitly show that role `USER` does not exist. The previous P1000 failure used example credentials, not a configured application login. No `.env` or inherited DATABASE_URL/TEST_DATABASE_URL was present during diagnosis. Whether database `harwinn` exists remains unknown until authenticated catalog queries can run.

The example URL targets host `localhost`, port `5432`, database `harwinn`, username `USER` and schema `public`. Its password is a placeholder. The application and Prisma load DATABASE_URL from the environment / `.env`, never automatically from `.env.example`. Already-set process variables take precedence over the file. The database authentication method is determined by PostgreSQL's rules, not Prisma. Keep SCRAM enabled; do not switch to trust authentication or reset existing passwords to work around this failure.

Check the service and readiness without supplying credentials:

```powershell
Get-Service postgresql-x64-18
& 'C:\Program Files\PostgreSQL\18\bin\pg_isready.exe' -h localhost -p 5432
```

Use your existing administrator login for read-only catalog checks. The password prompt is hidden; do not put a password on the command line:

```powershell
$pgAdminRole = Read-Host 'Existing PostgreSQL administrator role'
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -h localhost -p 5432 -U $pgAdminRole -d postgres -W
```

At the psql prompt:

```sql
SELECT rolname, rolcanlogin FROM pg_roles ORDER BY rolname;
SELECT datname, pg_get_userbyid(datdba) AS owner
FROM pg_database WHERE datname IN ('harwinn', 'harwinn_test');
```

Use an existing suitable role/database when available. If the checks confirm they are absent, the following is an optional development setup; `harwinn_app` is a suggested new role name, not an assumed existing login. Run only the statements for resources confirmed absent. Do not change an existing role's password or replace a database:

```sql
CREATE ROLE harwinn_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
-- Only for the newly created role, set its new password using psql's hidden prompt:
\password harwinn_app
CREATE DATABASE harwinn OWNER harwinn_app;
CREATE DATABASE harwinn_test OWNER harwinn_app;
```

Development database ownership permits migrations. Production should separate migration and runtime privileges. Existing databases require appropriate CONNECT and schema/object privileges; inspect their owners and grants rather than changing them blindly.

Create the local file only if absent, then edit it privately:

```powershell
if (!(Test-Path -LiteralPath .env)) { Copy-Item -LiteralPath .env.example -Destination .env }
notepad .env
```

Supply valid DATABASE_URL using the verified role/password/database, AUTH_SECRET, SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (12+ characters), and TEST_DATABASE_URL pointing to the disposable `harwinn_test` database. Percent-encode reserved characters in URL credentials locally. Do not share or echo URLs or secrets. The development seed requires both explicitly supplied values, refuses NODE_ENV=production and never overwrites an existing admin password.

After configuration, from the project directory:

```powershell
npm run db:check
npm run db:check -- --test
npm run prisma:validate
npm run prisma:generate
npm run db:migrate
npm run db:seed
npm run db:migrate:test
npm test
npm run test:db
```

The db:check command runs SELECTs in an explicitly read-only transaction and reports only fixed configuration/connection/table statuses and sanitized error codes. It does not print hostnames, usernames, database names or raw errors. It never prints raw connection URLs, password values or authentication secrets. db:migrate:test requires TEST_DATABASE_URL and has no fallback to DATABASE_URL. It applies only committed migrations, with no reset/drop. The integration test creates uniquely named fixtures through the API, confirms persistence through a separate database client and checks duplicate protection both within and across projects. It removes only fixtures created by that test. It does not use or change the seeded admin.

`.env` and `.env.*` are covered by .gitignore; .env.example is explicitly included. No Git repository was initialized in this directory at diagnosis, so Git tracking state could not be verified. Once using Git, `git check-ignore .env` should print .env, and `git ls-files -- .env` must be empty. Ignore rules do not untrack a file already committed.

No database credentials, authentication rules, existing roles/passwords, databases or client redirect settings were changed during diagnosis. Migrations, seeding and live integration verification remain pending until valid local configuration is supplied.

## Backend verification follow-up

Prisma CLI and Client remain pinned to 6.12.0. Supabase connections should explicitly use sslmode=require and sslaccept=strict; preserve other connection parameters. If additional certificate trust is required, configure the certificate locally instead of disabling verification. Rotate any exposed AUTH_SECRET privately; rotation invalidates existing sessions. Remove development seed credentials after provisioning.

Project CRUD now includes UUID lookup, PID/name/active updates and deletion of empty projects. PID can be edited while the internal UUID and tracking history are preserved; projects with tracking records return 409 on deletion. Existing migrations and schema are unchanged.

Latest verification: Prisma validation passed; 21 unit tests passed with no failures. The live read-only connection check returned sanitized P1001, so seeding and live integration verification were not performed. Existing integration tests were extended for health/readiness, project CRUD, filtering and logout; they continue to use uniquely identified fixtures and delete only those fixtures. Configure an isolated, already migrated TEST_DATABASE_URL before running test:db; never reset an existing database.

## Vercel backend deployment

The root index.js exports the existing Express app as one Vercel Node.js function. src/server.js remains the local listener. Prisma connects lazily, with one client per warm instance and no per-request disconnect.

Settings: Root Directory is the repository directory containing this package.json (use . if HARWINN is the repository root; HARWINN if the repository contains that folder). Framework Preset: Express. Install Command: npm ci --include=dev. Build Command: npm run build. Output Directory: leave unset; there is no static dist directory. Choose Node.js 22.x or 24.x in Vercel settings.

Required environment variables: DATABASE_URL and a privately rotated, random AUTH_SECRET of at least 32 characters. Set NODE_ENV=production. Optional: SESSION_TTL_HOURS (default 8), REDIRECT_PARAM_MAP, OUTCOME_URLS, TRUST_PROXY. PORT is for local startup only. Do not upload seed credentials or TEST_DATABASE_URL to production. Set environment variables separately for Production and Preview; previews should use an isolated database.

For Prisma 6.12 serverless use an external PostgreSQL pooler and a bounded connection_limit (start with 1, then tune for concurrency and database capacity). Preserve other URL parameters. A Supabase transaction pooler on port 6543 requires pgbouncer=true with this native Prisma client. A session pooler on 5432 also works but holds database connections per session. Require sslmode=require and sslaccept=strict, and include any required trusted certificate file in the function bundle. Configure deployment URLs privately; local .env is unchanged. Prisma schema, auth, and tracking logic are unchanged.

The build only validates the schema and generates Prisma Client; it never migrates or seeds. Apply committed migrations separately using a reviewed migration connection, not the transaction pooler.

GET /health checks process health; GET /ready checks the database. Login is POST /api/auth/login; GET does not log in. Project and record endpoints require a bearer session. Tracking uses GET or POST /redirect/:pid/:status with required mapped UID and transaction ID; literal /redirect// is invalid.

Import the repository into Vercel, select these settings, configure private environment variables, and deploy a Preview first. Verify /health, /ready, login/logout, protected project/record routes and all four tracking statuses using an isolated preview database before production promotion. Public tracking callbacks may require disabling Preview deployment protection or an explicit supported bypass. No deployment has been performed by this change.

Limitations: in-memory rate limits are per function instance and require a shared store or Vercel Firewall policies for a globally enforced limit. Proxy trust stays disabled unless explicit trusted IPs/CIDRs are configured; do not blindly trust forwarded headers. Cross-origin browser access remains unsupported; use same-origin routing or review a narrowly scoped CORS policy separately.

Project Management workflow: admins add the Project ID and Project Name supplied by the client after sharing the agreed platform/tool link. Multiple projects from the same company may omit PIDs; supplied PIDs must be unique and names are not unique. PATCH /api/projects/:id accepts optional pid, name and active fields and rejects empty or invalid updates. Duplicate PIDs on Add/Edit return 409, backed by the existing unique database constraint. PID edits preserve the project UUID, existing tracking records and project-scoped transaction protection; reports follow the updated PID. Old callback links stop resolving after an ID edit, so share regenerated links. Existing rows are unchanged until an admin explicitly edits them. The optional-PID migration drops only the pid NOT NULL constraint.

Optional Project ID: POST accepts omitted, null, empty or whitespace-only pid and stores NULL. PATCH omission retains the existing PID; explicit null/blank clears it. Supplied IDs retain strict validation and database uniqueness. Tracking requires a real PID, never resolves null/blank to a project, and preserves records via the internal UUID when an ID is cleared.

Before enabling blank IDs, generate the updated Prisma client and apply the committed backward-compatible migration with npm run db:migrate through the existing reviewed migration connection. It changes only Project.pid nullability, retaining existing IDs, the unique index and all records. No migration has been applied by this code change. The opt-in PostgreSQL test now verifies blank-ID creation and edits using a second Prisma client; run it only against an isolated migrated test database.
