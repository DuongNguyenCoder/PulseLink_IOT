import { describe, expect, it } from 'vitest';
import { REDACTED_LOG_PATHS } from './shared/logging.js';

describe('Fastify logging safety contract', () => {
  it('redacts authentication and credential fields without logging request bodies by default', () => {
    expect(REDACTED_LOG_PATHS).toEqual(
      expect.arrayContaining([
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body.password',
        'req.body.refreshToken',
        'req.body.resetToken',
        'req.body.bootstrapSecret',
        'req.body.deviceToken',
        'req.body.fcmToken',
        'req.body.fcmRegistrationToken',
        'req.body.token',
      ]),
    );
    expect(REDACTED_LOG_PATHS).not.toContain('req.body');
  });
});
