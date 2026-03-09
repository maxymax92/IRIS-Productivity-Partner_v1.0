import { error } from './response.ts'
import { corsHeaders } from './cors.ts'

// =============================================================================
// Error Types
// =============================================================================

/**
 * Base API error class with structured metadata
 */
export class ApiError extends Error {
  /** Whether the client should retry this request */
  public readonly retryable: boolean
  /** Additional context for debugging (not exposed to client) */
  public readonly context?: Record<string, unknown>

  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    options?: {
      retryable?: boolean
      context?: Record<string, unknown>
    }
  ) {
    super(message)
    this.name = 'ApiError'
    this.retryable = options?.retryable ?? false
    this.context = options?.context
  }
}

/**
 * Rate limiting errors
 */
export class RateLimitError extends ApiError {
  constructor(
    public readonly retryAfterSeconds: number,
    context?: Record<string, unknown>
  ) {
    super(
      'RATE_LIMIT_EXCEEDED',
      `Rate limit exceeded. Please wait ${retryAfterSeconds} seconds.`,
      429,
      { retryable: true, context }
    )
    this.name = 'RateLimitError'
  }
}

/**
 * Validation errors for bad input
 */
export class ValidationError extends ApiError {
  constructor(
    message: string,
    public readonly field?: string,
    context?: Record<string, unknown>
  ) {
    super('VALIDATION_ERROR', message, 400, { retryable: false, context })
    this.name = 'ValidationError'
  }
}

// =============================================================================
// Error Handling
// =============================================================================

/**
 * User-friendly error messages (hide internal details)
 */
const USER_FRIENDLY_MESSAGES: Record<string, string> = {
  AUTH_ERROR: 'Please sign in to continue.',
  EMBEDDING_ERROR: 'Memory search is temporarily unavailable. Please try again later.',
  RATE_LIMIT_EXCEEDED: 'You\'re sending requests too quickly. Please slow down.',
  VALIDATION_ERROR: 'Please check your input and try again.',
  TOOL_ERROR: 'An operation failed. Please try again.',
  NETWORK_ERROR: 'A service is temporarily unavailable. Please try again later.',
  AGENT_ERROR: 'The AI assistant encountered an issue. Please try again.',
  INTERNAL_ERROR: 'Something went wrong. Please try again later.',
  SESSION_NOT_FOUND: 'Session expired. Please start a new conversation.',
  PERMISSION_DENIED: 'You don\'t have permission to perform this action.',
}

/**
 * Get user-friendly message for an error code
 */
function getUserFriendlyMessage(code: string): string {
  return USER_FRIENDLY_MESSAGES[code] ?? 'Something went wrong. Please try again later.'
}

/**
 * Sanitize error for logging (remove sensitive data)
 */
function sanitizeForLogging(err: unknown): Record<string, unknown> {
  if (err instanceof ApiError) {
    return {
      type: err.name,
      code: err.code,
      message: err.message,
      status: err.status,
      retryable: err.retryable,
      // Only include context in logs, not in response
      context: err.context,
    }
  }

  if (err instanceof Error) {
    return {
      type: err.name,
      message: err.message,
      stack: err.stack?.split('\n').slice(0, 5).join('\n'),
    }
  }

  return { type: 'Unknown', value: String(err) }
}

/**
 * Handle errors and return appropriate HTTP response
 *
 * Features:
 * - Structured logging for debugging
 * - User-friendly messages (hides internals)
 * - Retry-After header for rate limits
 * - Proper HTTP status codes
 */
export function handleError(err: unknown): Response {
  // Log full error details for debugging
  console.error('[Edge Error]', JSON.stringify(sanitizeForLogging(err)))

  // Build response headers (include CORS so browsers can read error responses)
  const headers: Record<string, string> = {
    ...corsHeaders,
    'Content-Type': 'application/json',
  }

  // Handle specific error types
  if (err instanceof RateLimitError) {
    headers['Retry-After'] = String(err.retryAfterSeconds)
    return new Response(
      JSON.stringify({
        error: err.code,
        message: getUserFriendlyMessage(err.code),
        retryable: true,
        retryAfterSeconds: err.retryAfterSeconds,
      }),
      { status: err.status, headers }
    )
  }

  if (err instanceof ApiError) {
    return new Response(
      JSON.stringify({
        error: err.code,
        message: getUserFriendlyMessage(err.code),
        retryable: err.retryable,
        // Include original message only for validation errors (helpful for users)
        ...(err instanceof ValidationError && { details: err.message }),
      }),
      { status: err.status, headers }
    )
  }

  if (err instanceof Error) {
    // Check for known error patterns
    const message = err.message.toLowerCase()

    if (message.includes('timeout') || message.includes('timed out')) {
      return error('TIMEOUT', 'Request timed out. Please try again.', 504)
    }

    if (message.includes('network') || message.includes('fetch')) {
      return error('NETWORK_ERROR', getUserFriendlyMessage('NETWORK_ERROR'), 503)
    }

    if (message.includes('unauthorized') || message.includes('authentication')) {
      return error('AUTH_ERROR', getUserFriendlyMessage('AUTH_ERROR'), 401)
    }

    // Generic internal error
    return error('INTERNAL_ERROR', getUserFriendlyMessage('INTERNAL_ERROR'), 500)
  }

  // Unknown error type
  return error('INTERNAL_ERROR', getUserFriendlyMessage('INTERNAL_ERROR'), 500)
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Wrap an async function with error handling
 */
export function withErrorHandling<T extends unknown[], R>(
  fn: (...args: T) => Promise<R>
): (...args: T) => Promise<R | Response> {
  return async (...args: T) => {
    try {
      return await fn(...args)
    } catch (err) {
      return handleError(err)
    }
  }
}

/**
 * Assert a condition, throwing ValidationError if false
 */
export function assertValid(
  condition: boolean,
  message: string,
  field?: string
): asserts condition {
  if (!condition) {
    throw new ValidationError(message, field)
  }
}

/**
 * Assert a value is not null/undefined
 */
export function assertDefined<T>(
  value: T | null | undefined,
  message: string,
  field?: string
): asserts value is T {
  if (value === null || value === undefined) {
    throw new ValidationError(message, field)
  }
}
