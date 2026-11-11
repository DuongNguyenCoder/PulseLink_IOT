# WP6 Integration / E2E release checklist

This checklist is the handoff for owner validation. It does not claim that
hardware, real FCM delivery or mobile E2E has been independently verified by
the current agent.

## Components

- Backend: `server/api`, Node.js/TypeScript/Fastify, PostgreSQL and the FCM
  worker.
- Android diagnostic harness: `apps/android-fcm-test/owner`. It supports sign
  up/sign in, Store creation/listing, QR/manual Device ID entry, Owner claim,
  provisioning session creation, SoftAP commissioning, Device status polling,
  FCM installation registration, and Store invitation issue/inspect/accept.
- Firmware: `firmware/esp32`, ESP-IDF `v5.5.5`, target `esp32s3`.
- `apps/mobile` is intentionally not implemented in WP6; it remains the WP7
  production React Native application location.

## Backend API map

Authentication:

- `POST /v1/auth/signup`
- `POST /v1/auth/login`
- `GET /v1/auth/me`
- `POST /v1/auth/refresh`
- `POST /v1/auth/logout`

Store and Device:

- `POST /v1/stores`
- `GET /v1/stores`
- `GET /v1/stores/:storeId`
- `POST /v1/stores/:storeId/devices`
- `GET /v1/stores/:storeId/devices`
- `POST /v1/stores/:storeId/device-claims`
- `POST /v1/stores/:storeId/device-claims/:claimSessionId/complete`
- `POST /v1/stores/:storeId/provisioning-sessions`
- `GET /v1/stores/:storeId/provisioning-sessions/:sessionId`
- `POST /v1/devices/:deviceId/provisioning-sessions/:sessionId/redeem`
- `GET /v1/device-status` (Device bearer credential)
- `POST /v1/device-events` (Device bearer credential)

Invitations and installations:

- `POST /v1/stores/:storeId/invitations`
- `GET /v1/stores/:storeId/invitations`
- `GET /v1/stores/:storeId/invitations/:invitationId`
- `POST /v1/stores/:storeId/invitations/:invitationId/revoke`
- `POST /v1/stores/:storeId/invitations/:invitationId/resend`
- `POST /v1/invitations/inspect`
- `POST /v1/invitations/accept`
- `POST /v1/installations/`
- `GET /v1/installations/`
- `DELETE /v1/installations/:installationId`

Invitation creation returns the one-time plaintext token at issuance so the
owner can transfer it to the intended recipient in this test harness. The
backend stores only the SHA-256 hash. No email delivery is claimed by WP6.

## Owner validation flow

1. Start the API and worker with test-only configuration. Verify `/health/live`
   and `/health/ready`.
2. Build and install the current diagnostic APK. Set the HTTPS API base URL.
3. Create Account A, complete the existing email verification step, sign in,
   and confirm that the app registers an active Android AppInstallation.
4. Create a Store and refresh the Store list. Confirm the creating Account is
   `OWNER` through the Store response/admin evidence.
5. Put the ESP32 into GPIO5 commissioning. Scan its QR or enter the canonical
   `pl-` Device ID. Complete the Owner claim proof, create a provisioning
   session, connect to the matching SoftAP, and submit Wi-Fi credentials.
6. Confirm the app waits for backend Device status rather than treating local
   SoftAP success as online.
7. Press GPIO4 once. Confirm the API accepts the authenticated event and the
   notification worker delivers to Account A's active installation.

## Invitation validation flow

1. Account A creates a `STAFF` invitation for Account B's email. Copy the
   one-time token from the issuance response/UI; do not put it in logs or
   tickets.
2. Sign in as Account B on a second installation (or after signing out) and
   paste the token into **Inspect invitation**.
3. Confirm the displayed Store and role are correct, then select **Accept
   invitation**.
4. Refresh Stores and verify Account B has active `StoreMembership.role=STAFF`.
5. Confirm B can receive eligible Store notifications after registering its
   AppInstallation, but cannot use Owner-only invitation or Device claim APIs.
6. Revoke/suspend B and verify later notifications are not queued for or sent
   to that installation. Test expiry, revoke, resend and repeated accept.

## Required failure cases

- Wrong Device ID/proof, already claimed Device and duplicate claim.
- Wrong Wi-Fi password, SoftAP timeout, phone Internet handoff timeout and
  device offline.
- Wrong invitation email, expired/revoked invitation, token replay and
  concurrent acceptance.
- Invalid FCM token, inactive installation, multiple installations and
  cross-Store isolation.

## Status template

| Check | Owner result | Evidence / notes |
|---|---|---|
| Sign up / verify / sign in | NOT TESTED | |
| Create Store / Owner membership | NOT TESTED | |
| Device claim with physical proof | NOT TESTED | Hardware required |
| GPIO5 SoftAP provisioning | NOT TESTED | Hardware required |
| Device online/status | NOT TESTED | Hardware required |
| GPIO4 event ingestion | NOT TESTED | Hardware required |
| Real FCM push | NOT TESTED | Firebase/device required |
| Invitation inspect/accept | NOT TESTED | Two Accounts required |
| STAFF authorization boundary | NOT TESTED | |
| Revoke/expire/resend | NOT TESTED | |

## Current limitations

- The Android harness is an integration diagnostic, not a production mobile
  UI. `apps/mobile` is reserved for WP7.
- The current agent has not flashed or operated an ESP32, joined a real SoftAP,
  pressed GPIO4/GPIO5, or observed FCM delivery.
- PostgreSQL integration tests are guarded and may be skipped when the test
  database/Redis prerequisites are unavailable. Report the actual command
  result rather than treating a skip as a pass.
