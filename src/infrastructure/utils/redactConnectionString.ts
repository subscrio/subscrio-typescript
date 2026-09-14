/**
 * Redact passwords from database connection strings for logs.
 */
export function redactConnectionString(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    if (url.password) {
      url.password = '***';
    }
    return url.toString();
  } catch {
    return connectionString
      .replace(/:(?:[^:@/]+)@/g, ':***@')
      .replace(/(Password|Pwd)=([^;]+)/gi, '$1=***');
  }
}
