export function createLogger(fn: string) {
  const log = (level: string, msg: string, data?: unknown) =>
    console.log(JSON.stringify({ level, fn, msg, data, ts: new Date().toISOString() }))

  return {
    debug: (msg: string, data?: unknown) => log('debug', msg, data),
    info: (msg: string, data?: unknown) => log('info', msg, data),
    warn: (msg: string, data?: unknown) => log('warn', msg, data),
    error: (msg: string, data?: unknown) => log('error', msg, data),
  }
}
