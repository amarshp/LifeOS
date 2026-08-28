// Turns a raw OpenAI error response into a message worth showing a user —
// specifically, distinguishes "you're out of credits" from any other failure,
// which otherwise all collapse into an opaque "openai error 429".

/** True for OpenAI's insufficient_quota response (credits/billing exhausted,
 *  not a transient rate limit — retrying won't help). */
export function isOpenAIQuotaExceeded(status: number, detail: string): boolean {
  if (status !== 429) return false
  try {
    const body = JSON.parse(detail)
    return body?.error?.code === 'insufficient_quota' || body?.error?.type === 'insufficient_quota'
  } catch {
    return false
  }
}

export const OPENAI_QUOTA_MESSAGE =
  'The assistant is unavailable right now — OpenAI credits are exhausted. Add billing credits, then try again.'

/** Map an OpenAI error response to a user-facing message, falling back to a
 *  generic one for anything that isn't the quota case. */
export function describeOpenAIError(status: number, detail: string): string {
  if (isOpenAIQuotaExceeded(status, detail)) return OPENAI_QUOTA_MESSAGE
  return `openai error ${status}`
}
