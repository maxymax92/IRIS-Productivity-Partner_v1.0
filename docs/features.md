# Iris V2 — Features

---

## Chat

Iris's primary experience: a conversational AI with multi-turn tool use, persistent memory, multimodal input, and real-time streaming. The React frontend streams responses from an agentic backend that searches the web, manages files in Supabase Storage, and delegates to specialist subagents.

---

### Conversational AI

**Multi-turn tool use.** Within a single streamed response, the agent executes up to **100 turns** of tool calls, reasoning, and subagent delegation. **Session resumption** uses the Agent SDK's `resume` mechanism: subsequent messages read `sdk_session_id` from the `conversations` table and pass it to `query()`, restoring full conversation context. Session files (JSONL transcripts) persist on a Railway volume (`/data`) to survive container restarts. If resume fails (missing/corrupted session file), the handler falls back to a fresh session.

**Conversation continuity.** Returning to a conversation loads messages from `conversation_messages` (ordered by `created_at`) and reconstructs tool call and reasoning parts from the `tool_calls` JSONB column. `useConversations.loadMessages()` calls `reconstructParts()` to rebuild `DynamicToolUIPart` and `ReasoningUIPart` objects, so tool calls and reasoning blocks render identically on reload. Two layers work in parallel: Supabase powers message display and search; SDK session files give the agent full conversation memory.

**Streaming.** Responses stream token-by-token via the Vercel AI SDK's `UIMessageStream` protocol. `ChatView` tracks three statuses: `ready`, `submitted` (waiting for first token), and `streaming` (tokens arriving). A spinning `Loader2Icon` with Framer Motion entrance/exit indicates activity; the user can abort via the stop button on `PromptInputSubmit`.

**Extended thinking.** When enabled (persisted as `extended_thinking` in `user_settings`), the client sends `extendedThinking: true` and `thinkingBudget` to the API route, which maps them to the Agent SDK's `thinking` config: Opus 4.6 gets `{ type: 'adaptive' }`, other models get `{ type: 'enabled', budgetTokens: N }` (Sonnet: 8K, Haiku: 4K). When disabled, `{ type: 'disabled' }` is set explicitly. Thinking blocks stream alongside text and render as collapsible `Reasoning` components; during streaming they stay expanded, then collapse on completion.

**Conversation compaction.** When context grows too large, the Agent SDK triggers automatic compaction, surfaced as "_Summarising conversation..._" in the stream. After compaction, the `SessionStart` hook (triggered with `source: 'compact'`) injects a `<post_compaction_reminder>` listing available memory tools for re-retrieving lost context. For Sonnet 4+ models, the `context-1m-2025-08-07` beta extends the window to 1M tokens, delaying compaction.

**Budget and safety.** Every query is capped at **$5.00 USD** (`AGENT_MAX_BUDGET_USD`). Server filesystem tools (`Read`, `Write`, `Edit`, `Bash`, `Glob`, `Grep`) are removed entirely -- all file operations go through `manage_file` to Supabase Storage. Rate limiting uses a fail-closed token bucket RPC (`consume_rate_limit_token`). Every tool execution is audit-logged with input, output, timing, and permission decisions.

---

### Model Selection

Three Anthropic models are available, defined in `lib/models.ts`:

| Model              | ID                  | Context | Max Output | Default Output | Thinking Budget |
| :------------------ | :------------------- | :------- | :---------- | :-------------- | :--------------- |
| Claude Opus 4.6    | `claude-opus-4-6`   | 200K    | 128K       | 32K            | 16K             |
| Claude Sonnet 4.6  | `claude-sonnet-4-6` | 200K    | 64K        | 16K            | 8K              |
| Claude Haiku 4.5   | `claude-haiku-4-5`  | 200K    | 64K        | 8K             | 4K              |

**Default model** is Claude Sonnet 4.6 (`MODELS[1]`). The server-side fallback (`AGENT_MODEL` env var) also defaults to `claude-sonnet-4-6`.

**Selection flow.** The `ModelSelector` ai-element in `ChatInputArea`'s footer writes to `user_settings` via `useUserSettings().update({ model_id })`. `ChatView` reads `settings.model_id` and passes it through `DefaultChatTransport` to the server, where `isValidModelId()` validates against `MODEL_MAP`; invalid IDs fall back to `AGENT_MODEL`.

**Output limit control.** `getMaxOutputOptions(modelId)` generates power-of-two tiers from 4K to the model's cap. Persisted as `max_output_tokens` in `user_settings` and sent with each request. The Agent SDK lacks a per-turn output token limit (cost control uses `maxBudgetUsd`), but the value is logged server-side for observability.

---

### Multimodal Input

#### Supported Formats

- **Images:** JPEG, PNG, GIF, WebP -- sent as base64 `ImageBlockParam` content blocks
- **Documents:** PDF -- sent as base64 `DocumentBlockParam` content blocks
- **Text files:** Markdown, plain text, CSV, JSON, HTML, XML, YAML, code files -- decoded from base64 to UTF-8 and sent as `DocumentBlockParam` with `PlainTextSource`. Text content is truncated at 500KB to stay within API limits.
- **Office documents:** DOCX, XLSX, PPTX, ODT, ODS, ODP -- text extracted server-side via `officeparser` and sent as `DocumentBlockParam` with `PlainTextSource`. Legacy binary formats (.doc/.xls/.ppt) are not supported. Extraction failures are caught and the file is skipped gracefully.

#### Attachment Flow

The `+` menu opens a file picker via `PromptInputActionAddAttachments`. `usePromptInputAttachments()` manages selected files, displayed as inline `Attachment` previews with remove buttons. On submit, `DefaultChatTransport` sends files as `{ url: string, mediaType: string, filename?: string }` objects (data URIs). The `filename` passes through to `DocumentBlockParam.title` for text and office documents.

#### Server Processing

`buildContentBlocks()` in `route.ts` routes each file by MIME type: images to `ImageBlockParam`, PDFs to `DocumentBlockParam` with `Base64PDFSource`, text files decoded to `PlainTextSource`, office documents parsed via `officeparser` then wrapped in `PlainTextSource`. Empty files and unsupported MIME types are skipped (unsupported types noted as `[Unsupported attachment types: ...]`). The text block always appears, falling back to `'(attached file)'` for file-only messages.

#### Attachment Persistence

`uploadChatAttachments()` uploads each file to `{userId}/chat-attachments/{conversationId}/{timestamp}-{sanitisedFilename}` in the `user-files` bucket (best-effort; individual failures are logged and skipped). Metadata (`PersistedAttachment` from `types/attachments.ts`) saves to `conversation_messages.attachments` JSONB via `persistMessage`. On reload, `loadMessages()` reconstructs `FileUIPart`s by batch-generating signed URLs via `createSignedUrls()`, and `MessagePartRenderer` renders them as grouped `Attachments` thumbnails above the message text.

#### File-Only Messages

The system accepts messages with files but no text. The validation check (`!message && files.length === 0`) rejects requests only when both are empty.

---

### Chat UI

#### Message Rendering

**`MessagePartRenderer`** (`components/chat/message-part-renderer.tsx`) processes `UIMessage.parts`, sorted tools-first via `sortPartsToolsFirst()` (reasoning -> dynamic-tool/tool -> text):

| Part Type           | Component                                                    | Description                                                                                                                                                                                          |
| :------------------- | :------------------------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text`              | `MessageResponse`                                            | Markdown-rendered text content                                                                                                                                                                       |
| `reasoning`         | `Reasoning` + `ReasoningTrigger` + `ReasoningContent`        | Collapsible thinking blocks                                                                                                                                                                          |
| `dynamic-tool` / tool | `Tool` + `ToolHeader` + `ToolContent` + `ToolOutput`       | Tool call with state indicator, input, and output                                                                                                                                                    |
| `file`              | `Attachments` (grid) + `AttachmentPreview` + `AttachmentInfo` | User file attachments rendered as grouped thumbnails/chips above the message. Extracted at the message level, not in the per-part loop.                                                              |
| image (base64)      | `Image`                                                      | Rendered image from AI output                                                                                                                                                                        |
| plan                | `Plan` + `PlanTitle` + `PlanDescription` + `PlanContent`     | Structured plan display                                                                                                                                                                              |
| chain-of-thought    | `ChainOfThought` + steps                                     | Multi-step reasoning visualization                                                                                                                                                                   |
| terminal            | `Terminal`                                                    | Terminal output display                                                                                                                                                                              |
| sandbox             | `Sandbox` + `SandboxHeader` + `SandboxContent`               | Sandboxed execution output                                                                                                                                                                           |
| task                | `Task` + `TaskTrigger` + `TaskContent`                       | Collapsible task display                                                                                                                                                                             |
| code-block          | `CodeBlock` + header + copy/save buttons                     | Syntax-highlighted code with line numbers. Shiki is dynamically imported (`import('shiki')`) so the ~500KB bundle is only loaded when a code block is first rendered.                                |
| snippet             | `Snippet` + `SnippetCopyButton`                              | Inline code snippet                                                                                                                                                                                  |
| stack-trace         | `StackTrace` + error/frames                                  | Structured error trace with expand/collapse                                                                                                                                                          |
| inline-citation     | `InlineCitation` + card                                      | Clickable source references                                                                                                                                                                          |
| source-url          | `Sources` + `SourcesTrigger` + `Source`                      | Source URL list rendered above the message                                                                                                                                                            |

#### Message Actions

Each message gets a hoverable action bar with:

- **Copy** -- copies the message text to clipboard via `CopyButton`
- **Save to Files** (assistant only) -- opens a `Popover` with a filename input (auto-suggested as `chat-{prefix}.md`), saves via `useSaveToFiles().saveContent()` which POSTs multipart/form-data to the files API and dispatches `iris:files-changed`
- **Regenerate** (last assistant only, when not streaming) -- calls `useChat().regenerate()`

#### Empty State

When no conversation is active and no messages exist, `IrisEmptyState` renders:

- The Iris wordmark in custom display typography (`font-satoshi`, `text-iris-title`, `tracking-iris-display`)
- A time-aware greeting: "good morning" (before 12), "good afternoon" (12-18), or "good evening" (after 18), personalized with the user's first name from `user.user_metadata.full_name`

#### Input Area

The `ChatInputArea` component contains:

- **Textarea** -- `PromptInputTextarea` with placeholder "Ask Iris anything..." and `enterKeyHint="send"`
- **Attachment button** -- `+` menu with "Add photos or files"
- **Model selector** -- shows current model name with Anthropic logo, opens a searchable combobox
- **Settings dropdown** -- Extended Thinking toggle, output limit sub-menu (radio group of token tiers)
- **Context meter** -- `ContextTrigger` (icon-only) with `HoverCard` showing token usage breakdown (input, output, cache) and model context window
- **Submit/Stop** -- `PromptInputSubmit` toggles between send and stop based on `status`

#### Streaming Indicators

- **Spinner** -- an `AnimatePresence`-wrapped `Loader2Icon` with `animate-spin-fast` appears below messages during `submitted` and `streaming` states, with scale-in/scale-out transitions
- **Skeleton** -- `ChatMessagesSkeleton` shows placeholder blocks while loading conversation history
- **Reasoning streaming** -- the last part of the last assistant message during streaming gets `isStreamingReasoning: true`, keeping the `Reasoning` component in its expanded/streaming visual state

---

### Conversation Management

The **`useConversations`** hook (`hooks/use-conversations.ts`) manages conversation state, backed by `user_settings` (via `useUserSettings()`) for the active conversation ID. Instantiated once in `Canvas`, its outputs (`activeConversationId`, `createConversation`, `loadMessages`) pass down as props to `ChatView` to prevent conflicting validation effects.

**Listing.** Fetches all conversations on mount, ordered by `updated_at` descending, rendered as a date-grouped sidebar list.

**Creating.** `createConversation()` inserts a row with `status: 'active'`, prepends it locally, and sets it as active. `handleSubmit` calls this automatically when no conversation is active.

**Deleting.** `deleteConversation(id)` removes the row from Supabase and the local list; clears the active ID if the deleted conversation was active.

**Active conversation validation.** After conversations load, stale `activeConversationId` references (pointing to nonexistent conversations) are cleared to `null`.

#### Message Loading

`loadMessages(conversationId)` fetches `conversation_messages` ordered by `created_at`, filters out `tool` role messages, and reconstructs each message's parts:

1. Text content becomes a `{ type: 'text', text }` part
2. The `tool_calls` JSONB column is passed through `reconstructParts()`, which produces `DynamicToolUIPart` (for tool calls with input/output/state) and `ReasoningUIPart` (for reasoning blocks with `state: 'done'`)
3. At least one part is guaranteed (empty text fallback)

#### Persistence of Non-Text Parts

`persistAssistantResponse()` in `route.ts` serializes the `partsAccumulator` Map into a `PersistedPart[]` array stored as JSONB in `conversation_messages.tool_calls`. Each `PersistedToolCall` records `toolCallId`, `toolName`, `input`, `output`, and `state`; each `PersistedReasoningBlock` records `type: 'reasoning'` and `text`.

#### Title Generation

First-turn conversations get an auto-generated title via a Claude Haiku call (max 20 tokens, "max 6 words"). On failure, the user message truncates to 50 characters as fallback.

#### Conversation Summary

On the first message, `route.ts` writes a truncated (100-character) version to `conversations.summary` (guarded by `.is('summary', null)`). This serves as a sidebar fallback until title generation completes.

#### File Tree Refresh

When a streaming response completes with a `manage_file` tool call, `ChatView` dispatches `FILES_CHANGED_EVENT`. The file tree listens for this event and refreshes, so agent-created files appear immediately in the sidebar.

#### Subagent Progress Updates

`task_progress` messages stream as italic text ("_Progress: {description} ({last_tool_name})_") between "_Starting_" and "_Completed_" markers, providing real-time visibility and keeping the HTTP connection alive.

**Subagent stream isolation.** Subagent `stream_event` messages (`parent_tool_use_id !== null`) are filtered from the UI stream. Only system-level messages (`task_started`, `task_progress`, `task_notification`) reach the client. This two-layer defense (stream filtering + PostToolUse `isStreamedTool` guard) prevents `UIMessageStreamError` from orphaned tool call IDs.

#### Stream Drop Auto-Recovery

The Vercel AI SDK's `safeEnqueue` silently swallows errors when writing to a closed stream, so the server can finish while the UI freezes. `ChatView` recovers by reloading messages from the database 2 seconds after any `streaming -> ready` transition. For normal completions this is a no-op; for silent stream drops, it restores the complete response without a page refresh. The timer cancels via effect cleanup if the user sends a new message or switches conversations.

---

### Context Usage Meter

Built with the `Context` ai-element in `ChatInputArea`'s footer.

**Data source.** `usePreservedUsage` (in `chat-view.tsx`) scans messages in reverse for the most recent assistant `metadata.usage`, returning `inputTokens`, `outputTokens`, `totalTokens`, and `inputTokenDetails`. The hook preserves usage across the 2-second auto-reload via "setState during render" and clears on conversation switch.

**Persistence.** `persistAssistantResponse` stores usage as `{ usage: { inputTokens, outputTokens, totalTokens, inputTokenDetails } }` in `conversation_messages.metadata` JSONB. On reload, `loadMessages` includes this metadata in the `UIMessage`, so the context meter survives page refreshes.

**Display.** `ContextTrigger` renders an icon-only indicator. On hover, a `HoverCard` shows percentage + progress bar (`ContextContentHeader`) and token breakdown (`ContextContentBody`). Cost display is disabled because `tokenlens` does not recognise the app's convenience model IDs. `maxTokens` comes from `getModelOrDefault(model).contextWindow` (200K for all current models); `usedTokens` = `inputTokens + outputTokens`.

**How usage arrives.** The Agent SDK's `SDKResultMessage.usage` contains cumulative totals across all turns. The stream adapter maps these to Vercel AI SDK camelCase format and writes `message-metadata` just before `finish`. It also returns an `AgentQueryUsage` object that `route.ts` uses for both `increment_usage_stats` and persistence. Because usage is cumulative, multi-turn query values can exceed a single API call's context window.

---

## Agent Features

### Agent Capabilities

The agent decides which tools to invoke, when to delegate to subagents, and what to remember.

#### Nine MCP Tools

| Tool                   | What it enables                                                                                                                                                                                          |
| :---------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`search_knowledge`** | Semantic recall across everything the user has stored -- memories and files. The agent searches before answering "do I have anything about X?" and when the user references past conversations or projects. |
| **`store_memory`**     | Long-term fact retention (create-only). When the user says "remember that I prefer...", corrects the agent, or shares a stable personal fact, the agent writes it to the knowledge base with an embedding for future retrieval. |
| **`update_memory`**    | Update an existing memory's content, type, or metadata with automatic re-embedding. Used when a memory found via `search_knowledge` is outdated but the core fact is still relevant.                     |
| **`delete_memory`**    | Permanently delete stale, incorrect, or duplicate memories. Handles both knowledge and episodic memory tables based on the `source` parameter from search results.                                       |
| **`log_context`**      | Session-level awareness. After meaningful conversations, the agent logs decisions, action items, meeting takeaways, and project state as time-bounded episodic memories with importance scores and optional expiry. |
| **`manage_file`**      | Persistent cloud storage -- upload documents/code the user wants to keep, download existing files, browse directory listings, or delete files. Every upload and delete writes an activity commit to the file history log. |
| **`manage_project`**   | Project lifecycle management -- list, get, create, update, and delete projects. Projects are organisational containers that group related conversations and memories. The agent checks for existing projects before creating new ones. |
| **`manage_reminder`**  | Scheduled reminder management -- create, list, update, snooze, dismiss, and delete time-based reminders that trigger push notifications. Tracks snooze count for avoidance pattern detection. Supports recurrence rules via iCal RRULE. |
| **`send_notification`** | Immediate push notifications -- sends a custom notification with a title and message to the user's subscribed devices. Used for ad-hoc alerts when the user needs an instant notification.              |

#### Four Subagents

| Subagent                                      | When it activates                                                | What it does                                                                                                                                                                                                                                                    |
| :--------------------------------------------- | :---------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`researcher`** (Sonnet, maxTurns: 10)       | Multi-step web research requiring 2+ source cross-referencing    | Breaks questions into search queries, reads authoritative sources, cross-references claims, returns findings with inline citations. Saves substantial research (500+ words) as files via `manage_file`.                                                         |
| **`memory-keeper`** (Sonnet, maxTurns: 5)     | Bulk memory storage, memory organisation, knowledge curation     | Stores multiple related facts as atomic memories, searches before storing to avoid duplicates, can update and delete existing memories for hygiene. Uses progressive search strategies for recall.                                                               |
| **`planner`** (Sonnet, maxTurns: 8)           | Breaking down complex goals, daily planning, priority sequencing | Transforms overwhelming goals into 15-60 minute concrete steps. Each step starts with a verb and passes the "2-minute start test". Front-loads cognitively demanding tasks. Uses `search_knowledge`, `manage_project`, and `log_context`. Designed to make starting easy and maintain momentum. |
| **`reviewer`** (Sonnet, maxTurns: 8)          | Daily reviews, weekly reflections, progress check-ins            | Leads with accomplishments, frames stalled items as observations not failures. Names avoidance patterns gently on the 3rd occurrence. Uses `search_knowledge`, `manage_reminder`, and `log_context`. Never guilts, never compares productivity across days.     |

---

### Safety and Guardrails

Safety relies on two mechanisms: **tool removal** and **rate limiting**. All server filesystem tools (`Read`, `Write`, `Edit`, `Bash`, `Glob`, `Grep`) are removed -- file operations go through `manage_file` to RLS-protected Supabase Storage. Since every remaining tool writes to RLS-protected Supabase, all tools auto-approve immediately.

#### Hook Ordering

The `PreToolUse` pipeline runs: rate limit check -> timing capture -> auto-approve. See [architecture.md](architecture.md) for the full hook pipeline and ordering details.

#### Rate Limiting

A token-bucket algorithm via `consume_rate_limit_token` RPC gates `WebSearch`, `WebFetch`, and `Task`. All Iris MCP tools are exempt. The policy is **fail-closed**: if the RPC errors, the tool is denied. See [architecture.md](architecture.md) for implementation details.

#### Budget Cap and Turn Limits

| Limit               | Value | Purpose                                  |
| :-------------------- | :----- | :---------------------------------------- |
| `AGENT_MAX_TURNS`   | 100   | Prevents infinite agent loops in production |
| `AGENT_MAX_BUDGET_USD` | $5.00 | Prevents runaway API costs              |

---

### Audit Trail

Every tool execution logs to `agent_audit_log` via fire-and-forget inserts. Failures log to `console.error` but never block the agent.

#### Table: `agent_audit_log`

| Column                | Type              | Description                                                                                                                |
| :--------------------- | :----------------- | :-------------------------------------------------------------------------------------------------------------------------- |
| `id`                  | UUID              | Primary key (auto-generated)                                                                                               |
| `user_id`             | UUID              | The authenticated user                                                                                                     |
| `tool_name`           | string            | Name of the tool (e.g., `Bash`, `mcp__iris-tools__manage_file`)                                                           |
| `session_id`          | UUID (nullable)   | Formerly FK to `agent_sessions.id` -- the `agent_sessions` table has been dropped; this column is retained but unused      |
| `tool_input`          | JSONB (nullable)  | The full input passed to the tool                                                                                          |
| `tool_output`         | JSONB (nullable)  | The tool's response (only for successful executions)                                                                       |
| `permission_decision` | string (nullable) | `'allow'` or `'deny'`                                                                                                     |
| `permission_reason`   | string (nullable) | Reason for denial (e.g., "Blocked: Recursive delete from root or home")                                                   |
| `execution_time_ms`   | number (nullable) | Measured from `PreToolUse` timing hook to `PostToolUse` audit hook                                                         |
| `error_message`       | string (nullable) | Error details for failed tool executions                                                                                   |
| `created_at`          | timestamptz       | Auto-set on insert                                                                                                         |

#### What Gets Logged

- **Successful executions** (`PostToolUse`): `tool_name`, `tool_input`, `tool_output`, `permission_decision: 'allow'`, `execution_time_ms`
- **Rate limit denials** (`PreToolUse` rate limit hook): `tool_name`, `tool_input`, `permission_decision: 'deny'`, `permission_reason: 'Rate limit exceeded'`
- **Failed executions** (`PostToolUseFailure`): `tool_name`, `tool_input`, `permission_decision: 'allow'`, `execution_time_ms`, `error_message`

---

### Usage Statistics

Per-user daily usage tracked in `usage_stats` via `increment_usage_stats` Postgres RPC. After the stream completes, `route.ts` calls it with actual token counts from `AgentQueryUsage` (moved from the Stop hook because that lifecycle lacks access to SDK token data).

#### Table: `usage_stats`

| Column                       | Type    | Description                              |
| :---------------------------- | :------- | :---------------------------------------- |
| `user_id`                    | UUID    | The authenticated user                   |
| `stat_date`                  | date    | Current date (upsert key with `user_id`) |
| `input_tokens`               | integer | Total input tokens for the day           |
| `output_tokens`              | integer | Total output tokens for the day          |
| `total_tokens`               | integer | Computed: `input_tokens + output_tokens` |
| `api_calls`                  | integer | Number of agent sessions                 |
| `total_session_time_seconds` | integer | Cumulative session time                  |

The RPC upserts via `ON CONFLICT (user_id, stat_date) DO UPDATE`. It is `SECURITY DEFINER` with explicit `p_user_id` because agent hooks run under the service-role client where `auth.uid()` is null.

Token-level usage also flows to the client via the stream adapter's `message-metadata` and persists in `conversation_messages.metadata` JSONB for page-refresh survival. Usage values from the Agent SDK are **cumulative** across all turns in a multi-turn query.

---

## Memory Features

Iris remembers who you are, what you've been working on, and what you've told it -- across conversations, without being asked.

---

### Knowledge Base

Three MCP tools in the `iris-tools` server, exposed as `mcp__iris-tools__search_knowledge`, `mcp__iris-tools__store_memory`, and `mcp__iris-tools__log_context`.

#### `search_knowledge` -- Recall

Searches across **both** the long-term knowledge base and recent episodic memory using semantic similarity. The agent uses this when:

- The user references past context ("what did we discuss about the meeting with angela last week?")
- The user asks "do you remember..." or "do I have anything about..."
- A conversation topic might have history worth surfacing
- The user mentions a person, project, or topic that could have stored context

**Parameters:**

- `query` -- Natural language search query. Specific queries perform far better than vague ones.
- `contentType` -- Optional filter. Accepts: `memory`, `fact`, `preference`, `context`, `conversation`, `file`. Omitting searches all types.
- `limit` -- Number of results (1-50, default 10).
- `threshold` -- Minimum similarity score (0-1, default 0.5). Raise to 0.7+ for precise matches.

**Returns:** A numbered list of matches showing content type, similarity percentage, and a content preview (truncated to 200 characters).

Calls `POST /memory/search`, which embeds the query with gte-small, runs `search_embeddings` and `match_memories` RPCs in parallel, merges by similarity, and returns the top N.

#### `store_memory` -- Long-Term Facts

Stores permanent facts in `knowledge_embeddings`. Used for:

- User identity: name, role, company, timezone, team members
- Preferences: communication style, tools they use, organizational habits
- Corrections: "actually, I meant..." or "no, it's..."
- Explicit requests: "remember that..."

**Parameters:**

- `content` -- The information to store. Written in third person ("User prefers dark mode" not "You prefer dark mode") with enough context to be useful months later.
- `contentType` -- Category: `memory` (general), `fact` (objective info), `preference` (user habits), `context` (project context). Defaults to `memory`.
- `sourceId` -- Optional UUID linking to a source record.
- `sourceTable` -- Optional table name for the source record.
- `metadata` -- Optional key-value pairs for additional context.
- `projectId` -- Optional UUID associating the memory with a project.

**Returns:** Confirmation with the stored memory's ID.

#### `log_context` -- Episodic Memory

Logs time-bounded, importance-scored observations to `semantic_memory` with optional auto-expiry. Used for:

- Conversation summaries: "User discussed Q1 budget with Jonathan, decided to defer cloud migration"
- Active project state: "User is preparing for a board presentation next Tuesday"
- Meeting takeaways: "Key decision: switch from AWS to GCP for the ML pipeline"
- Session-level corrections: when the user clarifies something about their current situation

**Parameters:**

- `content` -- The context to store. Third person, specific, with enough detail to be useful in a future session.
- `memoryType` -- One of the `memory_type` enum values: `fact`, `conversation`, `project`, `preference`.
- `importance` -- 0-1 scale. 0.3 = minor detail, 0.5 = standard (default), 0.7 = important decision, 0.9 = critical context.
- `expiresInDays` -- Optional auto-expiry. Common values: 7 for weekly context, 30 for monthly, 90 for quarterly. Omit for no expiry.

**Returns:** Confirmation with the stored context's ID.

#### What the Agent Is Told NOT to Store

The Memory Protocol (defined in `IRIS_SYSTEM_PROMPT` in `lib/agent/prompt.ts`) explicitly instructs the agent to avoid storing:

- Transient chat (greetings, small talk, "thanks", "ok")
- Full documents or long text (use `manage_file` instead)
- Information the agent is uncertain about -- ask the user to confirm first

---

### Memory Management

#### Clear All Memory

`POST /api/user/clear-memory` deletes **all** rows from both `semantic_memory` and `knowledge_embeddings` for the authenticated user in parallel. Exposed in the UI as a "clear memory" action.

#### Data Export

`GET /api/user/export` exports all user data (`conversations`, `knowledge_embeddings`, `semantic_memory`, `reminders`) as `iris-data-YYYY-MM-DD.json` with `Content-Disposition: attachment`.

---

### Memory Protocol

Defined in `IRIS_SYSTEM_PROMPT` (`lib/agent/prompt.ts`) and injected into every session's system prompt.

#### Tool Use Integrity

The system prompt prohibits fabricating, simulating, or inventing tool results -- every result must come from an actual invocation. Failed tool calls must be reported as-is. A matching `SUBAGENT_RULES` block enforces this at the subagent level via `subagents.ts`.

Key directives:

#### Recall Triggers

The agent searches memory:

- At the start of conversations
- When the user references past context
- When someone mentions a person, project, or topic that might have history
- When the user asks "do you remember..."

#### Store vs. Log Decision

Clear distinction:

- **`store_memory`** for stable, permanent facts that won't change (identity, preferences, corrections)
- **`log_context`** for session-level observations and time-bounded context (conversation summaries, active project state, meeting takeaways)

#### Session Bootstrapping

On the first message of a new conversation, `route.ts` calls `buildMemoryContext()` to semantic-search the user's message against memory (up to 10 results, threshold 0.4) and inject matches as a `<user_context>` block in the system prompt. Subsequent messages skip this injection -- the agent has full context via session resume and can call `search_knowledge` proactively.

#### Writing Style

Memories use third-person, atomic facts: "User is a Senior TPM at Acme Corp based in London" -- not "You are a Senior TPM." This prevents pronoun ambiguity during retrieval.

---

## File Management

### Storage Architecture

All files live in a single Supabase Storage bucket **`user-files`**, path-isolated by user ID (`{userId}/` prefix enforced server-side by `assertUserPath()`). Uploads use `upsert: true`, overwriting existing paths without error.

**Key constants** (from `lib/constants.ts`):

| Constant                   | Value        | Purpose                                 |
| :-------------------------- | :------------ | :--------------------------------------- |
| `FILE_LIST_LIMIT`          | 1000         | Max items from Supabase Storage `.list()` |
| `SIGNED_URL_EXPIRY_SECONDS` | 3600 (1 hour) | Expiry for file download/preview URLs   |
| `GIT_LOG_DEFAULT_LIMIT`   | 20           | Default commit history page size        |

---

### File Tree

The sidebar file list uses **`useProjectFiles`** (`hooks/use-project-files.ts`), which fetches from `GET /api/user/files`. The API returns a flat list of storage paths transformed into a `FileTreeNode[]` tree by `buildTreeFromPaths()`.

**`FileTreeNode`** is a discriminated union:

```
├── { type: 'file'; name: string; path: string }
└── { type: 'folder'; name: string; path: string; children: FileTreeNode[] }
```

The `FileNode` component renders each node:

- **Files** display with a `File` icon and a hover-to-show delete button (`SidebarMenuAction showOnHover`)
- **Folders** use a `Collapsible` wrapper with `ChevronRight` (rotates 90 degrees when open), toggling between `Folder` and `FolderOpen` icons. Children render inside `SidebarMenuSub` for proper indentation.
- **Delete confirmation** uses shadcn `AlertDialog` before any destructive action

Clicking a file calls `getSignedUrl()`, which fetches a time-limited signed URL from Supabase Storage, then opens it in a new tab via `window.open(url, '_blank', 'noopener')`.

#### Toolbar Actions

The file section header (`FilesCollapsible` in `app-sidebar.tsx`) provides a `DropdownMenu` with three actions:

1. **Upload File** -- triggers a hidden `<input type="file" accept="*">` element. On file selection, calls `uploadFile(filename, file)` via the hook.
2. **New Folder** -- expands the Files section and shows an inline `Input` field. On Enter, calls `createFolder(name)`. On Escape or blur, cancels.
3. **Refresh** -- calls both `refresh()` (file tree) and `refreshGit()` (git history) to sync both views.

---

### File Operations

All file CRUD flows through **`app/api/user/files/route.ts`**:

#### GET -- List Tree or Get Signed URL

- **Default** (`GET /api/user/files`): Lists all objects under `{userId}/` in the `user-files` bucket, recursively traversing subfolders via `collectPathsUnderPrefix()`. Skips `.git*` entries. Returns `{ tree: FileTreeNode[] }`.
- **Signed URL** (`GET /api/user/files?action=signed-url&path=...`): Generates a time-limited download URL with `createSignedUrl(fullPath, SIGNED_URL_EXPIRY_SECONDS)`.

#### POST -- Upload File or Create Folder

- **File upload** (Content-Type: `multipart/form-data`): Reads `file` and `path` from form data. Uploads to `{userId}/{path}` with `upsert: true`. Records a commit entry (see below).
- **Folder creation** (Content-Type: `application/json`, body `{ path, folder: true }`): Creates a `.keep` placeholder file at `{userId}/{path}/.keep` since object storage doesn't have native folder concepts.

#### DELETE -- Remove File or Folder

`DELETE /api/user/files?path=...` recursively collects all paths under the target prefix (for folders) or uses the single path (for files), then calls `supabase.storage.from(BUCKET).remove(toRemove)`. Records a delete commit for the audit trail.

#### Path Security

`assertUserPath()` strips leading/trailing slashes, removes `..` traversal attempts, validates non-empty paths, and prepends the user ID -- scoping all operations to the authenticated user's directory.

---

### File Activity Log

A two-table audit trail mimics git commit history:

#### Tables

**`file_commits`** -- one row per operation:

- `id` (UUID, PK)
- `user_id` (UUID, FK)
- `message` (text) -- e.g., "Add report.md" or "Delete old-data.csv"
- `created_at` (timestamptz)

**`file_commit_files`** -- one row per file affected:

- `commit_id` (UUID, FK to `file_commits`)
- `path` (text) -- relative path without user ID prefix
- `action` (`'add' | 'modify' | 'delete'`)
- `size` (bigint, nullable)
- `content_type` (text, nullable)

#### Creating Commits

**`createFileCommit()`** (`lib/files/commits.ts`) serves both the API route and the agent's `manage_file` tool, using an admin Supabase client to:

1. Insert a row into `file_commits`
2. Insert one or more rows into `file_commit_files` with the affected paths

#### Querying History

- **`getCommitLog(userId, limit)`** -- returns the most recent commits with file counts, ordered by `created_at DESC`. Uses a join query: `file_commits.select('id, message, created_at, file_commit_files(id)')`.
- **`getCommitDetail(commitId, userId)`** -- returns a single commit with its full file list (path, action, size, content_type). Scoped to the user via `.eq('user_id', userId)`.

#### File Activity Log

File commits are recorded internally via `createFileCommit()` for audit purposes. The commit log and detail queries (`getCommitLog`, `getCommitDetail` in `lib/files/commits.ts`) remain available but are not currently exposed in the UI.

---

### Save to Files

**`useSaveToFiles`** (`hooks/use-save-to-files.ts`) provides `saveContent(filename, content)` for chat message and code block actions:

1. Creates a `Blob` from the content string with `type: 'text/plain'`
2. Wraps it in a `File` object
3. POSTs `multipart/form-data` to `/api/user/files` with `file` and `path` fields
4. On success, dispatches a `CustomEvent(FILES_CHANGED_EVENT)` where `FILES_CHANGED_EVENT = 'iris:files-changed'`
5. Shows a success toast: "Saved {filename}"

`useProjectFiles` listens for this event and refreshes the file tree automatically.

---

### AI Integration -- manage_file Tool

The **`manage_file`** MCP tool (`lib/agent/tools.ts`) gives the agent full CRUD access to user file storage. Files persist permanently (unlike `Write`, which creates ephemeral container-disk files).

**Actions:**

| Action     | Required Params          | Description                                                         |
| :---------- | :------------------------ | :------------------------------------------------------------------- |
| `upload`   | `path`, `content`        | Upserts a file. Optional `contentType` (defaults to `text/plain`). Records a commit. |
| `download` | `path`                   | Returns file content as text                                        |
| `list`     | (optional `path`)        | Returns file/directory listing, hides `.git` internals              |
| `delete`   | `path`                   | Permanently removes the file. Records a commit.                     |

Paths are relative to the user's root (user ID auto-prepended). The tool uses the admin Supabase client and calls `createFileCommit()` for upload/delete, maintaining the same audit trail as manual operations.

---

## Authentication

### Sign-In Methods

All auth flows are **server actions** in `lib/auth/actions.ts` using Supabase Auth via `/ssr`, returning `AuthResult<T>`: `{ ok: true, ...data }` or `{ ok: false, error: string }`.

#### Google OAuth (PKCE)

`signInWithGoogle(redirectTo?)` builds a callback URL (`{origin}/auth/callback?next=...`), calls `signInWithOAuth()` with `access_type: 'offline'` and `prompt: 'consent'`, then redirects to Google. Origin comes from `NEXT_PUBLIC_SITE_URL`, falling back to `http://localhost:3000`.

#### Email + Password

`signInWithPassword(email, password)` calls `supabase.auth.signInWithPassword()`. On success, redirects to `/`. On failure, returns the Supabase error message.

#### Sign-Up

`signUp(email, password)` calls `supabase.auth.signUp()` with `emailRedirectTo` pointing to the OAuth callback route. Returns a message prompting the user to check their email for the confirmation link.

#### Magic Link

`signInWithMagicLink(email)` calls `supabase.auth.signInWithOtp()` with the same callback redirect. Returns a message to check email for the magic link.

#### Sign-Out

`signOut()` calls `supabase.auth.signOut()`, logs any error, and always redirects to `/` -- even on failure, preventing stuck sessions.

#### Allowed Emails Gating

Sign-up is restricted to pre-approved addresses in the **`allowed_emails`** table (`id`, `email` unique, `created_at`). RLS with no public policies means only `service_role` can access it. New addresses must be inserted via the Supabase dashboard or admin API.

---

### OAuth Callback

`app/auth/callback/route.ts` handles OAuth and magic link completion: exchanges `?code=` for a session via `exchangeCodeForSession()`, redirects errors to `/?error={description}`, and handles Railway/reverse proxy via `x-forwarded-host`.

---

### Session Management

#### Proxy (Middleware)

`proxy.ts` (Next.js middleware) runs on every non-static request. It delegates to `updateSession()` in `lib/supabase/proxy.ts`, which calls **`supabase.auth.getClaims()`** -- a local JWT validation (no network roundtrip) that parses and verifies the JWT from cookies. Returns `{ user: data?.claims, supabaseResponse }` with any refreshed session cookies. No logic should sit between `createServerClient()` and `getClaims()` to avoid refresh loops.

#### Cookie-Based SSR

Session tokens live in HTTP cookies managed by `/ssr`. The proxy's `setAll` callback writes cookies to both request (for server components) and response (for the browser), enabling server components, client components, and API routes to share the same authenticated session.

#### getCurrentUser

`getCurrentUser()` in `lib/auth/actions.ts` calls `supabase.auth.getUser()` and returns `{ ok: true, user }` or `{ ok: false, error }`. The root `page.tsx` uses it to render either `Canvas` (authenticated) or the landing page.

---

## User Preferences & UI State

### Unified Settings via Supabase

**`useUserSettings()`** (`hooks/use-user-settings.tsx`) provides a single React Context backed by `user_settings` with Realtime sync, wrapped at the app level in `canvas.tsx`. High-frequency nav state (active tab, conversation ID) uses `useSettingsField` for field-level subscriptions; preferences use `useUserSettings` for full access.

#### What's Stored

The `user_settings` table columns map directly to settings:

| Column                   | Type      | Default                   | Purpose                                                               |
| :------------------------ | :--------- | :------------------------- | :--------------------------------------------------------------------- |
| `model_id`              | `text`    | `DEFAULT_MODEL_ID`        | Selected AI model                                                     |
| `extended_thinking`     | `boolean` | `true`                    | Enables deeper reasoning (costs more tokens)                          |
| `max_output_tokens`     | `integer` | Model's `defaultMaxOutput` | Maximum response length                                               |
| `language`              | `text`    | `'en-US'`                 | UI and response language                                              |
| `timezone`              | `text`    | `detectTimezone()`        | User's timezone                                                       |
| `date_format`           | `text`    | `'MM/DD/YYYY'`            | Date display format                                                   |
| `time_format`           | `text`    | `'12h'`                   | 12-hour or 24-hour time                                               |
| `ai_personality`        | `text`    | `null`                    | Personality preset (default, concise, warm, professional)             |
| `active_tab`            | `text`    | `'chat'`                  | Currently selected tab                                                |
| `active_conversation_id` | `uuid`   | `null`                    | Selected conversation in sidebar                                      |

#### Context API

- **`useUserSettings()`** -- Returns `{ settings, updateSettings, isLoading }`. Use for components that read many fields (preferences, chat model, format). Re-renders when any setting changes.
- **`useSettingsField(field)`** -- Subscribes to a single nav field (`active_tab`, `active_conversation_id`). Re-renders only when that field changes. Use for high-frequency nav state.
- **`useUpdateSettings()`** -- Returns only `updateSettings`. Does not subscribe to settings. Use when a component needs to write but not read.
- **`getSettingsSnapshot()`** -- Returns current settings outside React (e.g. in Realtime handlers). Use for synchronous reads in event handlers.

#### Write Strategy

1. **Immediate writes** -- Preference changes (`model_id`, `extended_thinking`, `max_output_tokens`, `language`, `timezone`, `date_format`, `time_format`, `ai_personality`) write to Supabase on change.

2. **Debounced writes** (500ms) -- UI state (`active_tab`, `active_conversation_id`) coalesces rapid updates into a single database write.

#### Cross-Device Sync

A Realtime subscription on `user_settings` merges incoming `UPDATE` events into local state, keeping all connected clients in sync.

---

#### Preferences UI

**`IrisPreferences`** (`components/iris-preferences.tsx`) opens from the sidebar footer or `Cmd+,`. Every setting auto-saves on change -- no draft/save pattern. Three sections:

**Model & AI:**

- Model selector (dropdown of all available `MODELS`)
- Extended thinking toggle (Switch)
- Max output tokens selector (options are model-dependent via `getMaxOutputOptions()`)

When the model changes, `maxOutputTokens` is clamped to the new model's `maxOutput` ceiling.

**Integrations:**

- Placeholder for calendar, email, and other integrations (coming soon)

**Region:**

- Language selector (6 languages: English US/UK, Spanish, French, German, Japanese)
- Timezone selector (26 major timezones, with the browser-detected timezone shown first with "-- Detected" suffix)
- Date format selector (MM/DD/YYYY, DD/MM/YYYY, YYYY-MM-DD with examples)
- Time format selector (12-hour / 24-hour)

---

### Timezone Management

Stored in `user_settings.timezone`, detected via `Intl.DateTimeFormat().resolvedOptions().timeZone` (SSR guard falls back to `'UTC'`). Users can override with any of 26 presets, or re-trigger detection via the "Detected" option. All reads and writes go through `useUserSettings()`.

#### Stale-ID Validation

`Canvas` and sidebar components run cleanup effects that detect when a persisted ID references an entity that no longer exists:

---

## UI Shell, Navigation & Design System

### App Shell

**`Canvas`** (`components/canvas.tsx`) receives a `User` object and wraps the app in four nested providers:

1. **`UserSettingsProvider`** (`hooks/use-user-settings.tsx`) -- provides `useUserSettings()` context for all preferences and UI state, backed by Supabase `user_settings` table with Realtime sync
2. **`MotionConfig`** (`motion/react`) with `reducedMotion="user"` -- respects the OS preference via `prefers-reduced-motion`
3. **`TooltipProvider`** -- global tooltip context for all shadcn tooltip instances
4. **`SidebarProvider`** -- manages sidebar open/collapsed/mobile state

`ChatView` renders directly inside these providers. Content padding accounts for safe-area insets: `paddingTop: 'max(5rem, calc(env(safe-area-inset-top, 0px) + 3.5rem))'`.

#### Dialogs

Three modal dialogs are managed by `Canvas` via boolean state:

| Dialog          | Trigger                          | Component                                                          |
| :--------------- | :-------------------------------- | :------------------------------------------------------------------ |
| **Preferences** | Sidebar footer menu or `Cmd+,`  | `IrisPreferences`                                                  |
| **Memory**      | Sidebar footer menu              | `IrisMemory`                                                       |
| **Help**        | `Cmd+/` keyboard shortcut       | Inline keyboard shortcuts list with `Kbd` components               |

All dialogs use shadcn `Dialog` / `DialogContent` with screen-reader-only headers (`sr-only` on `DialogHeader`).

#### Authentication Gate

`page.tsx` calls `getCurrentUser()` server-side: authenticated users get `<Canvas user={result.user} />`; unauthenticated users see `<Hero33 />` wrapped in `<Suspense>`.

---

### Sidebar

**`AppSidebar`** (`components/app-sidebar.tsx`) uses shadcn `Sidebar` with `variant="floating"` (`rounded-2xl`, `shadow-card`).

#### Header

**"I R I S"** brand text in `text-accent-strong` with `tracking-display`. A plus button (`SidebarMenuAction`) creates new conversations.

#### Content Sections

Two sections:

**1. Artifacts** (`ArtifactsList`) -- A flat list of the user's files in Supabase Storage. Each entry shows the file name with a type icon and a delete action. Upload uses a hidden `<input type="file">` triggered programmatically.

**2. Conversations** (`ConversationsList`) -- Conversations grouped by **Today / Yesterday / Older** using `date-fns`. Each entry shows the conversation title, and hover reveals a delete button (`SidebarMenuAction showOnHover`).

#### Footer

User **avatar** with initials (from `user_metadata.full_name`, `.name`, or email) in `bg-accent-muted text-accent-strong`. A `DropdownMenu` provides:

- **Preferences** -- opens the settings dialog
- **Memory** -- opens the memory dialog
- **Sign Out** -- calls `signOut()` server action (styled with `text-destructive`)

#### Desktop vs. Mobile

Desktop: collapsible via `SidebarTrigger` (hidden when expanded). Mobile (`isMobile` from `useSidebar()`): sheet overlay capped at `min(264px, 85vw)`. Preferences and Memory dialogs render as bottom `Sheet` on mobile and centered `Dialog` on desktop (`canvas.tsx` conditionally switches based on `isMobile`). Sidebar action buttons (delete, etc.) that use `showOnHover` are always visible on touch devices via `touch:opacity-100`.

---

### Command Menu

Uses shadcn `Command` (`components/ui/command.tsx`, wrapping `cmdk`). The app relies on keyboard shortcuts rather than a global palette: `Cmd+,` opens Preferences, `Cmd+/` opens Help.

---

### Design System

#### Aesthetic

A **glassmorphic dark theme** built on **OKLCH color tokens** for perceptually uniform contrast.

#### Color Tokens

Defined as CSS custom properties in `globals.css` under `.dark`, registered as Tailwind utilities via `@theme inline`.

**Core palette:**

| Token                | Value                          | Tailwind Class         | Purpose                        |
| :-------------------- | :------------------------------ | :---------------------- | :------------------------------ |
| `--background`       | `oklch(0.155 0.007 35)`       | `bg-background`        | Page background                |
| `--foreground`       | `oklch(87% 0.014 38 / 95%)`   | `text-foreground`      | Primary text                   |
| `--muted`            | `oklch(21.5% 0.010 35 / 95%)` | `bg-muted`, `bg-card`  | Card/section backgrounds       |
| `--muted-foreground` | `oklch(62% 0.022 35 / 91%)`   | `text-muted-foreground` | Secondary text, labels         |
| `--accent`           | `oklch(72% 0.115 48)`         | (see note)             | Base accent hue                |
| `--primary`          | `oklch(40% 0.025 35)`         | `bg-primary`           | Primary interactive elements   |
| `--border`           | `oklch(19% 0.006 35)`         | `border-border`        | Borders and dividers           |
| `--ring`             | `oklch(27% 0.010 35)`         | `ring-ring`            | Focus rings                    |
| `--destructive`      | `oklch(42% 0.12 18)`          | `text-destructive`     | Error/danger (dim)             |
| `--success`          | `oklch(61% 0.10 155)`         | `text-success`         | Success states                 |

**Important**: `--color-accent` maps to `var(--surface-raised)` (a dark grey), NOT the brand orange. This is a deliberate design choice for shadcn hover/selected states. The brand orange lives in the accent scale below.

**Surface elevation** (progressive lightness for depth):

| Token              | Value                          | Purpose                              |
| :------------------ | :------------------------------ | :------------------------------------ |
| `--surface`        | `oklch(18.5% 0.008 35 / 95%)` | Elevated surface (above background)  |
| `--surface-raised` | `oklch(25% 0.012 35 / 95%)`   | Highest elevation surface            |

**Accent scale** (brand orange):

| Token            | Value                       | Tailwind Class                          | Purpose                                         |
| :---------------- | :--------------------------- | :--------------------------------------- | :------------------------------------------------ |
| `--accent-bg`    | `oklch(72% 0.115 48 / 10%)` | `bg-accent-bg`                          | Subtle tinted backgrounds                        |
| `--accent-muted` | `oklch(72% 0.115 48 / 20%)` | `bg-accent-muted`                       | Muted accent areas, avatar bg                    |
| `--accent-strong` | `oklch(80% 0.140 48)`      | `text-accent-strong`, `bg-accent-strong` | Brand orange -- active tab icons, headings       |

**Destructive scale:**

| Token                  | Value              | Purpose                                              |
| :---------------------- | :------------------ | :---------------------------------------------------- |
| `--destructive-strong` | `oklch(62% 0.22 18)` | Higher-contrast destructive for text on dark surfaces |

**Glass fills** (computed from `--muted` using OKLCH `from` syntax):

| Token                 | Opacity | Utility Class   | Purpose                |
| :--------------------- | :------- | :--------------- | :---------------------- |
| `--glass-fill-subtle` | 35%     | `glass-subtle`  | Tab bar, light overlays |
| `--glass-fill`        | 45%     | `glass-panel`   | Standard glass panels  |
| `--glass-fill-strong` | 55%     | `glass-card`    | Elevated glass cards   |
| `--glass-border`      | 60% of `--border` | --      | Glass element borders  |

**Overlay**: `--overlay: oklch(0% 0 0)` -- pure black for modal backdrops.

#### Glassmorphism Utilities

Three utility classes (in `@layer utilities`) provide fill, border, and shadow styling:

- **`glass-card`**: Strong fill + border + `shadow-card`
- **`glass-panel`**: Medium fill + border
- **`glass-subtle`**: Light fill only

Backdrop blur and saturation must be applied via Tailwind utilities directly on elements (e.g. `backdrop-blur-glass backdrop-saturate-glass`) because `@tailwindcss/postcss` strips `backdrop-filter` from custom class definitions.

#### Reduced Motion & Transparency

- **`prefers-reduced-motion`**: All animations, transitions, and scroll behavior are killed (`0.01ms` duration) via a base-layer media query. The `MotionConfig` wrapper passes `reducedMotion="user"` to `motion/react`.
- **`prefers-reduced-transparency`**: A media query replaces all glass tokens with opaque equivalents and disables `backdrop-filter` globally. The `--glass-saturate` drops to `1` (no boost).

#### Interactive Cursor Reset

A `@layer base` rule in `globals.css` restores `cursor: pointer` on interactive elements (button, role="button", select, a[href], etc.), excluded for `:not(:disabled)`. shadcn/ui components have `cursor-default` removed so the base rule applies.

#### Typography

**Satoshi** (self-hosted, `/fonts/`, weights 400/500, `font-display: swap`, WOFF2 primary with OTF fallback) for body and headings. **JetBrains Mono** (`@fontsource-variable/jetbrains-mono`) for code. Tightened type scale:

| Size   | Font Size  | Line Height |
| :------ | :---------- | :----------- |
| `2xs`  | 0.625rem   | 0.875rem    |
| `xs`   | 0.75rem    | 1rem        |
| `sm`   | 0.8125rem  | 1.25rem     |
| `base` | 0.875rem   | 1.5rem      |
| `lg`   | 1rem       | 1.5rem      |
| `xl`   | 1.125rem   | 1.75rem     |
| `2xl`  | 1.25rem    | 1.75rem     |
| `3xl`  | 1.5rem     | 2rem        |

Display title uses fluid sizing: `clamp(7.5rem, 30vw, 14rem)` with `0.21em` letter-spacing.

#### Spacing & Sizing Tokens

| Token              | Value              | Purpose                          |
| :------------------ | :------------------ | :-------------------------------- |
| `p-header`         | 48px               | Header height                    |
| `h-tab-bar`        | 44px               | Tab bar height                   |
| `h-touch` / `size-touch` | 44px          | Minimum touch target (Apple HIG) |
| `h-input`          | 36px               | Input field height               |
| `p-canvas-inset`   | 1.5rem             | Canvas edge padding              |
| `w-sidebar`        | 264px              | Desktop sidebar width            |
| `w-sidebar-mobile` | `min(264px, 85vw)` | Mobile sidebar width             |

Safe-area inset tokens map directly to CSS `env()` values:

| Token                | CSS Value                          |
| :-------------------- | :---------------------------------- |
| `spacing-safe-top`   | `env(safe-area-inset-top, 0px)`    |
| `spacing-safe-bottom` | `env(safe-area-inset-bottom, 0px)` |
| `spacing-safe-left`  | `env(safe-area-inset-left, 0px)`   |
| `spacing-safe-right` | `env(safe-area-inset-right, 0px)`  |

#### Shadows

| Token          | Value                              | Purpose               |
| :-------------- | :---------------------------------- | :--------------------- |
| `shadow-sm`    | `0 1px 2px oklch(0 0 0 / 0.3)`    | Subtle elevation      |
| `shadow-card`  | `0 4px 6px oklch(0 0 0 / 0.4)`    | Card-level elevation  |
| `shadow-modal` | `0 10px 15px oklch(0 0 0 / 0.5)`  | Modal/dialog elevation |
| `shadow-glow`  | `0 0 20px oklch(0.435 0.012 45 / 15%)` | Warm ambient glow |

#### Z-Index Scale

| Token        | Value | Purpose                    |
| :------------ | :----- | :-------------------------- |
| `z-dropdown` | 10    | Dropdowns, popovers        |
| `z-sticky`   | 20    | Sticky headers, tab bar    |
| `z-modal`    | 30    | Modals, dialogs            |
| `z-toast`    | 40    | Toast notifications        |
| `z-tooltip`  | 50    | Tooltips (always on top)   |

#### Custom Tailwind Variant

The `touch` variant (`@custom-variant touch (@media (pointer: coarse))`) targets touch devices, used to enlarge interactive elements to 44px minimum on phones/tablets. Applied systematically across:

- **Button** -- all size variants (`touch:h-touch`, `touch:size-touch`, etc.)
- **Checkbox** -- expanded hit area via `after:` pseudo-element (`touch:after:-inset-3`)
- **Switch** -- enlarged track (`touch:h-7 touch:w-12`) and thumb (`touch:h-5 touch:w-5`)
- **SidebarMenuButton** -- `touch:h-touch` / `touch:h-9` per size, with `touch:text-base` / `touch:text-sm`
- **SidebarMenuAction** -- `touch:w-9`, `touch:opacity-100` (always visible on touch, no hover required)
- **SidebarGroupLabel** -- `touch:h-touch touch:text-sm`

#### Border Radius

Base radius `0.875rem` with computed scale:

| Token           | Value                |
| :--------------- | :-------------------- |
| `radius-sm`     | `calc(radius - 4px)` |
| `radius-md`     | `calc(radius - 2px)` |
| `radius-lg`     | `0.875rem` (base)    |
| `radius-pill`   | `9999px`             |
| `radius-sidebar` | `60px`              |

#### shadcn Configuration

From `components.json`: style `radix-nova`, base color `stone`, icon library `lucide`, CSS variables enabled. Two additional registries are configured:

- **`@animate-ui`**: `https://animate-ui.com/r/{name}.json` -- animated primitive components
- **`@ai-elements`**: `https://ai-sdk.dev/elements/api/registry/{name}.json` -- AI chat UI components

---

### PWA Configuration

#### Manifest

Static manifest at `public/manifest.json`, linked via `app/layout.tsx` metadata:

| Property           | Value                                                         |
| :------------------ | :------------------------------------------------------------- |
| `name`             | IRIS \| GUARDIAN                                              |
| `short_name`       | IRIS                                                          |
| `description`      | Your personal AI assistant powered by Claude                  |
| `display`          | `standalone`                                                  |
| `orientation`      | `portrait-primary`                                            |
| `background_color` | `#1f1b16`                                                     |
| `theme_color`      | `#1f1b16`                                                     |
| `start_url`        | `/?utm_source=pwa`                                            |
| `scope`            | `/`                                                           |
| `icons`            | PNG icons at 192x192 and 512x512 (`any` + `maskable` variants) |
| `shortcuts`        | "New Chat" -- launches `/?new=1` from home screen             |
| `share_target`     | Receives shared text via `GET /?shared_text=...`              |

#### Favicons & Icons

In `app/layout.tsx` `icons` metadata, all files in `public/`:

| File                   | Size    | Purpose                          |
| :---------------------- | :------- | :-------------------------------- |
| `favicon-16x16.png`   | 16x16   | Browser tab (small contexts)     |
| `favicon-32x32.png`   | 32x32   | Browser tab (standard)           |
| `icon-192x192.png`    | 192x192 | PWA icon, notification icon      |
| `icon-512x512.png`    | 512x512 | PWA splash/install               |
| `apple-touch-icon.png` | 512x512 | iOS home screen bookmark         |

#### Viewport

Via Next.js `Viewport` export in `app/layout.tsx`:

| Property       | Value          | Purpose                             |
| :-------------- | :-------------- | :----------------------------------- |
| `width`        | `device-width` | Standard responsive                 |
| `initialScale` | `1`            | No zoom on load                     |
| `maximumScale` | `1`            | Prevents pinch zoom (app-like)      |
| `userScalable` | `false`        | Locks zoom level                    |
| `viewportFit`  | `cover`        | Extends into notch/safe areas       |
| `themeColor`   | `#1f1b16`      | Matches `background_color`          |

#### Apple Web App

Standalone mode on iOS:

| Property         | Value                |
| :---------------- | :-------------------- |
| `capable`        | `true`               |
| `statusBarStyle` | `black-translucent`  |
| `title`          | Iris                 |

`html` has hardcoded `dark` class with `suppressHydrationWarning`. `body` uses `font-sans` (Satoshi), `overflow-x-hidden`, and `overscroll-behavior: none` to prevent pull-to-refresh and overscroll bounce on mobile. Sizing tokens use `dvh` (dynamic viewport height) instead of `vh` to account for mobile browser chrome.

---

## Infrastructure Features

---

### Realtime

Enabled on four tables via the `supabase_realtime` publication (migration `20250131000004`):

| Table                    | Events                  | REPLICA IDENTITY | Use Case                                        |
| :------------------------ | :----------------------- | :---------------- | :------------------------------------------------ |
| `conversation_messages`  | INSERT, UPDATE, DELETE  | **FULL**         | Instant message delivery from agent to UI        |
| `notifications`          | INSERT, UPDATE, DELETE  | DEFAULT          | Real-time notification alerts, read state sync   |
| `reminders`              | INSERT, UPDATE, DELETE  | DEFAULT          | Reminder triggers, snooze sync                   |
| `projects`               | INSERT, UPDATE, DELETE  | DEFAULT          | Project updates and member activity              |

#### REPLICA IDENTITY FULL

`conversation_messages` uses `REPLICA IDENTITY FULL` so UPDATE/DELETE events include the complete previous row (enabling delete handling via the `old` payload). The tradeoff -- slightly increased WAL size -- is negligible at Iris's scale.

#### Frontend Subscriptions (Postgres Changes)

Three hooks consume realtime events via `postgres_changes`:

**`use-conversations.ts`** subscribes to `conversations-realtime`:

- **INSERT:** Prepends new conversations to the sidebar list
- **UPDATE:** Replaces the matching conversation (e.g. title auto-generated by the agent)
- **DELETE:** Removes the conversation; if it was the active conversation, clears `active_conversation_id`

**`use-user-settings.tsx`** subscribes to `user-settings-realtime`:

- **UPDATE:** Syncs settings changes from other devices/tabs, with debounce-awareness to preserve locally pending field updates

All hooks filter by `user_id` and clean up channels on unmount via `supabase.removeChannel()`.

#### Room-Based Private Broadcast Channels

Room-based broadcast infrastructure for scoped, multi-party messaging:

**Database tables:** `rooms`, `room_members`, `messages` (all with RLS enabled). A database trigger broadcasts INSERT/UPDATE/DELETE events on `public.messages` to the topic `room:<room_id>:messages`.

**RLS on `realtime.messages`:** Only authenticated room members can receive or send broadcasts on a room's topic. This is enforced at the Supabase Realtime layer, not just client-side filtering.

#### How Realtime Interacts with RLS

Realtime respects RLS: users only receive change events for rows they can SELECT. Since every policy scopes to `user_id = auth.uid()`, cross-user leakage is impossible. Room-based broadcasts additionally enforce membership via RLS on `realtime.messages`.

---

### Data Export

See [Memory Management > Data Export](#data-export) above for details on `GET /api/user/export`.

---

### Edge Function Details

#### `memory` -- Knowledge & Episodic Memory API

Six routes:

- **`POST /memory/search`** -- The semantic search endpoint. Embeds the query, runs `search_embeddings` and `match_memories` RPCs in parallel against both memory tables, normalizes results to a common shape, and returns merged results sorted by descending similarity. Skips the episodic table when filtering by knowledge-only types (`file`). Accepts optional `projectId` for project-scoped search (passed to both RPCs as `filter_project_id`/`p_project_id`).

- **`POST /memory`** -- Stores a new entry in `knowledge_embeddings`. Generates an embedding from the content, inserts with `content_type` (default `memory`), optional `source_id`, `source_table`, `meta` JSONB, and `project_id` column.

- **`POST /memory/context`** -- Stores episodic context in `semantic_memory`. Generates an embedding, inserts with `memory_type` (enum), `importance` (default 0.5), optional `expires_at`, `source_type`, `source_id`, `metadata` JSONB, and `project_id` column.

- **`GET /memory`** -- Lists knowledge embeddings for the user with pagination (`limit`, `offset`) and optional `content_type` filter. Returns rows without the embedding vector.

- **`GET /memory/:id`** -- Returns a single knowledge embedding entry.

- **`DELETE /memory/:id`** -- Hard-deletes a knowledge embedding entry.

Mutations use a service-role client; reads use the user's JWT-authenticated client for RLS compliance.

#### `embed` -- Standalone Embedding Generation

Accepts `{ text }`, returns `{ embedding }`. No auth required (CORS only). Useful for ad-hoc embedding generation and debugging.

#### `push-send` -- Web Push Delivery

Delivers pending notifications (`push_sent = false`) via `@negrel/webpush`. Tracks per-notification success -- only marks `push_sent = true` for notifications that had at least one successful device delivery. Notifications with all-stale endpoints are also marked sent after stale cleanup to prevent infinite retry. Cleans up stale subscriptions on 410 Gone.

#### `reminder-check` -- Scheduled Reminder Processing

Runs every 2 minutes via `pg_cron` + `pg_net`. Queries due reminders (`remind_at <= now()`, `status = 'pending'`) and expired snoozed reminders. For each: inserts a notification row (with `action_url: '/chat'`), handles recurrence (computes next occurrence), and triggers `push-send` for delivery.

---

### Agent Hook System

Hooks provide safety, observability, and automation around tool execution. The lifecycle covers PreToolUse (rate limiting, timing, auto-approve), PostToolUse (stream output, audit logging), failure handling, session stop, subagent lifecycle, and compaction events. See [architecture.md](architecture.md) for the complete hook pipeline, ordering, and implementation details.

---

## Locale-Aware Formatting

### Agent Locale Injection

On every `POST /api/chat`, `route.ts` appends a `<user_locale>` block to the system prompt with language, timezone, date/time format, and output preference from `user_settings`. The agent then responds in the user's configured locale without per-conversation repetition.

---

### Client-Side Formatting

`useFormat()` (`hooks/use-format.ts`) reads locale from `useUserSettings()` and provides:

| Function              | Purpose                                                     | Example Output                          |
| :--------------------- | :----------------------------------------------------------- | :--------------------------------------- |
| `formatDate(date)`    | Formats a date according to the user's `date_format` setting | `27/02/2026` (DD/MM/YYYY) or `02/27/2026` (MM/DD/YYYY) |
| `formatTime(date)`    | Formats a time according to the user's `time_format` setting | `2:30 PM` (12h) or `14:30` (24h)       |
| `formatDateTime(date)` | Combined date and time                                      | `27/02/2026, 2:30 PM`                  |
| `formatRelative(date)` | Relative time description                                   | `3 days ago`, `in 2 hours`             |

Backed by `date-fns` with locale support (`lib/format.ts`), mapping the `language` setting to the appropriate `date-fns` locale object. All date displays use these formatters.

---

## Projects

Organisational containers grouping related conversations and memories. The `projects` table stores name, description, and optional workspace/GitHub integration fields.

---

### Agent Tool -- manage_project

**Actions:**

- `list` -- returns all projects for the user
- `get` -- returns a single project by ID
- `create` -- requires `name`, optional `description`
- `update` -- requires `projectId`, accepts `name`, `description`
- `delete` -- requires `projectId`, permanently removes the project

The agent checks for existing projects (via `list`) before creating new ones and associates memories with projects using `projectId` on `store_memory`.

---

### Cross-Tool Integration

`store_memory`, `log_context`, and `search_knowledge` all accept optional `projectId` for project-scoped memory and retrieval.

---

## Push Notifications

PWA push notifications for agent alerts and reminders. On iOS, push requires installing as a PWA (standalone mode, iOS 16.4+). On desktop browsers (Chrome, Firefox, Edge), push works in regular browser tabs without PWA installation.

---

### Database Schema

**`push_subscriptions`** -- Web Push subscriptions per user per device:

- `id` (UUID, PK)
- `user_id` (UUID, FK to `auth.users`)
- `endpoint` (text) -- the push service endpoint URL
- `keys` (JSONB) -- `{ p256dh, auth }` encryption keys
- `created_at` (timestamptz)

**`notifications`** -- stores notification payloads with delivery tracking:

- `id` (UUID, PK)
- `user_id` (UUID, FK to `auth.users`)
- `type` (`notification_type` enum) -- `reminder`, `mention`, `system`, `achievement`
- `title` (text)
- `body` (text)
- `data` (JSONB, nullable) -- arbitrary payload for click routing
- `read` (boolean, default `false`)
- `push_sent` (boolean, default `false`) -- tracks whether the push has been delivered
- `created_at` (timestamptz)

Both tables have RLS policies scoped to `user_id = auth.uid()`.

---

### Edge Functions

**`push-send`** -- delivers pending notifications via `@negrel/webpush` with per-notification success tracking. Only marks `push_sent = true` for notifications with at least one successful device delivery. Cleans up stale subscriptions on 410 Gone.

**`reminder-check`** -- processes due reminders on a 2-minute `pg_cron` schedule. Creates notification rows for pending/expired-snoozed reminders, handles recurrence computation, and triggers `push-send` for delivery.

---

### Server-Side

**`POST /api/user/test-push`** -- authenticated endpoint that inserts a test notification and triggers `push-send` for immediate delivery. Used by the "Send test notification" button in Preferences.

---

### Client-Side

**`usePushNotifications()`** (`hooks/use-push-notifications.ts`) manages the full push lifecycle:

1. **Service worker registration** -- registers `public/sw.js` on mount
2. **Permission management** -- exposes `permission` state (`default`, `granted`, `denied`) and a `requestPermission()` function
3. **Subscribe/unsubscribe** -- on permission grant, creates a `PushSubscription` via the Push API and stores it in the `push_subscriptions` table. On unsubscribe, removes the subscription row.

**Service worker** (`public/sw.js`) handles four events:

- **`install`** -- calls `skipWaiting()` to activate immediately
- **`activate`** -- calls `clients.claim()` to take control of all open tabs
- **`push`** -- parses the notification payload and calls `self.registration.showNotification()` with the title, body, and icon
- **`notificationclick`** -- routes the user to the URL specified in the notification's `data` field, then closes the notification

**Install prompt** (`hooks/use-install-prompt.ts`) captures the `beforeinstallprompt` event, exposing `canInstall` and `promptInstall()`. When available, an "Install App" option appears in the sidebar user dropdown.

---

### PWA Manifest

See [PWA Configuration](#pwa-configuration) for manifest details.

---

### Agent Tool -- send_notification

`send_notification` inserts a `notifications` row with `type: 'system'`, custom `title`/`body`, and optional `data` for click routing. The `push-send` function delivers on its next invocation.
