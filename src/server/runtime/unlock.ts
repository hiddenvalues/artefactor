// S32a (AH22) — the unlock page the shell renders instead of the artefact when
// a public link's password gate challenges the viewer. Server-rendered, no SPA
// and no script. It names nothing about the artefact (not even its title): the
// viewer has not proved the password yet.
//
// S45 — it wears Mint garden (shell-theme.ts) in light and dark. Having no
// script, it can't read the viewer's stored choice, so it follows the OS.

import { shellThemeCss } from "./shell-theme";

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
  ${shellThemeCss("media")}
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; background:var(--muted); color:var(--foreground); font:14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { width:100%; max-width:360px; background:var(--card); border:1px solid var(--border); border-radius:16px; padding:28px 24px; }
  h1 { margin:0 0 4px; font-size:17px; font-weight:600; }
  p { margin:0 0 18px; color:var(--muted-foreground); font-size:13px; }
  label { display:block; font-size:12.5px; font-weight:500; margin-bottom:6px; }
  input { width:100%; height:40px; padding:0 12px; border:1px solid var(--border); border-radius:9px; background:transparent; color:var(--foreground); font:inherit; }
  input:focus-visible { outline:2px solid var(--ring); outline-offset:1px; }
  button { width:100%; height:40px; margin-top:14px; border:none; border-radius:9px; background:var(--primary); color:var(--primary-foreground); font:inherit; font-weight:600; cursor:pointer; }
  button:disabled { opacity:.5; cursor:not-allowed; }
  .err { margin:12px 0 0; color:var(--destructive); font-size:12.5px; }
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
