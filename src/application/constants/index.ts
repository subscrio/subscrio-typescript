/**
 * Application constants to avoid magic numbers and strings
 */

// Display name constraints
export const MAX_DISPLAY_NAME_LENGTH = 255;
export const MIN_DISPLAY_NAME_LENGTH = 1;

// Key constraints
export const MAX_KEY_LENGTH = 255;
export const MIN_KEY_LENGTH = 1;

// Description constraints
export const MAX_DESCRIPTION_LENGTH = 1000;

// Pagination defaults
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;
export const MIN_PAGE_SIZE = 1;

// Search constraints
export const MAX_SEARCH_LENGTH = 255;

// Feature value constraints
export const MAX_FEATURE_VALUE_LENGTH = 1000;

// Subscription limits
export const MAX_SUBSCRIPTIONS_PER_CUSTOMER = 100;

// Cache settings
export const PLAN_CACHE_SIZE = 1000;

// Performance settings
export const BATCH_SIZE = 50;
export const QUERY_TIMEOUT = 60000; // 60 seconds
export const CONNECTION_TIMEOUT = 30000; // 30 seconds
