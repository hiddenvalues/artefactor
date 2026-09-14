import type { Hono } from "hono";

// S36 — a frame reads no cookies: it is opened with a frame token the shell
// mints for the signed-in viewer. These helpers open a frame the way the shell
// does, so a test can keep asking "can this viewer see the artefact's frame?".

export interface MintedFrame {
  frameUrl: string;
  seedUpdatedAt: string | null;
}

// `POST /api/artefacts/:ref/frame-token` as `cookie`; the raw response.
export async function mintFrameToken(
  app: Hono,
  ref: string,
  cookie: string,
  author?: string,
): Promise<Response> {
  return app.request(`/api/artefacts/${encodeURIComponent(ref)}/frame-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify(author ? { author } : {}),
  });
}

// Open the artefact's frame as `cookie` (minting a token first), or anonymously
// with no token. A mint the viewer is denied returns the mint's own response.
export async function openFrame(
  app: Hono,
  ref: string,
  cookie?: string,
  author?: string,
): Promise<Response> {
  if (!cookie) return app.request(`/a/${encodeURIComponent(ref)}/frame`);
  const minted = await mintFrameToken(app, ref, cookie, author);
  if (minted.status !== 200) return minted;
  const { frameUrl } = (await minted.json()) as MintedFrame;
  return app.request(frameUrl);
}
