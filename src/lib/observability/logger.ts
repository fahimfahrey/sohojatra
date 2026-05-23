/**
 * Safe logging wrapper. Every call goes through redact() so passwords,
 * tokens, phone numbers, and email addresses are replaced with [REDACTED]
 * before they hit stdout, stderr, or any platform log sink.
 *
 * Drop-in for console.* — use `logger.info("...")` instead of `console.log`.
 * Existing console.* calls still work but bypass redaction; migrate them
 * over time, prioritising sites that log error objects, request payloads,
 * or auth state.
 */

import { redactArgs } from "./redact";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function currentLevel(): LogLevel {
  const env = process.env.LOG_LEVEL?.toLowerCase();
  if (env === "debug" || env === "info" || env === "warn" || env === "error") {
    return env;
  }
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

function emit(level: LogLevel, args: unknown[]): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[currentLevel()]) return;
  const safe = redactArgs(args);
  const sink =
    level === "error" ? console.error
    : level === "warn" ? console.warn
    : level === "debug" ? console.debug
    : console.log;
  sink(...safe);
}

export const logger = {
  debug: (...args: unknown[]) => emit("debug", args),
  info: (...args: unknown[]) => emit("info", args),
  warn: (...args: unknown[]) => emit("warn", args),
  error: (...args: unknown[]) => emit("error", args),
};
