# Feature modules

Suggested shape for a non-trivial feature:

```text
modules/device-events/
  device-events.routes.ts
  device-events.schemas.ts
  device-events.service.ts
  device-events.test.ts
```

Start with fewer files for a small feature. Split routes, schema and service when the logic warrants it.
