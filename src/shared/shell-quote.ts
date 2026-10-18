/**
 * POSIX shell quoting — one implementation, one place (F0-5).
 *
 * The audit found **seven** copies of this function: `job-manager`, `sandbox/paths`, `tools/diagnostics-tools`,
 * `tools/remote-fs-tools`, `agent/crash-diagnosis`, `agent/preflight` and `main/vps-ipc`. Six were textually
 * identical and the seventh used double quotes for the same replacement, so they agreed by luck rather than by
 * contract. This function is on the path of every remote command, `sudo useradd`, `mysqldump`, `rsync` and
 * `rm -rf` argument the agent builds: seven copies of a quoting rule is seven chances for one copy to be fixed
 * and the others to stay wrong.
 *
 * The rule is the standard POSIX one: wrap in single quotes and replace every embedded `'` with `'\''`, which
 * closes the quote, emits an escaped quote, and reopens it. Nothing inside single quotes is special, so the result
 * is safe for spaces, `$`, backticks, `;`, `|`, `&`, newlines and unicode alike — and a test proves it by actually
 * running a shell rather than by comparing strings.
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
