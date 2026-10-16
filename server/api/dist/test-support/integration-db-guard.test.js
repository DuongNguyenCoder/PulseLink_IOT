import { describe, expect, it } from 'vitest';
import { assertIntegrationDatabaseEnvironment } from './integration-db-guard.js';
const validEnvironment = {
    NODE_ENV: 'test',
    PULSELINK_INTEGRATION_TESTS: '1',
    DATABASE_URL: 'postgresql://app@127.0.0.1:5433/pulselink',
    TEST_DATABASE_URL: 'postgresql://app@127.0.0.1:5433/pulselink_test_unit',
};
describe('integration database guard', () => {
    it('accepts an isolated, allowlisted test database', () => {
        expect(assertIntegrationDatabaseEnvironment(validEnvironment)).toMatchObject({
            databaseName: 'pulselink_test_unit',
            hostname: 'loopback',
        });
    });
    it('accepts the canonical Compose test database name', () => {
        expect(assertIntegrationDatabaseEnvironment({
            ...validEnvironment,
            TEST_DATABASE_URL: 'postgresql://app@127.0.0.1:5434/pulselink_test',
        })).toMatchObject({ databaseName: 'pulselink_test' });
    });
    it.each([
        ['missing integration flag', { PULSELINK_INTEGRATION_TESTS: '0' }],
        ['wrong node environment', { NODE_ENV: 'development' }],
        ['missing test URL', { TEST_DATABASE_URL: undefined }],
        ['same database target', { TEST_DATABASE_URL: validEnvironment.DATABASE_URL }],
        ['unapproved hostname', { TEST_DATABASE_URL: 'postgresql://app@db.example/pulselink_test_unit' }],
        ['unsafe database name', { TEST_DATABASE_URL: 'postgresql://app@127.0.0.1/pulselink' }],
    ])('rejects %s', (_caseName, override) => {
        expect(() => assertIntegrationDatabaseEnvironment({ ...validEnvironment, ...override })).toThrow();
    });
    it('rejects the same host, database and default port despite URL differences', () => {
        expect(() => assertIntegrationDatabaseEnvironment({
            ...validEnvironment,
            DATABASE_URL: 'postgres://app@localhost/pulselink_test_unit?schema=public',
            TEST_DATABASE_URL: 'postgresql://other@localhost:5432/pulselink_test_unit?connect_timeout=2',
        })).toThrow('TEST_DATABASE_URL must target a different database');
    });
    it('rejects loopback hostname aliases targeting the same database', () => {
        expect(() => assertIntegrationDatabaseEnvironment({
            ...validEnvironment,
            DATABASE_URL: 'postgresql://app@127.0.0.1:5433/pulselink_test_unit',
            TEST_DATABASE_URL: 'postgresql://other@localhost:5433/pulselink_test_unit',
        })).toThrow('TEST_DATABASE_URL must target a different database');
    });
    it('supports URL-encoded database names without allowing encoded path separators', () => {
        expect(assertIntegrationDatabaseEnvironment({
            ...validEnvironment,
            TEST_DATABASE_URL: 'postgresql://app@localhost/pulselink_test_%75nit',
        }).databaseName).toBe('pulselink_test_unit');
        expect(() => assertIntegrationDatabaseEnvironment({
            ...validEnvironment,
            TEST_DATABASE_URL: 'postgresql://app@localhost/pulselink_test_unit%2Fother',
        })).toThrow();
    });
    it('does not require or reveal credentials when reporting a failure', () => {
        expect(() => assertIntegrationDatabaseEnvironment({
            ...validEnvironment,
            TEST_DATABASE_URL: 'not-a-url-with-a-secret',
        })).toThrow('TEST_DATABASE_URL must be a valid PostgreSQL URL');
    });
});
