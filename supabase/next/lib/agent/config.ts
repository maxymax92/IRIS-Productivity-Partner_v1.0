/**
 * Barrel re-export — backward-compatible imports for route.ts and tests.
 *
 * The agent config was split from a single 1133-line file into focused modules:
 * - prompt.ts: personality prompt + constants
 * - tools.ts: MCP tool handlers + server factory
 * - hooks.ts: hook factories + buildHooksConfig
 * - subagents.ts: subagent definitions
 */

export {
  AGENT_MAX_TURNS,
  AGENT_MAX_BUDGET_USD,
  AGENT_MODEL,
  DEFAULT_IMPORTANCE,
  DEFAULT_SEARCH_LIMIT,
  DEFAULT_SIMILARITY_THRESHOLD,
  IRIS_SYSTEM_PROMPT,
  MAX_FILE_LIST,
  MAX_PREVIEW_LENGTH,
  MAX_SEARCH_RESULTS,
  STREAM_KEEPALIVE_MS,
  TITLE_MODEL,
} from './prompt'

export {
  IRIS_TOOL_NAMES,
  DEFAULT_ALLOWED_TOOLS,
  createIrisToolsServer,
  createAgentAdminClient,
} from './tools'

export { buildHooksConfig } from './hooks'

export { IRIS_SUBAGENTS } from './subagents'
