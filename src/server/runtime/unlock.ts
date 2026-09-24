// S32a (AH22) — the unlock page the shell renders instead of the artefact when
// a public link's password gate challenges the viewer. Server-rendered, no SPA
// and no script. It names nothing about the artefact (not even its title): the
// viewer has not proved the password yet.

export type UnlockError = "wrong" | "rate-limited";

const MESSAGES: Record<UnlockError, string> = {
  wrong: "Wrong password. Try again.",
  "rate-limited": "Too many attempts. Wait 15 minutes, then try again.",
};

export function renderUnlockPage(ctx: { slug: string; error?: UnlockError }): string {
  const action = `/a/${encodeURIComponent(ctx.slug)}/unlock`;
  const error = ctx.error
    ? `<p class="err" role="alert">${MESSAGES[ctx.error]}</p>`
    : "";
  const disabled = ctx.error === "rate-limited" ? " disabled" : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Password required · Artefactor</title>
<style>
  :root { color-scheme: light dark; --bg:#fafafa; --card:#fff; --fg:#18181b; --muted:#71717a; --border:#e4e4e7; --primary:#18181b; --primary-fg:#fff; --err:#dc2626; }
  @media (prefers-color-scheme: dark) { :root { --bg:#09090b; --card:#18181b; --fg:#fafafa; --muted:#a1a1aa; --border:#27272a; --primary:#fafafa; --primary-fg:#18181b; --err:#f87171; } }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; background:var(--bg); color:var(--fg); font:14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { width:100%; max-width:360px; background:var(--card); border:1px solid var(--border); border-radius:16px; padding:28px 24px; }
  h1 { margin:0 0 4px; font-size:17px; font-weight:600; }
  p { margin:0 0 18px; color:var(--muted); font-size:13px; }
  label { display:block; font-size:12.5px; font-weight:500; margin-bottom:6px; }
  input { width:100%; height:40px; padding:0 12px; border:1px solid var(--border); border-radius:9px; background:transparent; color:var(--fg); font:inherit; }
  button { width:100%; height:40px; margin-top:14px; border:none; border-radius:9px; background:var(--primary); color:var(--primary-fg); font:inherit; font-weight:600; cursor:pointer; }
  button:disabled { opacity:.5; cursor:not-allowed; }
  .err { margin:12px 0 0; color:var(--err); font-size:12.5px; }
</style>
</head>
<body>
<main>
  <h1>This link is password protected</h1>
  <p>Enter the password the owner shared with you to open it.</p>
  <form method="post" action="${action}">
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required autofocus${disabled}>
    ${error}
    <button type="submit"${disabled}>Open</button>
  </form>
</main>
</body>
</html>`;
}
