const REDACTED = '[REDACTED]'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function redactSecrets(value: string, absolutePaths: readonly string[] = []): string {
  let result = value
  for (const path of [...absolutePaths].sort((left, right) => right.length - left.length)) {
    if (path.length > 0) result = result.replace(new RegExp(escapeRegExp(path), 'gi'), REDACTED)
  }
  result = result.replace(/Authorization\s*:\s*(?:Bearer\s+)?\S+/gi, `Authorization: ${REDACTED}`)
  result = result.replace(/sk-[A-Za-z0-9_-]+/g, REDACTED)
  result = result.replace(/[A-Za-z]:\\[^\r\n"']*?\.webm(?:\.part)?/gi, REDACTED)
  result = result.replace(/\/(?:[^\s/]+\/)+[^\s"']*?\.webm(?:\.part)?/gi, REDACTED)
  return result
}
