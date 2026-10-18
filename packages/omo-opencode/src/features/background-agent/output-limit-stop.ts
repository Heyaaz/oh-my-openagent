import { isRecord } from "./error-classifier"

const RESULT_PART_TYPES = new Set(["tool", "tool_use", "tool_result"])

function readOutputTokenCount(tokens: unknown): number | undefined {
  if (!isRecord(tokens)) return undefined
  const output = tokens.output
  if (typeof output !== "number" || !Number.isFinite(output) || output <= 0) return undefined
  return output
}

function readParts(message: Record<string, unknown>): readonly unknown[] {
  return Array.isArray(message.parts) ? message.parts : []
}

function stoppedOnOutputLimit(info: Record<string, unknown>, parts: readonly unknown[]): boolean {
  const finish = info.finish
  if (finish === "length") return true
  if (typeof finish === "string" && finish.length > 0) return false

  let lastReason: unknown
  for (const part of parts) {
    if (!isRecord(part) || part.type !== "step-finish") continue
    lastReason = part.reason
  }
  return lastReason === "length"
}

function finalTurnHasResult(parts: readonly unknown[]): boolean {
  for (const part of parts) {
    if (!isRecord(part)) continue
    const type = part.type
    if ((type === "text" || type === "reasoning") && typeof part.text === "string" && part.text.trim().length > 0) {
      return true
    }
    if (typeof type === "string" && RESULT_PART_TYPES.has(type)) return true
  }
  return false
}

function readFinalOutputTokens(info: Record<string, unknown>, parts: readonly unknown[]): number | undefined {
  const fromInfo = readOutputTokenCount(info.tokens)
  if (fromInfo !== undefined) return fromInfo

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]
    if (!isRecord(part) || part.type !== "step-finish") continue
    return readOutputTokenCount(part.tokens)
  }
  return undefined
}

export function getOutputLimitStop(messages: readonly unknown[]): string | undefined {
  const latest = messages[messages.length - 1]
  if (!isRecord(latest)) return undefined
  const info = isRecord(latest.info) ? latest.info : undefined
  if (!info || info.role !== "assistant") return undefined

  const parts = readParts(latest)
  if (!stoppedOnOutputLimit(info, parts)) return undefined

  const outputTokens = readFinalOutputTokens(info, parts)
  const tokenText = outputTokens === undefined ? "" : ` (${outputTokens} tokens)`
  const resultText = finalTurnHasResult(parts) ? "" : ", no result"
  return `stopped at output limit${tokenText}${resultText}`
}
