import type { VerifiedAccessToken } from './jwt.js';

export class UnauthenticatedError extends Error {
  readonly statusCode = 401;

  constructor() {
    super('Authentication required');
    this.name = 'UnauthenticatedError';
  }
}

export interface AccountAccessRecord {
  status: 'PENDING' | 'ACTIVE' | 'DISABLED';
  authVersion: number;
}

export interface AccountAccessReader {
  account: {
    findUnique(args: {
      where: { id: string };
      select: { status: true; authVersion: true };
    }): Promise<AccountAccessRecord | null>;
  };
}

export async function assertCurrentAccountAccess(
  prisma: AccountAccessReader,
  token: VerifiedAccessToken,
): Promise<AccountAccessRecord> {
  const account = await prisma.account.findUnique({
    where: { id: token.accountId },
    select: { status: true, authVersion: true },
  });

  if (
    account === null ||
    account.status === 'DISABLED' ||
    account.authVersion !== token.authVersion
  ) {
    throw new UnauthenticatedError();
  }

  return account;
}
