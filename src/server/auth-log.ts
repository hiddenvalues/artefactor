// S51 — BetterAuth's log sink. BetterAuth hands its logger whole error
// objects, and their fields can carry a URL-borne credential: every `StateError`
// a failed OAuth callback throws holds `details: { state }`. This sink replaces
// BetterAuth's console sink (its `logger.log` option) and prints what failed —
// the message, and an error's name, message, string `code`, stack and cause
// chain — never a value it was handed. It fails closed: every other field prints
// its name only, so a field a later BetterAuth adds is redacted unlisted.

const REDACTED = "[redacted]";
const UNPRINTABLE = "[unprintable]";

// A key as printed: bare when it is an identifier, else JSON-quoted, so a crafted
// key can't inject a newline and forge a log line.
function keyName(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
}

function redactedKeys(keys: string[]): string {
  return keys.map((key) => `${keyName(key)}: ${REDACTED}`).join(", ");
}

// An error's own properties the rule prints itself rather than redacting.
const PRINTED_ERROR_FIELDS = new Set(["name", "message", "stack", "cause"]);

function renderError(err: Error, seen: Set<object>): string {
  if (seen.has(err)) return "[circular]";
  seen.add(err);
  const name = String(err.name);
  const ctor = err.constructor?.name;
  const lines = [`${ctor && ctor !== name ? `${ctor} [${name}]` : name}: ${String(err.message)}`];
  if (typeof err.stack === "string") {
    lines.push(...err.stack.split("\n").filter((line) => /^\s+at /.test(line)));
  }
  const code = (err as { code?: unknown }).code;
  const fields = Object.getOwnPropertyNames(err).filter(
    (key) => !PRINTED_ERROR_FIELDS.has(key) && !(key === "code" && typeof code === "string"),
  );
  const shown = [
    ...(typeof code === "string" ? [`code: ${JSON.stringify(code)}`] : []),
    ...(fields.length > 0 ? [redactedKeys(fields)] : []),
  ];
  if (shown.length > 0) lines.push(`  { ${shown.join(", ")} }`);
  if ("cause" in err) lines.push(`  [cause]: ${render(err.cause, seen)}`);
  return lines.join("\n");
}

function render(arg: unknown, seen: Set<object>): string {
  if (arg === null || (typeof arg !== "object" && typeof arg !== "function")) return String(arg);
  if (typeof arg === "function") return "[function]";
  if (arg instanceof Error) return renderError(arg, seen);
  // Own enumerable key names only: reading them invokes no getter.
  const keys = redactedKeys(Object.keys(arg));
  const [open, close] = Array.isArray(arg) ? ["[", "]"] : ["{", "}"];
  return keys === "" ? `${open}${close}` : `${open} ${keys} ${close}`;
}

/** One BetterAuth log argument as printed: never a value it carries. Never throws. */
// r[impl identity.log.auth-log-no-values]
export function renderLogArg(arg: unknown): string {
  try {
    return render(arg, new Set());
  } catch {
    return UNPRINTABLE;
  }
}

/**
 * BetterAuth's `logger.log`: called only for levels its logger publishes (default
 * `warn` and up), in its own uncoloured line shape and console routing.
 */
// r[impl identity.log.auth-log-sink]
export function authLog(level: string, message: string, ...args: unknown[]): void {
  const line = [
    `${new Date().toISOString()} ${String(level).toUpperCase()} [Better Auth]: ${String(message)}`,
    ...args.map(renderLogArg),
  ].join(" ");
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
