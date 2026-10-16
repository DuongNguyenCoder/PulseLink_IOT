import { describe, expect, it } from 'vitest';
import { assertCurrentAccountAccess, UnauthenticatedError } from './account-access.js';

const token = {
  accountId: 'account-1',
  authVersion: 2,
  tokenId: 'token-1',
  issuedAt: 1,
  expiresAt: 2,
  kid: 'key-1',
};

function reader(status: 'PENDING' | 'ACTIVE' | 'DISABLED', authVersion: number) {
  return {
    account: {
      findUnique: async () => ({ status, authVersion }),
    },
  };
}

describe('authoritative account access', () => {
  it('accepts a current active account with the matching authVersion', async () => {
    await expect(assertCurrentAccountAccess(reader('ACTIVE', 2), token)).resolves.toEqual({
      status: 'ACTIVE',
      authVersion: 2,
    });
  });

  it.each([
    ['disabled account', reader('DISABLED', 2)],
    ['stale authVersion', reader('ACTIVE', 3)],
  ])('rejects %s', async (_name, accountReader) => {
    await expect(assertCurrentAccountAccess(accountReader, token)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  it('allows a current pending account so sensitive-resource gates can apply separately', async () => {
    await expect(assertCurrentAccountAccess(reader('PENDING', 2), token)).resolves.toEqual({
      status: 'PENDING',
      authVersion: 2,
    });
  });

  it('rejects a missing account without revealing which lookup failed', async () => {
    const missingReader = {
      account: { findUnique: async () => null },
    };
    await expect(assertCurrentAccountAccess(missingReader, token)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });
});
