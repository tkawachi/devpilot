export interface Logger {
  info(message: string): void;
  warn?(message: string): void;
  error?(message: string): void;
  debug?(message: string): void;
}

export function normalizeLogger(logger?: Logger): Required<Logger> {
  const fallback = console;
  const target = logger ?? fallback;
  return {
    info: target.info ? target.info.bind(target) : fallback.log.bind(fallback),
    warn: target.warn ? target.warn.bind(target) : fallback.warn.bind(fallback),
    error: target.error ? target.error.bind(target) : fallback.error.bind(fallback),
    debug: target.debug
      ? target.debug.bind(target)
      : (fallback.debug ?? fallback.log).bind(fallback)
  };
}
