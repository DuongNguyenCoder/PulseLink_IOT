# PulseLink rules

The repository root `AGENTS.md` is the canonical source of truth.
For backend/API changes, also read `server/api/AGENTS.md` and `.agents/skills/pulselink-development/SKILL.md`.

- Preserve the agreed architecture and pinned major versions.
- Inspect before editing; avoid unrelated refactors.
- Validate external input with Zod and use Fastify's Pino logger.
- Never expose secrets or run destructive database commands without explicit approval.
- Add tests and update docs for behavior changes.
- Report only commands and tests actually executed.
