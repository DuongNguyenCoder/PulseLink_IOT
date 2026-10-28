import type { FastifyRequest } from "fastify";
import type { KeyInput } from "jose";
import { createAuthenticationHook } from "../auth/auth-hook.js";
import { ProvisioningError, type EnrollmentActor } from "./provisioning.service.js";

export type OperatorPermission = "DEVICES_READ" | "DEVICES_WRITE";

export interface OperatorGrantDatabase {
  operatorGrant: {
    findFirst(args: unknown): Promise<{
      accountId: string;
      storeId: string;
      status: "ACTIVE" | "REVOKED";
      permissions: OperatorPermission[];
    } | null>;
  };
  device: {
    findUnique(args: unknown): Promise<{ id: string; storeId: string } | null>;
  };
}

export async function requireOperatorPermission(
  db: OperatorGrantDatabase,
  accountId: string,
  storeId: string,
  permission: OperatorPermission,
): Promise<void> {
  const grant = await db.operatorGrant.findFirst({
    where: {
      accountId,
      storeId,
      status: "ACTIVE",
      permissions: { has: permission },
    },
    select: { accountId: true, storeId: true, status: true, permissions: true },
  });
  if (grant === null) throw new ProvisioningError("Access denied", 403);
}

export function createOperatorEnrollmentAuthorizer(
  db: OperatorGrantDatabase,
  verificationKeys: ReadonlyMap<string, KeyInput>,
): (request: FastifyRequest) => Promise<EnrollmentActor> {
  const authenticate = createAuthenticationHook(verificationKeys);
  return async (request): Promise<EnrollmentActor> => {
    await authenticate(request, undefined as never);
    const deviceId = (request.params as { deviceId?: unknown }).deviceId;
    if (typeof deviceId !== "string" || request.auth === undefined) {
      throw new ProvisioningError("Resource not found", 404);
    }

    const device = await db.device.findUnique({
      where: { id: deviceId },
      select: { id: true, storeId: true },
    });
    if (device === null) throw new ProvisioningError("Resource not found", 404);

    await requireOperatorPermission(
      db,
      request.auth.accountId,
      device.storeId,
      "DEVICES_WRITE",
    );
    return { actorId: request.auth.accountId, actorType: "ACCOUNT" };
  };
}
