# Feature specs

Every non-trivial feature should have a short spec using `feature-template.md` before implementation.

Suggested MVP order (documentation only; runtime status is tracked in the Decision Register):

1. API health and readiness.
2. Owner account, session and app-installation foundation.
3. Device provisioning protocol design and controlled enrollment.
4. Device registration and authentication.
5. Device event ingestion with idempotency.
6. App-installation FCM-token registration.
7. FCM best-effort delivery; transactional outbox is future scope.
8. Firmware HTTPS client with current-session retry behavior; no persistent offline retry queue in the MVP.
9. Operational status / device last-seen.

Do not implement FCM delivery before event ingestion and idempotency are reliable.
