/**
 * Application Constants
 *
 * Shared application constants.
 *
 * Central location for all application-wide constants.
 * This improves maintainability and makes values easier to update.
 */

// ============================================================================
// Rate Limiting
// ============================================================================

/**
 * General API rate limit window in milliseconds
 * Default: 15 minutes
 */
export const API_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

/**
 * Maximum requests allowed in the general API rate limit window
 * Default: 100 requests per 15 minutes
 */
export const API_RATE_LIMIT_MAX_REQUESTS = 100;

/**
 * Auth routes rate limit window in milliseconds
 * Default: 15 minutes (stricter than general API)
 */
export const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

/**
 * Maximum requests allowed in the auth rate limit window
 * Default: 5 requests per 15 minutes (prevents brute force)
 */
export const AUTH_RATE_LIMIT_MAX_REQUESTS = 5;

/**
 * Upload rate limit window in milliseconds
 * Default: 1 hour
 */
export const UPLOAD_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

/**
 * Maximum uploads allowed in the upload rate limit window
 * Default: 10 uploads per hour
 */
export const UPLOAD_RATE_LIMIT_MAX_REQUESTS = 10;

// ============================================================================
// Content Length Limits
// ============================================================================

/**
 * Maximum length for note text content
 * Default: 10,000 characters (~2000 words)
 */
export const MAX_NOTE_TEXT_LENGTH = 10000;

/**
 * Minimum length for note text content
 * Default: 1 character (must not be empty)
 */
export const MIN_NOTE_TEXT_LENGTH = 1;

/**
 * Maximum length for bookmark URL
 * Default: 2048 characters (browser URL limit)
 */
export const MAX_BOOKMARK_URL_LENGTH = 2048;

/**
 * Maximum length for bookmark title
 * Default: 500 characters
 */
export const MAX_BOOKMARK_TITLE_LENGTH = 500;

/**
 * Maximum length for bookmark description
 * Default: 2000 characters
 */
export const MAX_BOOKMARK_DESCRIPTION_LENGTH = 2000;

/**
 * Maximum length for comment content
 * Default: 5000 characters
 */
export const MAX_COMMENT_LENGTH = 5000;

/**
 * Minimum length for comment content
 * Default: 1 character (must not be empty)
 */
export const MIN_COMMENT_LENGTH = 1;

/**
 * Maximum length for canvas name
 * Default: 200 characters
 */
export const MAX_CANVAS_NAME_LENGTH = 200;

/**
 * Maximum length for template description
 * Default: 500 characters
 */
export const MAX_TEMPLATE_DESCRIPTION_LENGTH = 500;

/**
 * Maximum length for category name
 * Default: 50 characters
 */
export const MAX_CATEGORY_NAME_LENGTH = 50;

/**
 * Maximum length for a single tag
 * Default: 50 characters
 */
export const MAX_TAG_LENGTH = 50;

/**
 * Maximum number of tags per item
 * Default: 20 tags
 */
export const MAX_TAGS_PER_ITEM = 20;

/**
 * Maximum z-index value for canvas items
 * Default: 999,999
 */
export const MAX_ZINDEX = 999999;

/**
 * Maximum URL length
 * Default: 2048 characters (browser URL limit)
 */
export const MAX_URL_LENGTH = 2048;

/**
 * Maximum viewport items limit
 * Default: 1000 items
 */
export const MAX_VIEWPORT_ITEMS = 1000;

// ============================================================================
// Pagination
// ============================================================================

/**
 * Default number of items to return in paginated lists
 * Default: 50 items
 */
export const DEFAULT_PAGE_LIMIT = 50;

/**
 * Maximum number of items to return in paginated lists
 * Default: 100 items (prevents excessive data transfer)
 */
export const MAX_PAGE_LIMIT = 100;

/**
 * Default number of items to return in viewport queries
 * Default: 100 items
 */
export const DEFAULT_VIEWPORT_LIMIT = 100;

/**
 * Maximum number of items to return in viewport queries
 * Default: 500 items
 */
export const MAX_VIEWPORT_LIMIT = 500;

// ============================================================================
// Database & Performance
// ============================================================================

/**
 * Default timeout for database queries in milliseconds
 * Default: 5 seconds
 */
export const DB_QUERY_TIMEOUT_MS = 5000;

/**
 * Default timeout for API requests in milliseconds
 * Default: 10 seconds
 */
export const API_REQUEST_TIMEOUT_MS = 10000;

/**
 * Maximum number of retry attempts for failed operations
 * Default: 3 attempts
 */
export const MAX_RETRY_ATTEMPTS = 3;

/**
 * Initial delay for retry backoff in milliseconds
 * Default: 1 second
 */
export const INITIAL_RETRY_DELAY_MS = 1000;

/**
 * Threshold for slow query logging in milliseconds
 * Default: 1 second
 */
export const SLOW_QUERY_THRESHOLD_MS = 1000;

// ============================================================================
// Autosave
// ============================================================================

/**
 * Debounce delay for autosave in milliseconds
 * Default: 500ms (half second)
 */
export const AUTOSAVE_DEBOUNCE_MS = 500;

/**
 * Timeout for autosave operations in milliseconds
 * Default: 30 seconds
 */
export const AUTOSAVE_TIMEOUT_MS = 30000;

// ============================================================================
// Canvas & UI
// ============================================================================

/**
 * Minimum width for canvas items in pixels
 * Default: 200px
 */
export const MIN_CANVAS_ITEM_WIDTH = 200;

/**
 * Minimum height for canvas items in pixels
 * Default: 80px
 */
export const MIN_CANVAS_ITEM_HEIGHT = 80;

/**
 * Default width for new note items in pixels
 * Default: 300px
 */
export const DEFAULT_NOTE_WIDTH = 300;

/**
 * Default height for new note items in pixels
 * Default: 200px
 */
export const DEFAULT_NOTE_HEIGHT = 200;

/**
 * Default width for new bookmark items in pixels
 * Default: 400px
 */
export const DEFAULT_BOOKMARK_WIDTH = 400;

/**
 * Default height for new bookmark items in pixels
 * Default: 150px
 */
export const DEFAULT_BOOKMARK_HEIGHT = 150;

/**
 * Size of resize handles in pixels
 * Default: 8px
 */
export const RESIZE_HANDLE_SIZE = 8;

/**
 * Size of delete button in pixels
 * Default: 20px
 */
export const DELETE_BUTTON_SIZE = 20;

/**
 * Default zoom level for canvas
 * Default: 1.0 (100%)
 */
export const DEFAULT_ZOOM_LEVEL = 1.0;

/**
 * Minimum zoom level for canvas
 * Default: 0.1 (10%)
 */
export const MIN_ZOOM_LEVEL = 0.1;

/**
 * Maximum zoom level for canvas
 * Default: 5.0 (500%)
 */
export const MAX_ZOOM_LEVEL = 5.0;

// ============================================================================
// Security
// ============================================================================

/**
 * Minimum password length
 * Default: 8 characters
 */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Maximum password length
 * Default: 128 characters
 */
export const MAX_PASSWORD_LENGTH = 128;

/**
 * Session token length in characters
 * Default: 16 characters for nanoid
 */
export const SESSION_TOKEN_LENGTH = 16;

/**
 * Request ID length in characters
 * Default: 16 characters for nanoid
 */
export const REQUEST_ID_LENGTH = 16;

// ============================================================================
// Cache & Storage
// ============================================================================

/**
 * Maximum age for CORS preflight cache in seconds
 * Default: 86400 seconds (24 hours)
 */
export const CORS_MAX_AGE_SECONDS = 86400;

/**
 * HTTP Strict Transport Security max age in seconds
 * Default: 31536000 seconds (1 year)
 */
export const HSTS_MAX_AGE_SECONDS = 31536000;

// ============================================================================
// Bundle Size Thresholds
// ============================================================================

/**
 * Maximum total bundle size in KB
 * Default: 3000 KB (3 MB)
 */
export const MAX_TOTAL_BUNDLE_SIZE_KB = 3000;

/**
 * Maximum shared chunks size in KB
 * Default: 500 KB
 */
export const MAX_SHARED_CHUNKS_SIZE_KB = 500;

/**
 * Maximum single page bundle size in KB
 * Default: 250 KB
 */
export const MAX_PAGE_BUNDLE_SIZE_KB = 250;

// ============================================================================
// Real-time Updates & Polling (Issue #31)
// ============================================================================

/**
 * Polling interval for collaborative updates when tab is active
 * Default: 5000ms (5 seconds)
 *
 * This provides near real-time updates for shared canvases without
 * requiring WebSocket infrastructure. Balances responsiveness with
 * server load and API rate limits.
 */
export const POLLING_INTERVAL_ACTIVE_MS = 5000;

/**
 * Polling interval for collaborative updates when tab is inactive
 * Default: 30000ms (30 seconds)
 *
 * Reduced polling frequency when user is not actively viewing the tab.
 * Conserves resources while still maintaining eventual consistency.
 */
export const POLLING_INTERVAL_INACTIVE_MS = 30000;

/**
 * Enable polling for shared canvases
 * Default: true
 *
 * Set to false to disable polling and rely on manual refetches only.
 * Polling provides collaborative updates without WebSocket infrastructure.
 */
export const ENABLE_COLLABORATIVE_POLLING = true;
