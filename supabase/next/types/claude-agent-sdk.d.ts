/**
 * Module augmentation for @anthropic-ai/claude-agent-sdk
 *
 * Fixes known SDK bugs where SDKRateLimitEvent and SDKPromptSuggestionMessage
 * are referenced in the SDKMessage union but never declared.
 *
 * @see https://github.com/anthropics/claude-agent-sdk-typescript/issues/181
 * @see https://github.com/anthropics/claude-agent-sdk-typescript/issues/196
 *
 * Remove this file when the SDK ships definitions for these types.
 */
export {}

declare module '@anthropic-ai/claude-agent-sdk' {
  export type SDKRateLimitEvent = {
    type: 'rate_limit'
    session_id: string
    uuid: string
  }

  export type SDKPromptSuggestionMessage = {
    type: 'prompt_suggestion'
    session_id: string
    uuid: string
  }
}
