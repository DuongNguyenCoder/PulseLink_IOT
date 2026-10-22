import { randomUUID } from "node:crypto";
import { issueAccessToken, type SigningKeyMaterial } from "./jwt.js";
import {
  createSessionInTransaction,
  type CreatedSession,
  type SessionTransaction,
} from "./session.service.js";
import {
  registerInstallationInTransaction,
  type InstallationDatabase,
} from "../installations/installation.service.js";
import type { FcmKeyMaterial } from "../installations/fcm-crypto.js";

export interface AuthenticationBootstrapTransaction
  extends
    SessionTransaction,
    Omit<InstallationDatabase, "$transaction" | "session" | "auditEvent"> {}

export interface AuthenticationBootstrapDatabase {
  $transaction<T>(
    callback: (transaction: AuthenticationBootstrapTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface AuthenticatedAccount {
  id: string;
  authVersion: number;
}

export interface BootstrapInstallationInput {
  installationId: string;
  platform: "ANDROID" | "IOS" | "WEB";
  fcmToken?: string;
}

export interface BootstrappedAuthentication {
  accessToken: string;
  session: CreatedSession;
}

/**
 * Signs the access token before the transaction but does not return it until
 * the installation/session transaction has committed successfully.
 */
export async function authenticateWithInstallation(
  database: AuthenticationBootstrapDatabase,
  account: AuthenticatedAccount,
  installation: BootstrapInstallationInput,
  fcmKeys: FcmKeyMaterial | undefined,
  signingKey: SigningKeyMaterial,
  now = new Date(),
  requestId?: string,
): Promise<BootstrappedAuthentication> {
  const accessToken = await issueAccessToken(
    { accountId: account.id, authVersion: account.authVersion },
    signingKey,
    now,
  );
  const sessionId = randomUUID();
  const session = await database.$transaction(async (transaction) => {
    await registerInstallationInTransaction(
      transaction as unknown as InstallationDatabase,
      account.id,
      installation,
      fcmKeys,
      now,
      requestId,
    );
    return createSessionInTransaction(
      transaction as unknown as SessionTransaction,
      {
        sessionId,
        accountId: account.id,
        appInstallationId: installation.installationId,
      },
      now,
    );
  });

  return { accessToken, session };
}
