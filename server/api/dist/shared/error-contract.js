function asErrorLike(error) {
    return typeof error === "object" && error !== null
        ? error
        : {};
}
function getStatusCode(error) {
    return typeof error.statusCode === "number" ? error.statusCode : 500;
}
export function mapErrorToApiResponse(error, requestId) {
    const errorLike = asErrorLike(error);
    const statusCode = getStatusCode(errorLike);
    const isValidation = errorLike.code === "FST_ERR_VALIDATION" ||
        errorLike.validation !== undefined;
    if (isValidation) {
        return {
            statusCode: 400,
            response: {
                error: {
                    code: "VALIDATION_ERROR",
                    message: "Request validation failed",
                    requestId,
                },
            },
        };
    }
    if (errorLike.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") {
        return {
            statusCode: 415,
            response: {
                error: {
                    code: "UNSUPPORTED_MEDIA_TYPE",
                    message: "Unsupported request media type",
                    requestId,
                },
            },
        };
    }
    const mapped = (() => {
        switch (statusCode) {
            case 400:
                return { code: "BAD_REQUEST", message: "Bad request" };
            case 401:
                return {
                    code: "UNAUTHENTICATED",
                    message: "Authentication required",
                };
            case 403:
                return { code: "FORBIDDEN", message: "Access denied" };
            case 404:
                return { code: "NOT_FOUND", message: "Resource not found" };
            case 409:
                return {
                    code: "CONFLICT",
                    message: "Request conflicts with current state",
                };
            case 413:
                return {
                    code: "PAYLOAD_TOO_LARGE",
                    message: "Request payload is too large",
                };
            case 415:
                return {
                    code: "UNSUPPORTED_MEDIA_TYPE",
                    message: "Unsupported request media type",
                };
            case 429:
                return { code: "RATE_LIMITED", message: "Too many requests" };
            case 503:
                return {
                    code: "DEPENDENCY_UNAVAILABLE",
                    message: "A required dependency is unavailable",
                };
            default:
                return {
                    code: "INTERNAL_SERVER_ERROR",
                    message: "An unexpected error occurred",
                };
        }
    })();
    return {
        statusCode: statusCode >= 400 && statusCode < 600 ? statusCode : 500,
        response: {
            error: {
                code: mapped.code,
                message: mapped.message,
                requestId,
            },
        },
    };
}
