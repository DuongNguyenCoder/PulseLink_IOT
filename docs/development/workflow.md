# Development Workflow

## Local prerequisites
- Node.js and npm compatible with the pinned dependencies. Verify with
  `node --version` and `npm --version`.
- Docker Desktop with Docker Compose when running database-backed integration
  checks.
- Redis is required for distributed login-limiter integration checks; the
  repository test compose file provisions an isolated loopback service.
- ESP-IDF PowerShell with ESP-IDF `v5.5.5` on `PATH` for firmware builds.
- Dependencies already installed. The baseline scripts do not install
  dependencies or change system environment state.

The repository root is the working directory for the wrapper scripts. Backend
commands run from `server/api`; firmware commands run from `firmware/esp32`.

## Start PostgreSQL
From `D:\project-PulseLink\infrastructure\docker`:
```powershell
docker compose up -d
docker compose ps
docker compose logs -f postgres
```

## API setup
From `D:\project-PulseLink\server\api`:
```powershell
npm install
npm run typecheck
npm run build
npm run dev
```

## Quality gates
- `npm run typecheck`
- `npm run build`
- `npm test` (Vitest; integration tests may be skipped when their database
  prerequisites are unavailable)
- `npx prisma validate` after schema/config changes
- `npx prisma generate` after schema changes
- There is currently no `lint` or `format:check` script in `server/api`; this is
  recorded as a tooling gap, not a passing check.

To run the repeatable non-destructive backend checks from the repository root:

```powershell
.\scripts\Invoke-BackendBaseline.ps1
```

The wrapper exits non-zero when an executed check fails. It exits with code 2
when all configured checks pass but an expected check is not configured.

## Redis rate-limit integration

From the repository root, start only the isolated Redis test service:

```powershell
$env:POSTGRES_TEST_PASSWORD="isolated-test-only"
docker compose -f infrastructure/docker/compose.test.yaml up -d redis-test
```

From `server/api`, run the Redis integration test with
`PULSELINK_REDIS_INTEGRATION_TESTS=1` and
`REDIS_TEST_URL=redis://127.0.0.1:6380`. Production must use a managed TLS
Redis URL, `LOGIN_RATE_LIMIT_BACKEND=redis`, a unique namespace and a
secret-manager-provided HMAC key. Never place those production values in
source or documentation.

## Firmware build

Open the ESP-IDF PowerShell for ESP-IDF `v5.5.5`, then from the repository root:

```powershell
idf.py --version
.\scripts\Invoke-FirmwareBuild.ps1
```

The wrapper verifies the exact ESP-IDF version and runs only `idf.py build`.
It never flashes, erases, monitors, resets a board or accesses a COM port.

## Database changes
1. Edit `prisma/schema.prisma`.
2. Run `npx prisma format` and `npx prisma validate`.
3. Run `npx prisma generate`.
4. Run `npx prisma migrate dev --name <meaningful_name>` only on local development DB.
5. Inspect the new SQL under `prisma/migrations/`.
6. Commit schema and migration together.
Never edit an already-applied migration to change its meaning.

## Agent handoff format
Every agent should finish with:
- Summary
- Files changed
- Commands run and actual results
- Tests not run and why
- Assumptions / risks
- Suggested next step
