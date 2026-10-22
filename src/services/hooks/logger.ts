export function log(msg: string): void {
  process.stdout.write(`[hooks] ${msg}\n`)
}

export function logError(msg: string): void {
  process.stderr.write(`[hooks] ${msg}\n`)
}
