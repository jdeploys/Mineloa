import { redactSecrets } from './redactSecrets'

export type OpenAiErrorCode =
  | 'OPENAI_API_KEY_MISSING'
  | 'OPENAI_UNAUTHORIZED'
  | 'OPENAI_RATE_LIMITED'
  | 'OPENAI_TIMEOUT'
  | 'OPENAI_NETWORK'
  | 'OPENAI_INVALID_AUDIO'
  | 'OPENAI_MALFORMED_RESPONSE'
  | 'OPENAI_UNKNOWN'

export class OpenAiError extends Error {
  constructor(
    readonly code: OpenAiErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'OpenAiError'
  }
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) return undefined
  return typeof error.status === 'number' ? error.status : undefined
}

function detailsOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function toOpenAiError(error: unknown, absolutePaths: readonly string[] = []): OpenAiError {
  if (error instanceof OpenAiError) {
    return new OpenAiError(error.code, redactSecrets(error.message, absolutePaths), error.retryable)
  }

  const status = statusOf(error)
  const name = error instanceof Error ? error.name.toLowerCase() : ''
  const raw = detailsOf(error)
  const lower = raw.toLowerCase()
  let code: OpenAiErrorCode = 'OPENAI_UNKNOWN'
  let retryable = false

  if (status === 401 || status === 403) code = 'OPENAI_UNAUTHORIZED'
  else if (status === 429) {
    code = 'OPENAI_RATE_LIMITED'
    retryable = true
  } else if (name.includes('timeout') || lower.includes('timed out') || lower.includes('timeout')) {
    code = 'OPENAI_TIMEOUT'
    retryable = true
  } else if (
    status === 400 ||
    status === 413 ||
    lower.includes('invalid audio') ||
    lower.includes('unsupported audio')
  ) {
    code = 'OPENAI_INVALID_AUDIO'
  } else if (
    name.includes('connection') ||
    name.includes('network') ||
    ['ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'EAI_AGAIN'].some((token) =>
      raw.includes(token),
    )
  ) {
    code = 'OPENAI_NETWORK'
    retryable = true
  }

  return new OpenAiError(code, redactSecrets(raw, absolutePaths), retryable)
}
