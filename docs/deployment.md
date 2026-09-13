# Deployment — production on UpCloud via Coolify

The production setup, end to end. Following this document from top to bottom takes Artefactor
from "code on `main`" to "running at **https://<domain>** with durable storage,
HTTPS, and automatic deploys on every push to `main`."

```text
push to main  (humlytech/artefactor)
  └─ GitHub Actions  (.github/workflows/deploy.yml)
       ├─ gate: pnpm test + pnpm check        (.github/workflows/ci.yml)
       ├─ docker build → push ghcr.io/humlytech/artefactor  (:latest + :<sha>)
       └─ curl Coolify deploy webhook
            └─ Coolify (your instance) → existing UpCloud VPS (se-sto1)
                 ├─ container: BFF :3000 serving API + SPA, NODE_ENV=production
                 ├─ named volume artefactor-data → /data
                 │     ├─ /data/artefactor.db   (SQLite, DATABASE_PATH)
                 │     └─ /data/payloads/        (artefact HTML, up to 100 MB each)
                 └─ Coolify proxy: https://<domain>  (Let's Encrypt)
UpCloud Backups: scheduled snapshots of the whole VPS (including the volume)
```

Design decisions baked into this setup:

- **The VPS never builds.** GitHub Actions builds the image and pushes it to GHCR; Coolify
  only pulls and restarts. A broken build never reaches prod, and the box stays small.
- **Artefactor reuses an existing Coolify-managed VPS.** It is added as another application on
  a server Coolify already runs — no new server provisioning. It shares the box's Docker
  Engine and Traefik proxy; isolation is at the container + volume + domain level.
- **SQLite *and* artefact payloads on one named volume.** Both the DB (`/data/artefactor.db`)
  and the HTML payloads (`/data/payloads/`) live on a Docker volume — never inside the image —
  so they survive every redeploy and restart. SQLite WAL mode means the volume also carries
  `-wal`/`-shm` siblings; they belong together. Payloads are capped at **100 MB each**, so the
  underlying disk must have real headroom (this is the main capacity concern, not the DB).
- **No app-level backup strategy.** UpCloud's scheduled backups snapshot the entire VPS
  (volume included). Good enough by decision; revisit if the data ever outgrows "restore
  yesterday's snapshot is fine."
- **`NODE_ENV=production` enforces a real secret.** The image sets it; the BFF's env schema
  (`src/server/env.ts`) then refuses to start unless `BETTER_AUTH_SECRET` is set to something
  other than the dev placeholder. The insecure dev default cannot reach prod by accident.

Placeholders used below: `<domain>` (the public hostname you serve at, e.g.
`artefactor.example.com`), `<coolify-url>` (your Coolify instance), `<vps-ip>` (the existing
VPS's public IP), `<app-uuid>` (assigned when the Coolify app is created).

---

## 1. Fork the repo to `humlytech`

Production deploys from **`humlytech/artefactor`**, not the upstream `hiddenvalues/artefactor`.

1. GitHub → `hiddenvalues/artefactor` → **Fork** → owner **humlytech**, name `artefactor`.
   (The fork copies `main`, including `.github/workflows/` and this runbook.)
2. **Enable Actions on the fork:** the fork's **Actions** tab → *I understand my workflows,
   go ahead and enable them*. Forks ship with workflows disabled until you opt in.
3. Decide how `main` advances on the fork. Simplest: develop on `hiddenvalues`, and when ready
   to ship, push/merge into `humlytech`'s `main` (e.g. add it as a second remote:
   `git remote add humly git@github.com:humlytech/artefactor.git` and `git push humly main`).
   Every push to the fork's `main` triggers a deploy.

> The image name is derived from `${{ github.repository }}`, so on the fork it automatically
> becomes `ghcr.io/humlytech/artefactor` — no workflow edit needed.

## 2. The Coolify server (already exists — reuse)

Artefactor runs on a VPS Coolify already manages (the same instance that runs your other
apps). Nothing to provision. Just note, in Coolify → **Servers**, which server you'll target
and its public IP → that's `<vps-ip>` for the DNS record in step 3. Leave its proxy on the
default (Traefik) — it handles HTTPS in step 5.

If the box is tight on disk, remember artefact payloads can be large (100 MB cap each). Check
free space before pointing real traffic at it, and make sure Coolify's scheduled **Docker
Cleanup** (Server → settings) is enabled so old images are pruned.

## 3. DNS

Add an **A record**: `<domain> → <vps-ip>` (the existing VPS's IP). Do this
before creating the app so Let's Encrypt validation succeeds on the first deploy.

## 4. Let the VPS pull from GHCR

How much work this is depends on the **fork's visibility**:

- **Public fork → public package (simplest).** `hiddenvalues/artefactor` is public today; if
  the `humlytech` fork is also public, the GHCR package is public and the VPS pulls with no
  credentials. **Skip the rest of this step.**
- **Private fork → private package.** The VPS must authenticate to pull. Reuse the
  **Humly-Bot** machine account (the same one your other private-image apps already use):
  1. Give Humly-Bot **Read** on `humlytech/artefactor` (a package pushed by the workflow's
     `GITHUB_TOKEN` inherits the repo's access, so repo read = package pull). Skip if Humly-Bot
     already has read via an org team.
  2. The existing VPS very likely **already has** `docker login ghcr.io -u Humly-Bot` persisted
     in `/root/.docker/config.json` from the other apps — in which case step 1 is all that's
     needed. If not, create a classic PAT as Humly-Bot with **only `read:packages`** and:

     ```bash
     ssh root@<vps-ip>
     docker login ghcr.io -u Humly-Bot   # paste the PAT as the password
     ```

  3. **Verify** (only meaningful after the first workflow run has pushed an image):

     ```bash
     docker pull ghcr.io/humlytech/artefactor:latest
     # denied / pull access denied = auth/access problem (PAT scope, bot lacks repo read,
     #                                or org restricts classic PATs)
     # manifest unknown            = auth is fine, image just not pushed yet
     ```

> Recommendation: keep the fork (and thus the package) **public** unless there's a reason not
> to — the source is already public on the upstream repo, and it removes this whole step.

## 5. Create the Coolify project + application

1. Coolify → **Projects → + Add** → name `humly-artefactor` → open its **production**
   environment. (Or add the app to an existing project — your call.)
2. **+ New Resource → Docker Image**:
   - **Image:** `ghcr.io/humlytech/artefactor:latest`
   - **Server:** the existing VPS from step 2.
3. Application settings:
   - **Domains:** `https://<domain>` (the `https://` prefix makes the proxy issue a
     Let's Encrypt cert).
   - **Ports Exposes** (the Coolify field's literal name): `3000`. This must be right for two
     reasons: the proxy routes the domain to this port, **and Coolify injects a `PORT` env var
     derived from it** — left at the default `80`, the BFF obediently binds `:80` and the
     health check on 3000 gets `Connection refused`. The giveaway in the deploy log is the
     startup line `Artefactor listening on http://localhost:80`.
   - **Health check:** enable; path `/health`, port `3000`, expect `200`. (Unauthenticated by
     design — returns `{"status":"ok","uptime":…,"build":"<sha>"}`.) Coolify runs this probe
     **inside the container** with `curl`; the runtime image (Debian `bookworm-slim`, which
     ships no curl/wget) installs `curl` precisely for this — see the [Dockerfile](../Dockerfile).
4. **Persistent Storage → + Add Volume Mount:** name `artefactor-data`, destination `/data`.
   The image declares `/data` as a volume; the named volume holds the SQLite DB **and** the
   artefact payloads, and survives redeploys. The container runs as the unprivileged `node`
   user — its entrypoint starts as root only to `chown` `/data` to `node`, then drops
   privileges (`gosu`), so a fresh *or* previously root-owned volume becomes writable
   automatically (see [docker-entrypoint.sh](../docker-entrypoint.sh)).
5. **Environment variables** (Coolify → app → Environment Variables; mark secrets as such):

   | Variable | Value | Notes |
   |---|---|---|
   | `BETTER_AUTH_SECRET` | `openssl rand -hex 32` | **Secret. Required in prod** — the BFF refuses to boot with the dev placeholder. Rotating it signs everyone out. |
   | `BETTER_AUTH_URL` | `https://<domain>` | Public base URL BetterAuth issues session cookies/callbacks against. |
   | `GOOGLE_CLIENT_ID` | from the Google OAuth client | **Required in prod** (Google-only auth). See §5a. |
   | `GOOGLE_CLIENT_SECRET` | from the Google OAuth client | **Secret. Required in prod.** See §5a. |
   | `AUTH_ALLOWED_EMAIL_DOMAINS` | your org domain(s), e.g. `example.com,example.org` | **Set this in prod.** Comma-separated; account creation is restricted to these domains (every provider). The code default is `example.com` (dev only). |
   | `AUTH_TRUSTED_ORIGINS` | `https://<domain>` | Optional. The `BETTER_AUTH_URL` origin is trusted implicitly and the SPA is same-origin, so this is usually unnecessary — set it only if a separate origin must call the auth API. |

   Already baked into the image (no need to set): `NODE_ENV=production`, `PORT=3000`,
   `DATABASE_PATH=/data/artefactor.db`, `ARTEFACTOR_PAYLOAD_DIR=/data/payloads`,
   `CLIENT_DIR=/app/dist/client`, `MIGRATIONS_DIR=/app/migrations`. `DATABASE_PATH` and
   `ARTEFACTOR_PAYLOAD_DIR` already point into the `/data` volume — that's what survives
   redeploys; override them only if you change the mount.

Don't deploy yet — the image doesn't exist until the first workflow run (step 7).

> **Production is Google-only.** The image sets `NODE_ENV=production`, which disables
> email+password sign-in, so `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` are **mandatory** —
> the BFF's env schema refuses to boot without them. Set them (next section) **before** the
> first deploy; otherwise the new container exits on boot and Coolify rolls back. Sign-up is
> restricted to the domains in `AUTH_ALLOWED_EMAIL_DOMAINS` (set in prod) for every provider.

## 5a. Google OAuth client (Google Cloud Console)

Create one OAuth client and reuse it for prod (and optionally local dev):

1. **Google Cloud Console** → pick/create a project (ideally in your Workspace org).
2. **APIs & Services → OAuth consent screen.** Fill app name + support email; no scopes beyond
   the default email/profile/openid. Pick the **User type** by your Workspace layout:
   - **All allowed domains are in one Google Workspace** (multi-domain) → **Internal**
     (Workspace-only; the tightest setting).
   - **They span separate Workspaces** → **Internal** would exclude whichever domain isn't the
     project's Workspace. Use **External** instead — the server-side `AUTH_ALLOWED_EMAIL_DOMAINS`
     allowlist is the real boundary, so External is safe here (only basic email/profile/openid
     scopes, so no Google verification review is required).
3. **APIs & Services → Credentials → + Create credentials → OAuth client ID:**
   - **Application type:** Web application.
   - **Authorized redirect URIs:**
     - `https://<domain>/api/auth/callback/google` (production)
     - `http://localhost:3000/api/auth/callback/google` (optional, for local dev)

     The path is always `<BETTER_AUTH_URL>/api/auth/callback/google`.
4. Create → copy the **Client ID** and **Client secret** into the `GOOGLE_CLIENT_ID` /
   `GOOGLE_CLIENT_SECRET` env vars in §5.

> Internal consent restricts the OAuth app to the Workspace; the `AUTH_ALLOWED_EMAIL_DOMAINS`
> allowlist is the independent, code-level boundary (and the one that distinguishes domains if
> they're in separate Workspaces). Google's single-domain `hd` option isn't used because more
> than one domain may be allowed.

## 6. GitHub Actions → automatic deploys

The workflow [.github/workflows/deploy.yml](../.github/workflows/deploy.yml): on every push to
`main` it gates (`pnpm test` + `pnpm check`), builds the Docker image (stamping the commit via
the `GIT_SHA` build-arg), pushes `:latest` + `:<sha>` to GHCR, then triggers Coolify. It needs
two repository secrets **on the `humlytech` fork** (Settings → Secrets and variables →
Actions):

| Secret | Where to get it |
|---|---|
| `COOLIFY_WEBHOOK` | Coolify → the application → **Webhooks** → Deploy Webhook URL (looks like `<coolify-url>/api/v1/deploy?uuid=…&force=false`). |
| `COOLIFY_TOKEN` | Coolify → **Keys & Tokens → API tokens** → create one with deploy permission. |

GHCR pushes use the workflow's built-in `GITHUB_TOKEN`; no extra secret needed.

Mind the URL: it must be the **`/api/v1/deploy?uuid=…`** one (Bearer-token API), **not** the
`/webhooks/source/github/…` URL also shown nearby — that one is for Coolify's GitHub-source
integration (HMAC-signed payloads) and answers our Bearer request with `401 Unauthenticated`.
A 401 with the right URL usually means the token lacks deploy permission, has stray
newline/whitespace pasted into the secret, or the instance's API is disabled or IP-allowlisted
(Coolify → Settings → API — GitHub runners need it open). Triage from a terminal first:

```bash
curl --fail-with-body -H "Authorization: Bearer <token>" "<coolify-url>/api/v1/deploy?uuid=<app-uuid>&force=false"
# success: {"deployments":[{"message":"Deployment request queued." …}]}
```

`workflow_dispatch` is enabled, so **Actions → deploy → Run workflow** redeploys current `main`
manually at any time.

The gate lives in [.github/workflows/ci.yml](../.github/workflows/ci.yml) and **also runs on
every pull request** — one definition in both places, so the PR check and the deploy gate can't
drift apart. (A deploy can still fail after a green PR if `main` moved since the PR was tested —
the merged tree is what the deploy gate runs against.) To make the check actually block merging
(not just report), require it once in branch protection: fork **Settings → Branches** (or
Rulesets) → add a rule for `main` → **Require status checks to pass** → select **gate** (GitHub
may display it as `ci / gate`).

## 7. First deploy + verification

1. Push to the fork's `main` (or **Actions → deploy → Run workflow**). Watch **Actions**:
   gate → build-push → deploy must all go green.
2. Watch Coolify → the application → **Deployments**: it pulls the image and starts the
   container; the health check flips it to *healthy* (`Running (healthy)`).
3. Verify, in order:
   - `curl https://<domain>/health` → `{"status":"ok","uptime":…,"build":"<sha>"}`
     where `<sha>` is the commit the workflow just shipped (also proves DNS + TLS).
   - Open the site → **Continue with Google** with an account in an allowed domain → you land
     signed in (proves the Google client, `BETTER_AUTH_URL`, the callback URL, and Secure
     cookies over HTTPS). A Google account outside the allowlist should be bounced back with
     the "sign-in failed" message (proves the domain allowlist).
   - Upload an artefact, open it (`/a/:slug`), interact so it writes data → **restart the app
     in Coolify** → sign back in → the artefact and its data are still there (proves both the
     SQLite DB and the payloads are on the `/data` volume, not in the container).
4. Push a trivial commit to the fork's `main` → confirm it auto-deploys end to end and
   `/health`'s `build` flips to the new SHA.

## Operations

- **Logs:** Coolify → application → **Logs** (live container logs).
- **Restart / stop:** Coolify → application → Restart. The DB + payloads are on the volume;
  restarts are always safe.
- **Redeploy current main:** GitHub → Actions → deploy → Run workflow (or Coolify's Redeploy
  button, which re-pulls `:latest`).
- **Roll back:** every deploy also pushes an immutable `:<sha>` tag. In Coolify, change the
  image tag from `latest` to the last good `<sha>` and redeploy. Roll forward by setting it
  back to `latest`. Confirm what's actually live with `curl …/health` — `build` is the running
  image's commit SHA. (Migrations run forward automatically at startup via
  `docker-entrypoint.sh`; rolling back *across* a migration needs a matching DB restore.)
- **Database + payloads:** one SQLite file (plus WAL siblings) and the `payloads/` tree in the
  `artefactor-data` volume. To inspect or copy:

  ```bash
  ssh root@<vps-ip>
  docker run --rm -v artefactor-data:/data alpine ls -la /data /data/payloads   # see the files
  docker cp <container>:/data/artefactor.db ./artefactor-$(date +%F).db          # ad-hoc DB snapshot
  ```

- **Backups / restore:** UpCloud's scheduled backups snapshot the whole VPS daily. Restore =
  UpCloud hub → server → Backups → restore (reverts the server wholesale, app + DB + payloads
  together). For an ad-hoc point-in-time copy before something risky, use the `docker cp` line
  above (and `docker cp` the `payloads/` dir too if it matters).
- **Disk hygiene:** old images and large payloads accumulate. Keep Coolify's scheduled **Docker
  Cleanup** (Server → settings) enabled, and watch free space — payloads can be 100 MB each.

## Configuration reference

The full env schema (with dev defaults) is the source of truth in
[`src/server/env.ts`](../src/server/env.ts); the production values are the table in step 5.
The [Dockerfile](../Dockerfile) at the repo root is the single build definition — CI and any
local `docker build` produce the same image. Locked product/deploy decisions live in
[CLAUDE.md](../CLAUDE.md) and the specs under [`docs/specs/`](./specs/).
