export type ModelOption = {
  id: string
  name: string
  provider: 'anthropic'
  maxOutput: number
  contextWindow: number
  defaultMaxOutput: number
  thinkingBudget: number
}

export const MODELS: readonly ModelOption[] = [
  {
    id: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    provider: 'anthropic',
    maxOutput: 128_000,
    contextWindow: 200_000,
    defaultMaxOutput: 32_768,
    thinkingBudget: 16_384,
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    provider: 'anthropic',
    maxOutput: 64_000,
    contextWindow: 200_000,
    defaultMaxOutput: 16_384,
    thinkingBudget: 8_192,
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    provider: 'anthropic',
    maxOutput: 64_000,
    contextWindow: 200_000,
    defaultMaxOutput: 8_192,
    thinkingBudget: 4_096,
  },
] as const

// Safe: MODELS has 3 entries; index 1 always exists.
const DEFAULT_MODEL = MODELS[1] as ModelOption

const MODEL_MAP = new Map(MODELS.map((m) => [m.id, m]))

export function getModelOrDefault(id: string): ModelOption {
  return MODEL_MAP.get(id) ?? DEFAULT_MODEL
}

export function isValidModelId(id: unknown): id is string {
  return typeof id === 'string' && MODEL_MAP.has(id)
}

const TOKEN_TIER_BASE = 4_096
const TOKEN_TIER_COUNT = 6

const TOKEN_TIERS = Array.from({ length: TOKEN_TIER_COUNT }, (_, i) => TOKEN_TIER_BASE * 2 ** i)

export function getMaxOutputOptions(modelId: string): { value: number; label: string }[] {
  const model = getModelOrDefault(modelId)
  return TOKEN_TIERS.filter((t) => t <= model.maxOutput).map((t) => ({
    value: t,
    label: `${t / 1_024}K`,
  }))
}
