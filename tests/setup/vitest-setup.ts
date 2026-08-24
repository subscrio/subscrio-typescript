// Vitest setup file - runs before each test file
import { Subscrio } from '../../src/index.js';

// Declare global test database variables
// These are set by the global setup
declare global {
  var __TEST_DB_NAME__: string;
  var __TEST_CONNECTION_STRING__: string;
  var subscrio: Subscrio;
}

