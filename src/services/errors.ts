export type ApiErrorKind =
  | 'network'
  | 'timeout'
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'validation'
  | 'rate-limited'
  | 'server'
  | 'invalid-response'
  | 'unknown'

export interface ApiErrorOptions {
  kind: ApiErrorKind
  status?: number
  code?: number
  cause?: unknown
}

/**
 * Error safe to pass through the view layer. Raw server/network errors stay in
 * `cause` for development diagnostics and are never rendered directly.
 */
export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status?: number
  readonly code?: number

  constructor(message: string, options: ApiErrorOptions) {
    super(message)
    this.name = 'ApiError'
    this.kind = options.kind
    this.status = options.status
    this.code = options.code
    if (options.cause !== undefined) {
      ;(this as Error & { cause?: unknown }).cause = options.cause
    }
  }
}

const TECHNICAL_MESSAGE_PATTERN =
  /(exception|stack\s*trace|\bat\s+[\w.$]+\(|sql(state|syntax)?|jdbc|mybatis|redis|java\.|org\.spring|com\.licong|\/api\/|https?:\/\/|\/users\/|\/var\/|\/tmp\/|[a-z]:\\|\.java:\d+|\.ts:\d+|proxy|endpoint|后端|服务日志|接口响应格式|内部错误)/i

function cleanMessage(message: unknown) {
  if (typeof message !== 'string') return ''
  return message.replace(/\s+/g, ' ').trim()
}

/** Only 4xx business messages which look user-facing are allowed through. */
export function safeServerMessage(
  message: unknown,
  status: number | undefined,
  fallback: string,
) {
  const cleaned = cleanMessage(message)
  if (!cleaned || !status || status < 400 || status >= 500) return fallback
  if (cleaned.length > 180 || TECHNICAL_MESSAGE_PATTERN.test(cleaned)) return fallback
  return cleaned
}

function kindFromStatus(status?: number): ApiErrorKind {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not-found'
  if (status === 429) return 'rate-limited'
  if (status && status >= 500) return 'server'
  if (status && status >= 400) return 'validation'
  return 'unknown'
}

export function apiErrorFromResponse(
  status: number,
  code: number | undefined,
  serverMessage: unknown,
  fallback = '操作未完成，请稍后重试',
) {
  const effectiveStatus = code && code >= 400 ? code : status
  const kind = kindFromStatus(effectiveStatus)
  const defaultMessage =
    kind === 'unauthorized'
      ? '登录状态已失效，请重新登录'
      : kind === 'forbidden'
        ? '当前账号无权执行此操作'
        : kind === 'rate-limited'
          ? '操作过于频繁，请稍后再试'
          : kind === 'server'
            ? '服务暂时不可用，请稍后重试'
            : fallback

  return new ApiError(safeServerMessage(serverMessage, effectiveStatus, defaultMessage), {
    kind,
    status,
    code,
  })
}

export function apiErrorFromUnknown(error: unknown, fallback = '操作未完成，请稍后重试') {
  if (error instanceof ApiError) return error
  if (error instanceof DOMException && error.name === 'AbortError') return error
  return new ApiError(fallback, { kind: 'network', cause: error })
}

/** The only helper views should use when turning an unknown exception into UI copy. */
export function getUserErrorMessage(error: unknown, fallback = '操作未完成，请稍后重试') {
  if (error instanceof ApiError) return error.message
  return fallback
}
