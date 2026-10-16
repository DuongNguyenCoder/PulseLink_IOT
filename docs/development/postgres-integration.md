# PostgreSQL integration test environment

PulseLink uses a dedicated PostgreSQL Compose service for integration tests.
It is intentionally separate from the development service:

- Container: `pulselink-postgres-test`
- Host port: `127.0.0.1:5434`
- Database: `pulselink_test`
- User: `pulselink_test_app`
- Volume: `pulselink_test_postgres_data`
- Network: `pulselink-test-network`

The development database remains on port `5433` in `compose.yaml`. Do not
change that service or point test commands at the development database.

## Start the test service

Set `POSTGRES_TEST_PASSWORD` in the local environment without printing it,
then run from `server/api`:

```powershell
npm run db:test:up
npm run db:test:ps
```

The local `TEST_DATABASE_URL` must use the dedicated test user, port `5434`,
and the canonical `pulselink_test` database or a name beginning with
`pulselink_test_`. The integration guard
must pass before any migration or test command is allowed to write data.

Run migration and integration tests only after the guard has verified the
target. Prisma commands that need a URL should receive the test URL through
the process environment; do not edit `.env` and do not fall back to
`DATABASE_URL`.

The default workflow does not reset, truncate, seed, drop the database, or
remove the test volume. Any cleanup must be a separate, explicitly reviewed
operation scoped to the test container and volume.
