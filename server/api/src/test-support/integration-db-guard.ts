const DEFAULT_ALLOWED_TEST_DATABASE_HOSTS = new Set([
  '127.0.0.1',
  '::1',
  'localhost',
  'postgres-test',
]);

export interface IntegrationDatabaseConfig {
  url: string;
  databaseName: string;
  hostname: string;
}

function getDatabaseName(url: URL): string {
  let databaseName: string;
  try {
    databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  } catch {
    throw new Error('TEST_DATABASE_URL database path is not valid');
  }

  if (!databaseName || databaseName.includes('/')) {
    throw new Error('TEST_DATABASE_URL must contain one database name');
  }

  return databaseName;
}

function normalizeHostname(hostname: string): string {
  const normalized = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1') {
    return 'loopback';
  }
  return normalized;
}

function getEffectivePort(url: URL): string {
  return url.port || '5432';
}

function getDatabaseTarget(url: URL): string {
  const databaseName = getDatabaseName(url);
  return `${normalizeHostname(url.hostname)}:${getEffectivePort(url)}:${databaseName}`;
}

function assertComparableUrlsAreDifferent(
  testUrl: URL,
  developmentUrl: URL,
): void {
  if (getDatabaseTarget(testUrl) === getDatabaseTarget(developmentUrl)) {
    throw new Error('TEST_DATABASE_URL must target a different database');
  }
}

export function assertIntegrationDatabaseEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  allowedHosts: ReadonlySet<string> = DEFAULT_ALLOWED_TEST_DATABASE_HOSTS,
): IntegrationDatabaseConfig {
  if (environment.PULSELINK_INTEGRATION_TESTS !== '1') {
    throw new Error('PULSELINK_INTEGRATION_TESTS=1 is required');
  }

  if (environment.NODE_ENV !== 'test') {
    throw new Error('NODE_ENV=test is required');
  }

  const testDatabaseUrl = environment.TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required');
  }

  let parsedTestUrl: URL;
  try {
    parsedTestUrl = new URL(testDatabaseUrl);
  } catch {
    throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL');
  }

  if (!['postgres:', 'postgresql:'].includes(parsedTestUrl.protocol)) {
    throw new Error('TEST_DATABASE_URL must use a PostgreSQL protocol');
  }

  const normalizedTestHostname = normalizeHostname(parsedTestUrl.hostname);
  const normalizedAllowedHosts = new Set(
    [...allowedHosts].map(normalizeHostname),
  );
  if (!normalizedAllowedHosts.has(normalizedTestHostname)) {
    throw new Error('TEST_DATABASE_URL host is not allowed for integration tests');
  }

  const databaseName = getDatabaseName(parsedTestUrl);
  if (
    databaseName !== 'pulselink_test' &&
    !/^pulselink_test_[a-z0-9_-]+$/.test(databaseName)
  ) {
    throw new Error(
      'TEST_DATABASE_URL database must be pulselink_test or use the pulselink_test_ prefix',
    );
  }

  if (environment.DATABASE_URL) {
    let parsedDatabaseUrl: URL;
    try {
      parsedDatabaseUrl = new URL(environment.DATABASE_URL);
    } catch {
      throw new Error('DATABASE_URL must be valid when supplied');
    }
    assertComparableUrlsAreDifferent(parsedTestUrl, parsedDatabaseUrl);
  }

  return {
    url: testDatabaseUrl,
    databaseName,
    hostname: normalizedTestHostname,
  };
}
