# ADR-0003: Persistent firmware event queue

- Status: Accepted for WP08 MVP integration
- Date: 2026-10-16

## Decision

The ESP32-S3 stores up to eight button events in a versioned NVS blob before
attempting HTTPS delivery. A generated UUID v4 remains stable through retries.
The local record is removed only after an API `200` or `201` response.

The API's PostgreSQL unique `eventId` constraint remains the idempotency source
of truth. This is at-least-once delivery: a power loss after API commit but
before NVS deletion can cause a duplicate HTTP request, but not a duplicate
durable event.

## Failure policy

Temporary network, timeout, rate-limit and server failures use bounded
exponential backoff with jitter. Authentication, validation and idempotency
conflicts are retained as `blocked` for diagnosis rather than silently
discarded or retried forever. Queue-full presses are rejected visibly and do
not overwrite older records.

TLS uses ESP-IDF's certificate bundle. Device tokens are per-device local
configuration and are never logged or committed.

## Limitations

NVS wear budgeting, secure boot/flash encryption, remote blocked-event replay,
and hardware-specific GPIO/carrier validation remain deployment work. Exactly
once external delivery is not claimed.
