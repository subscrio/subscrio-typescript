// Helper to get test database connection string
export function getTestConnectionString(): string {
  const baseUrl = process.env.TEST_DATABASE_URL || 
    'postgresql://postgres:postgres@localhost:5432/postgres';
  return baseUrl.replace(/\/[^/]*$/, '/subscrio_test');
}

