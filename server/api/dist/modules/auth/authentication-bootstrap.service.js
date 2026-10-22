import { randomUUID } from "node:crypto";
import { issueAccessToken } from "./jwt.js";
import { createSessionInTransaction, } from "./session.service.js";
import { registerInstallationInTransaction, } from "../installations/installation.service.js";
/**
 * Signs the access token before the transaction but does not return it until
 * the installation/session transaction has committed successfully.
 */
export async function authenticateWithInstallation(database, account, installation, fcmKeys, signingKey, now = new Date(), requestId) {
    const accessToken = await issueAccessToken({ accountId: account.id, authVersion: account.authVersion }, signingKey, now);
    const sessionId = randomUUID();
    const session = await database.$transaction(async (transaction) => {
        await registerInstallationInTransaction(transaction, account.id, installation, fcmKeys, now, requestId);
        return createSessionInTransaction(transaction, {
            sessionId,
            accountId: account.id,
            appInstallationId: installation.installationId,
        }, now);
    });
    return { accessToken, session };
}
