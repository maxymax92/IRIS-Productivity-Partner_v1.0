import { retry, RetryError } from '@std/async'
import { ApiError } from './errors.ts'
import { createLogger } from './logger.ts'

const log = createLogger('retry')

export interface WithRetryOptions {
  maxAttempts?: number
  minTimeout?: number
  multiplier?: number
  jitter?: number
  label?: string
}

/**
 * Check whether an error is transient and worth retrying.
 *
 * - ApiError with `retryable === true` → retry
 * - Generic errors matching transient network patterns → retry
 * - Everything else (auth, validation, 404/410) → do not retry
 */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof ApiError) {
    return err.retryable
  }

  if (err instanceof Error) {
    const msg = err.message.toLowerCase()
    return (
      msg.includes('timeout') ||
      msg.includes('network') ||
      msg.includes('fetch failed') ||
      msg.includes('502') ||
      msg.includes('503') ||
      msg.includes('429')
    )
  }

  return false
}

/**
 * Sentinel wrapper used to break out of the retry loop for non-retryable errors.
 * This is never thrown to callers — it is always unwrapped.
 */
class NonRetryableWrapper extends Error {
  public readonly original: unknown
  constructor(original: unknown) {
    super('non-retryable')
    this.name = 'NonRetryableWrapper'
    this.original = original
  }
}

/**
 * Execute `fn` with exponential-backoff retries for transient failures.
 *
 * Non-retryable errors (auth, validation, 404/410) bail out immediately
 * on the first attempt. After exhausting retries, the *original* error
 * is re-thrown so callers' `handleError()` still works correctly.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: WithRetryOptions,
): Promise<T> {
  const {
    maxAttempts = 3,
    minTimeout = 200,
    multiplier = 2,
    jitter = 0.2,
    label = 'operation',
  } = options ?? {}

  let attempt = 0

  try {
    return await retry(
      () => {
        attempt++
        if (attempt > 1) {
          log.warn(`Retrying ${label}`, { attempt, maxAttempts })
        }

        return fn().catch((err: unknown) => {
          if (!isRetryableError(err)) {
            throw new NonRetryableWrapper(err)
          }
          log.warn(`${label} failed (attempt ${String(attempt)}/${String(maxAttempts)})`, {
            error: err instanceof Error ? err.message : String(err),
          })
          throw err
        })
      },
      {
        maxAttempts,
        minTimeout,
        multiplier,
        jitter,
      },
    )
  } catch (err) {
    // Unwrap sentinel for non-retryable errors
    if (err instanceof NonRetryableWrapper) {
      throw err.original
    }

    // Unwrap RetryError to throw the last original error
    if (err instanceof RetryError && Array.isArray(err.cause)) {
      const causes = err.cause
      const last = causes[causes.length - 1]
      if (last) {
        log.error(`${label} failed after ${String(maxAttempts)} attempts`, {
          error: last instanceof Error ? last.message : String(last),
        })
        throw last
      }
    }

    throw err
  }
}
