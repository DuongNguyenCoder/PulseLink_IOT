import { describe, expect, it } from 'vitest';
import {
  createSession,
  rotateRefreshSession,
  RefreshSessionError,
  type SessionRecord,
} from './session.service.js';

const now = new Date('2026-10-13T12:00:00.000Z');

function database(initial: SessionRecord | null, consumedCount = 1) {
  const calls: unknown[] = [];
  const transaction = {
    session: {
      findUnique: async () => initial,
      create: async (args: unknown) => {
        calls.push(['create', args]);
      },
      updateMany: async (args: unknown) => {
        calls.push(['updateMany', args]);
        return { count: consumedCount };
      },
    },
    auditEvent: {
      create: async (args: unknown) => {
        calls.push(['audit', args]);
      },
    },
  };
  return {
    calls,
    database: { $transaction: async <T>(callback: (tx: typeof transaction) => Promise<T>) => callback(transaction) },
  };
}

describe('session service', () => {
  it('creates a session with the approved idle and absolute TTLs', async () => {
    const fake = database(null);
    const created = await createSession(
      fake.database,
      { sessionId: 'session-1', accountId: 'account-1', appInstallationId: 'installation-1' },
      now,
    );

    expect(created.sessionId).toBe('session-1');
    expect(created.refreshToken).toHaveLength(43);
    expect(created.idleExpiresAt).toEqual(new Date('2026-10-20T12:00:00.000Z'));
    expect(created.absoluteExpiresAt).toEqual(new Date('2026-11-12T12:00:00.000Z'));
  });

  it('conditionally consumes a refresh token before creating its replacement', async () => {
    const fake = database({
      id: 'session-1', accountId: 'account-1', appInstallationId: 'installation-1',
      refreshTokenHash: 'hash', tokenFamilyId: 'family', generation: 0,
      idleExpiresAt: new Date('2026-10-20T12:00:00.000Z'),
      absoluteExpiresAt: new Date('2026-11-12T12:00:00.000Z'),
      rotatedAt: null, revokedAt: null,
      account: { status: 'ACTIVE' }, installation: { status: 'ACTIVE' },
    });
    const result = await rotateRefreshSession(fake.database, 'refresh-token', 'session-2', now);

    expect(result.sessionId).toBe('session-2');
    expect(fake.calls.filter((call) => Array.isArray(call) && call[0] === 'updateMany')).toHaveLength(1);
    expect(fake.calls.filter((call) => Array.isArray(call) && call[0] === 'create')).toHaveLength(1);
  });

  it('revokes all sessions when the conditional rotation loses a race', async () => {
    const fake = database({
      id: 'session-1', accountId: 'account-1', appInstallationId: 'installation-1',
      refreshTokenHash: 'hash', tokenFamilyId: 'family', generation: 0,
      idleExpiresAt: new Date('2026-10-20T12:00:00.000Z'),
      absoluteExpiresAt: new Date('2026-11-12T12:00:00.000Z'),
      rotatedAt: null, revokedAt: null,
      account: { status: 'ACTIVE' }, installation: { status: 'ACTIVE' },
    }, 0);

    await expect(rotateRefreshSession(fake.database, 'refresh-token', 'session-2', now)).rejects.toBeInstanceOf(
      RefreshSessionError,
    );
    expect(fake.calls.filter((call) => Array.isArray(call) && call[0] === 'updateMany')).toHaveLength(2);
  });
});
