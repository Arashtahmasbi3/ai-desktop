/**
 * Full-access auto-disable countdown (v2.6.1, B.3).
 *
 * Pure so the execution bar and the full-access banner can render the same
 * "MM:SS" value and it can be unit-tested without a running timer.
 */

/** Formats a remaining duration as `MM:SS`, or `H:MM:SS` past an hour. */
export function formatCountdown(remainingMs: number): string {
  const total = Math.max(0, Math.floor(remainingMs / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (value: number): string => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}
