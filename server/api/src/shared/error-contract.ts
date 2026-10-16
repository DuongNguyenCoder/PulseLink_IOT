export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'DEPENDENCY_UNAVAILABLE'
  | 'INTERNAL_SERVER_ERROR'
  | 'BAD_REQUEST';

export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode;
    message: string;
    requestId: string;
  };
}

interface ErrorLike {
  code?: unknown;
  statusCode?: unknown;
  validation?: unknown;
}

function asErrorLike(error: unknown): ErrorLike {
  return typeof error === 'object' && error !== null
    ? (error as ErrorLike)
    : {};
}

function getStatusCode(error: ErrorLike): number {
  return typeof error.statusCode === 'number' ? error.statusCode : 500;
}

export function mapErrorToApiResponse(
  error: unknown,
  requestId: string,
): { statusCode: number; response: ApiErrorResponse } {
  const errorLike = asErrorLike(error);
  const statusCode = getStatusCode(errorLike);
  const isValidation =
    errorLike.code === 'FST_ERR_VALIDATION' || errorLike.validation !== undefined;

  if (isValidation) {
    return {
      statusCode: 400,
      response: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          requestId,
        },
      },
    };
  }

  const mapped = (() => {
    switch (statusCode) {
      case 400:
        return { code: 'BAD_REQUEST', message: 'Bad request' } as const;
      case 401:
        return { code: 'UNAUTHENTICATED', message: 'Authentication required' } as const;
      case 403:
        return { code: 'FORBIDDEN', message: 'Access denied' } as const;
      case 404:
        return { code: 'NOT_FOUND', message: 'Resource not found' } as const;
      case 409:
        return { code: 'CONFLICT', message: 'Request conflicts with current state' } as const;
      case 413:
        return { code: 'PAYLOAD_TOO_LARGE', message: 'Request payload is too large' } as const;
      case 429:
        return { code: 'RATE_LIMITED', message: 'Too many requests' } as const;
      case 503:
        return { code: 'DEPENDENCY_UNAVAILABLE', message: 'A required dependency is unavailable' } as const;
      default:
        return { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' } as const;
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
