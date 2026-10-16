const ALLOWED_METADATA_KEYS = new Set([
    'accountId', 'sessionId', 'installationId', 'previousInstallationId', 'storeId', 'deviceId',
    'keyVersion',
    'platform', 'role', 'reason', 'outcome', 'status', 'previousStatus', 'newStatus',
    'tokenKeyVersion',
]);
const SENSITIVE_KEY_PATTERN = /(password|token|secret|credential|authorization|cookie|cipher|key)/i;
export function sanitizeAuditMetadata(input) {
    const output = {};
    if (input === undefined)
        return output;
    for (const [key, value] of Object.entries(input)) {
        if (!ALLOWED_METADATA_KEYS.has(key) || SENSITIVE_KEY_PATTERN.test(key))
            continue;
        if (value === null || typeof value === 'boolean' || typeof value === 'number') {
            output[key] = value;
        }
        else if (typeof value === 'string') {
            output[key] = value.slice(0, 256);
        }
    }
    return output;
}
export async function writeAuditEvent(database, input) {
    await database.auditEvent.create({
        data: {
            actorType: input.actorType,
            actorId: input.actorId ?? null,
            action: input.action,
            resourceType: input.resourceType,
            resourceId: input.resourceId,
            storeId: input.storeId ?? null,
            occurredAt: input.occurredAt ?? new Date(),
            metadata: sanitizeAuditMetadata(input.metadata),
            requestId: input.requestId ?? null,
        },
    });
}
