# Device event ingestion

The MVP device event endpoint is:

```text
POST /v1/device-events
Authorization: Bearer <operational-device-token>
Content-Type: application/json
```

The bearer token is issued during device provisioning. `deviceKey` is an identifier, not a credential, and the event body does not accept a device or Store identifier.

## Request

```json
{
  "eventId": "0199aabb-ccdd-7eef-8123-456789abcdef",
  "type": "BUTTON_PRESSED",
  "occurredAt": "2026-10-15T14:00:00.000Z",
  "firmwareVersion": "0.1.0",
  "rssiDbm": -60,
  "payload": { "button": "main" }
}
```

`eventId` must be a UUID. `occurredAt` is retained as the device-provided UTC instant; `receivedAt` is always assigned from server time. `firmwareVersion` is limited to 40 characters, RSSI is an integer from -200 through 100, and the JSON object payload is limited to 32 KiB. Unknown fields are rejected.

## Responses

Successful responses use the repository business response envelope:

- `201` with `status: "accepted"` for the first durable insert.
- `200` with `status: "already_accepted"` for an equivalent retry with the same `eventId` and device.
- `409` for reuse of an `eventId` with different meaning, or an event ID belonging to another device.
- `400` for schema validation failures.
- `401` for a missing, invalid, revoked or disabled device credential.
- `500`/`503` for persistence failures; these responses never acknowledge an uncommitted event.

Idempotency is enforced by the PostgreSQL unique constraint on `DeviceEvent.eventId`. The service attempts the insert first, then handles only the matching unique conflict by loading and comparing the existing row. It does not use a check-then-insert race-prone guard. No notification is sent synchronously by this endpoint.

## Development verification

From `server/api`:

```powershell
npx prisma validate
npx prisma generate
npm run typecheck
npm run build
npm test
```

PostgreSQL integration tests require the dedicated test service and fail-closed `PULSELINK_INTEGRATION_TESTS=1`, `NODE_ENV=test`, and `TEST_DATABASE_URL` settings described in `docs/development/postgres-integration.md`. Do not point them at the development database or reset a shared database.
