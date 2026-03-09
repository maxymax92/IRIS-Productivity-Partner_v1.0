// ── Shared constants ─────────────────────────────────────────────────────────
// Only values shared across 2+ files or backed by env vars belong here.
// Single-use values stay as local `const` in their source file.

/** Duration (ms) the "Copied!" feedback stays visible after clipboard copy */
export const COPY_FEEDBACK_MS = 2000

/** Milliseconds in a minute — used for relative-time calculations */
export const MS_PER_MINUTE = 60_000

/** Milliseconds in a day — used for relative-time calculations */
export const MS_PER_DAY = 86_400_000

/** Supabase Storage bucket for user-owned files (project files and chat attachments) */
export const STORAGE_BUCKET = 'user-files'

/** Maximum items returned from Supabase Storage .list() */
export const FILE_LIST_LIMIT = 1000

/** Default number of git commits to fetch */
export const GIT_LOG_DEFAULT_LIMIT = 20

/** Breakpoint (px) for mobile vs desktop layout detection */
export const MOBILE_BREAKPOINT = 768

/** Maximum character length for auto-generated conversation titles */
export const TITLE_MAX_LENGTH = 60

/** Fallback title length when title generation fails */
export const TITLE_FALLBACK_LENGTH = 50

/** Maximum output tokens for the title generation model call */
export const TITLE_MAX_TOKENS = 20

/** Expiry (seconds) for Supabase Storage signed URLs */
export const SIGNED_URL_EXPIRY_SECONDS =
  Number(process.env['SIGNED_URL_EXPIRY_SECONDS']) > 0
    ? Number(process.env['SIGNED_URL_EXPIRY_SECONDS'])
    : 3600

/** Maximum conversations fetched per page in the sidebar */
export const CONVERSATIONS_PAGE_SIZE = 50

/** Maximum character length for auto-generated conversation summaries */
export const SUMMARY_MAX_LENGTH = 100

/** Pagination page-size options for data tables */
export const PAGE_SIZES = [10, 20, 25, 30, 40, 50] as const
