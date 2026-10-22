export const REDACTED_LOG_PATHS = [
    "req.headers.authorization",
    "req.headers.cookie",
    "headers.authorization",
    "headers.cookie",
    "req.body.password",
    "req.body.passwordConfirmation",
    "req.body.resetToken",
    "req.body.refreshToken",
    "req.body.bootstrapSecret",
    "req.body.deviceToken",
    "req.body.fcmToken",
    "req.body.fcmRegistrationToken",
    "req.body.token",
    "body.password",
    "body.passwordConfirmation",
    "body.resetToken",
    "body.refreshToken",
    "body.bootstrapSecret",
    "body.deviceToken",
    "body.fcmToken",
    "body.fcmRegistrationToken",
    "body.token",
];
export function getSafeErrorLogFields(error) {
    if (typeof error !== "object" || error === null) {
        return { errorType: typeof error };
    }
    const candidate = error;
    return {
        errorType: typeof candidate.name === "string" ? candidate.name : "UnknownError",
        ...(typeof candidate.code === "string"
            ? { errorCode: candidate.code }
            : {}),
        ...(typeof candidate.statusCode === "number"
            ? { statusCode: candidate.statusCode }
            : {}),
        ...(candidate.deliveryOutcome === "not-sent" ||
            candidate.deliveryOutcome === "unknown"
            ? { deliveryOutcome: candidate.deliveryOutcome }
            : {}),
        ...(typeof candidate.deliveryCode === "string" &&
            (candidate.deliveryCode.startsWith("SMTP_") ||
                candidate.deliveryCode.startsWith("EMAIL_API_"))
            ? { deliveryCode: candidate.deliveryCode }
            : {}),
    };
}
