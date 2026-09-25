# Deployment — production on UpCloud via Coolify

The production setup, end to end. Following this document from top to bottom takes Artefactor
from "code on `main`" to "running at **`https://<domain>`** with durable storage,
HTTPS, and automatic deploys on every push to `main`."

```text
push to main  (humlytech/artefactor)
  └─ GitHub Actions  (.github/workflows/deploy.yml)
       ├─ gate: pnpm test + check + lint:md   (.github/workflows/ci.yml)
       ├─ docker build → push ghcr.io/humlytech/artefactor  (:latest + :<sha>)
       └─ curl Coolify deploy webhook
            └─ Coolify (your instance) → existing UpCloud VPS (se-sto1)
                 ├─ container: BFF :3000 serving API + SPA, NODE_ENV=production
                 ├─ named volume artefactor-data → /data
                 │     ├─ /data/artefactor.db   (SQLite, DATABASE_PATH)
                 │     ├─ /data/payloads/        (artefact HTML, up to 100 MB each)
                 │     └─ /data/thumbnails/      (rendered card images)
                 └─ Coolify proxy: https://<domain>  (Let's Encrypt)
                       │  private network, http://<renderer-private-ip>:3001
                       ▼  (optional — §9)
            renderer VM, behind a firewall outside it (app → :3001, Coolify → :22, nothing else)
                 └─ container: thumbnail renderer (same image, ARTEFACTOR_ROLE=renderer,
                       no secrets, no volume, sandboxed Chromium, one job per container)
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
VPS's public IP), `<app-uuid>` (assigned when the Coolify app is created), and
`<renderer-private-ip>` / `<renderer-public-ip>` (the renderer VM of §9).

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

Serving artefact frames from their own domain (§5b) means a second A record, on a **separate
registrable domain**, pointing at the same IP.

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
   - **Port mappings:** leave empty, and never publish `3000` on a public interface: only the
     proxy should reach the app. The app takes its client address (the key of the
     link-password rate limit and of BetterAuth's sign-in limit) from the socket peer, and reads
     `X-Forwarded-For` only when that peer is a **trusted proxy** (IA8, S42). By default that is
     loopback plus the private and link-local ranges, which is where Coolify's Traefik connects
     from over the Docker network, so the default needs no setting, and a client reaching a
     published `3000` from a public address is keyed on its own address, whatever header it
     sends. Set `ARTEFACTOR_TRUSTED_PROXIES` (§5) only when the proxy reaches the app from a
     public or otherwise non-private address, or a CDN sits in front of it.
   - **Health check:** enable; path `/health`, port `3000`, expect `200`. (Unauthenticated by
     design — returns `{"status":"ok","uptime":…,"build":"<sha>"}`.) Coolify runs this probe
     **inside the container** with `curl`; the runtime image (Debian `bookworm-slim`, which
     ships no curl/wget) installs `curl` precisely for this — see the [Dockerfile](../Dockerfile).
4. **Persistent Storage → + Add Volume Mount:** name `artefactor-data`, destination `/data`.
   This mount is **required**: the image deliberately declares no `VOLUME` (S37 — an implicit
   anonymous volume would follow the renderer container around too), so without it the SQLite DB
   and the payloads would live in the container's writable layer and die with it. The named
   volume holds the SQLite DB, the artefact payloads **and** their thumbnails, and survives
   redeploys. The container runs as the unprivileged `node`
   user — its entrypoint starts as root only to `chown` `/data` to `node`, then drops
   privileges (`gosu`), so a fresh *or* previously root-owned volume becomes writable
   automatically (see [docker-entrypoint.sh](../docker-entrypoint.sh)).
5. **Environment variables** (Coolify → app → Environment Variables; mark secrets as such):

   | Variable | Value | Notes |
   | --- | --- | --- |
   | `BETTER_AUTH_SECRET` | `openssl rand -hex 32` | **Secret. Required in prod** — the BFF refuses to boot with the dev placeholder. Rotating it signs everyone out. |
   | `BETTER_AUTH_URL` | `https://<domain>` | Public base URL BetterAuth issues session cookies/callbacks against. |
   | `GOOGLE_CLIENT_ID` | from the Google OAuth client | **Required in prod unless `AUTH_EMAIL_PASSWORD=true`** — production needs at least one sign-in method. See §5a. |
   | `GOOGLE_CLIENT_SECRET` | from the Google OAuth client | **Secret. Required in prod unless `AUTH_EMAIL_PASSWORD=true`.** See §5a. |
   | `AUTH_EMAIL_PASSWORD` | `true` / `false` (or `1` / `0`) | Optional. Enables email + password sign-in. Unset: on outside production, off in it. Set it to `true` to run production without a Google dependency — but read the callout below first: it is an **unverified** path. |
   | `AUTH_ALLOW_SIGNUP` | `true` / `false` (or `1` / `0`) | Optional. Gates account **creation**, for every provider. Unset: **closed** when production has email+password enabled, **open** otherwise. Empty counts as unset. |
   | `AUTH_ALLOWED_EMAIL_DOMAINS` | your org domain(s), e.g. `example.com,example.org` | **Set this in prod.** Comma-separated; account creation is restricted to these domains (every provider). The code default is `example.com` (dev only). |
   | `AUTH_TRUSTED_ORIGINS` | `https://<domain>` | Optional. The `BETTER_AUTH_URL` origin is trusted implicitly and the SPA is same-origin, so this is usually unnecessary — set it only if a separate origin must call the auth API. |
   | `ARTEFACTOR_RENDERER_URL` | `http://<renderer-private-ip>:3001` | Optional, and **only** once the isolated renderer VM of §9 is running and verified. Unset: no card thumbnails, everything else unchanged. Never point it at a renderer that is not isolated. |
   | `ARTEFACTOR_CONTENT_ORIGIN` | `https://<content-domain>` | Optional, defence in depth. `scheme://host[:port]`, no path: the origin artefact frames are served on, on a **separate registrable domain** from `<domain>`. See §5b. |
   | `ARTEFACTOR_TRUSTED_PROXIES` | *(unset)* | Optional. Comma-separated CIDRs or addresses of the proxies allowed to name the client in `X-Forwarded-For` (IA8). Unset: loopback plus the private and link-local ranges. A value **replaces** that default, so list every hop to trust (e.g. your proxy's address plus a CDN's ranges); an invalid entry fails the boot. |

   Already baked into the image (no need to set): `NODE_ENV=production`, `PORT=3000`,
   `DATABASE_PATH=/data/artefactor.db`, `ARTEFACTOR_PAYLOAD_DIR=/data/payloads`,
   `ARTEFACTOR_THUMBNAIL_DIR=/data/thumbnails`, `CLIENT_DIR=/app/dist/client`,
   `MIGRATIONS_DIR=/app/migrations`. `DATABASE_PATH`, `ARTEFACTOR_PAYLOAD_DIR` and
   `ARTEFACTOR_THUMBNAIL_DIR` already point into the `/data` volume — that's what survives
   redeploys; override them only if you change the mount. Thumbnails live **beside** the
   payloads, never inside `ARTEFACTOR_PAYLOAD_DIR`, so keep the two directories distinct if you
   do move them.

   `ARTEFACTOR_RENDERER_URL` alone decides whether cards carry a rendered preview: set and
   reachable, thumbnails are rendered; unset, the app renders nothing at all and every card shows
   its kind placeholder, with nothing else changed.

Don't deploy yet — the image doesn't exist until the first workflow run (step 7).

> **Production needs at least one sign-in method.** The image sets `NODE_ENV=production`, where
> email+password is off by default — so out of the box `GOOGLE_CLIENT_ID` +
> `GOOGLE_CLIENT_SECRET` are what makes the deployment usable, and the BFF's env schema refuses
> to boot with **neither** them nor `AUTH_EMAIL_PASSWORD=true`. Set one of the two (next
> section) **before** the first deploy; otherwise the new container exits on boot and Coolify
> rolls back. Sign-up stays restricted to the domains in `AUTH_ALLOWED_EMAIL_DOMAINS` for every
> provider.
>
> **If you choose `AUTH_EMAIL_PASSWORD=true`,** know what it opens: Artefactor has no mail
> transport, so nothing verifies that whoever types an address owns it. While account creation is
> open, the first person to reach the sign-up form claims any allowlisted address. Hence the gate,
> and its lifecycle on a fixed-team deployment:
>
> 1. Deploy with `AUTH_ALLOW_SIGNUP=true`.
> 2. Have each intended person create their account.
> 3. Set `AUTH_ALLOW_SIGNUP=false` and redeploy. Existing accounts keep signing in, and existing
>    MCP connector tokens keep working; only *creation* stops.
>
> With `AUTH_ALLOW_SIGNUP` unset, a production deployment that enables email+password starts
> **closed** (create the first account with the flag briefly on), and a Google-only one starts
> **open** — Google has already verified the address it asserts, so the allowlist is the gate
> there, exactly as before.

## 5a. Google OAuth client (Google Cloud Console)

Skip this section if the deployment runs on `AUTH_EMAIL_PASSWORD=true` alone. Otherwise create
one OAuth client and reuse it for prod (and optionally local dev):

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

## 5b. A separate content origin for artefact frames (optional)

Artefacts are **trusted HTML served as-is**: the uploader's JavaScript runs in the viewer's
browser. It runs inside a sandboxed, opaque-origin `<iframe>` (no `allow-same-origin`, the same
flags repeated as a `Content-Security-Policy: sandbox` header on every frame response), so it
reaches no cookie and no storage of the app's. `ARTEFACTOR_CONTENT_ORIGIN` adds the second layer:
served from a **different registrable domain**, the frame is cross-site to the app whatever a
browser bug or a future flag does to the sandbox.

1. Register (or reuse) a domain that is **not** `<domain>`, not a subdomain of it and not a
   parent of it — e.g. serve the app at `artefactor.example.com` and frames at
   `artefactor-content.com`.
2. Add an **A record** for it → `<vps-ip>`, as in step 3.
3. Coolify → the application → **Domains**: add `https://<content-domain>` next to
   `https://<domain>`, so the proxy routes it to the same container and issues its certificate.
4. Set `ARTEFACTOR_CONTENT_ORIGIN=https://<content-domain>` (§5) and redeploy.

Startup validates it and **refuses to boot** if it is the app's own host, a subdomain of it or a
parent domain of it. The check compares *hosts*, not registrable domains (there is no
public-suffix list in the app), so `content.example.com` beside `app.example.com` is accepted
though it is the same site — keeping them genuinely separate is yours to get right.

Once set, that host answers **only** the two frame routes and `/health`; the app host answers no
frame route. Verify after the deploy: `curl -sI https://<content-domain>/api/me` → 404, and an
artefact at `https://<domain>/a/<slug>` still renders (its frame now loads from the content
host). Leave the variable unset and frames stay on the app host, isolated by the sandbox alone.

## 6. GitHub Actions → automatic deploys

The workflow [.github/workflows/deploy.yml](../.github/workflows/deploy.yml): on every push to
`main` it gates (`pnpm test` + `pnpm check` + `pnpm lint:md`), builds the Docker image (stamping
the commit via the `GIT_SHA` build-arg), pushes `:latest` + `:<sha>` to GHCR, then triggers
Coolify. It needs two repository secrets **on the `humlytech` fork** (Settings → Secrets and
variables → Actions):

| Secret | Where to get it |
| --- | --- |
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

## 9. Card thumbnails: the isolated renderer

Thumbnails are rendered by **screenshotting the artefact's HTML**, which means running a
stranger's JavaScript on a server of yours. That happens in a container from the same image, with
Chromium's sandbox on, no secrets, no volume, one job per container and no route back to the app
— the rationale, the layers and the verification checklist are in
[renderer-isolation.md](renderer-isolation.md) (**read it before this section**). The app is
perfectly happy without it: leave `ARTEFACTOR_RENDERER_URL` unset and every card shows its kind
placeholder.

Under Coolify the renderer runs on **a VM of its own**, beside the app server on a private
network, behind a firewall enforced **outside** the VM. That is the only Coolify shape this
runbook documents. The reasons come first, because the obvious same-host shape looks right and
isn't.

### Why not on the app server

[`deploy/docker-compose.example.yml`](../deploy/docker-compose.example.yml) isolates the renderer
on one host with Docker networks: an `icc=false` link network plus `DOCKER-USER` rules that allow
exactly app → renderer:3001. Under Coolify (verified on 4.3.23, Ubuntu 24.04, Docker 29) that
shape can't be reproduced:

- **Coolify adds its own network.** Its Compose parser force-attaches every service of a Docker
  Compose resource to a per-resource network, beside whatever `networks:` the file declares.
- **The only way to reach the app is the wrong one.** The app is a separate Docker Image
  application, so the two can only meet on a network Coolify shares between resources — which
  puts the renderer on Coolify's shared `coolify` bridge, beside the app **and** the Traefik
  proxy.
- **Nothing filters traffic inside one bridge.** `DOCKER-USER` sees bridged traffic only with
  the `br_netfilter` kernel module loaded, and it was not loaded on a stock Ubuntu 24.04 host. So
  renderer → app is open: layer 4 of [renderer-isolation.md](renderer-isolation.md#the-layers) is
  simply gone.

> **Don't use *Connect to Predefined Network* for the renderer**, and don't put it on any network
> the app or the proxy is on. If you can't give it a VM of its own, leave
> `ARTEFACTOR_RENDERER_URL` unset: thumbnails off is safe, an unisolated renderer is not.

A VM of its own fixes all three, and adds layer 5: even a full escape from the container lands on
a machine holding nothing but the renderer, whose only way into the private network is the one
reply path the firewall outside it admits.

### 9.1 The VM and its firewall

1. Create a small VM (1 vCPU / 1 GB is enough for one job at a time) in the app server's zone,
   running Ubuntu 24.04, attached to the **same private network** as the app server. It is
   stateless, so it needs no backups.
2. On the **private** network, a firewall enforced **outside** the VM — the provider's network
   firewall, not `ufw` on the VM, which a root escape could turn off — with both the incoming and
   the outgoing default **Drop**, and exactly two inbound rules:
   - TCP **3001** from the **app server's** private address;
   - TCP **22** from the **Coolify server's** private address.

   Make it stateful, so the replies need no rules of their own. With outgoing Drop, not even root
   on the VM can open a connection to anything on the private network.
3. The **public** interface needs outbound internet (image pulls, and the CDN assets artefacts
   load) and SSH for you. Admit inbound SSH from your address only, then whatever return traffic
   your provider's firewall needs (a stateless one also needs the ephemeral range, ICMP and the
   DNS replies), then drop. Port 3001 is never published there: the Compose file binds it to the
   private address.
4. If the private network's DHCP hands out a default route, make sure the **public** route wins —
   e.g. a netplan override giving the private interface a higher `route-metric` — or a network
   restart can send the VM's internet traffic into the private network, where outgoing Drop cuts
   it off.

### 9.2 Host prep, on the VM as root

1. **Swap** — Chromium's peaks are short, and the host OOM killer is worse than a slow render:

   ```bash
   fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
   echo '/swapfile none swap sw 0 0' >> /etc/fstab
   echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf && sysctl --system
   ```

2. **The seccomp profile**, at the absolute path the Compose file names — copy
   [`deploy/chromium-seccomp.json`](../deploy/chromium-seccomp.json) over, and check it arrived
   intact:

   ```bash
   mkdir -p /etc/artefactor
   # from a checkout: scp deploy/chromium-seccomp.json root@<renderer-public-ip>:/etc/artefactor/
   sha256sum /etc/artefactor/chromium-seccomp.json   # must match the repo's copy
   ```

3. **The renderer's network**, created by hand so Coolify never creates or changes it: bridge
   `br-art-egress` (the name the egress rules match on), no container-to-container traffic:

   ```bash
   docker network create \
     -o com.docker.network.bridge.name=br-art-egress \
     -o com.docker.network.bridge.enable_icc=false \
     --subnet 172.31.240.0/24 artefactor-renderer
   ```

4. **The egress rules** — [`deploy/renderer-egress.sh`](../deploy/renderer-egress.sh), unchanged:
   public internet and DNS allowed, every private and link-local range dropped (including
   `169.254.169.254`), and nothing new into the host itself. Install it, and re-run it at every
   boot (`DOCKER-USER` survives a Docker restart, not a reboot):

   ```bash
   install -m 0755 renderer-egress.sh /usr/local/sbin/artefactor-renderer-egress.sh
   cat > /etc/systemd/system/artefactor-renderer-egress.service <<'UNIT'
   [Unit]
   Description=Artefactor renderer egress rules (DOCKER-USER, INPUT)
   After=docker.service
   Requires=docker.service

   [Service]
   Type=oneshot
   ExecStart=/usr/local/sbin/artefactor-renderer-egress.sh
   RemainAfterExit=yes

   [Install]
   WantedBy=multi-user.target
   UNIT
   systemctl daemon-reload && systemctl enable --now artefactor-renderer-egress.service
   ```

   The script's `LINK_IF` rules name `br-art-link`, the example's link bridge, which doesn't
   exist on this VM: they match nothing and are harmless. The VM boundary and the firewall
   outside it do that job here.
5. **GHCR** — for a private package, `docker login ghcr.io` with a `read:packages` PAT, as in §4.

### 9.3 The Coolify side

1. Coolify → **Servers → + Add**: the VM, by its **private** address, with an SSH key of its own
   (not the app server's). Validate it, then **stop its proxy** — nothing on this VM is served
   through Traefik.
2. The project → **+ New Resource → Docker Compose**, on that server. Paste
   [`deploy/docker-compose.renderer-vm.yml`](../deploy/docker-compose.renderer-vm.yml) as it is,
   and set its variables: `RENDERER_BIND_IP` to the VM's private address (required), and
   `RENDERER_IMAGE` to your image, e.g. `ghcr.io/humlytech/artefactor:latest`.
   `RENDERER_MEM_LIMIT`, `RENDERER_MEMSWAP_LIMIT` and `RENDERER_TMP_SIZE` default to `1g`, `1g`
   and `512m`; on a 1 GB VM lower them (e.g. `512m`, `768m`, `256m`) and keep the swap of §9.2.

   Change nothing else. A Coolify *application*'s custom Docker options cover `--cap-drop` and
   `--security-opt` but not `--read-only`, `--tmpfs`, `--pids-limit` or `--user`, which is why
   this is a Compose resource; `network_mode` is what keeps Coolify's own network off it; and
   `pull_policy: always` is what makes a deploy pull the new image — Coolify's deploy webhook
   runs `docker compose up -d` on a Compose resource without pulling, so without it the renderer
   keeps its cached `:latest` and never follows the app. `src/deploy/renderer-compose.test.ts`
   holds the file to all of that.
3. Deploy it. If your pipeline should redeploy the renderer on every push along with the app,
   take the resource's **Deploy Webhook** URL too (§6).

### 9.4 Verify, then switch on

1. [renderer-isolation.md § Verify a deployment](renderer-isolation.md#verify-a-deployment), the
   **VM variant**: every check must pass.
2. Only then set `ARTEFACTOR_RENDERER_URL=http://<renderer-private-ip>:3001` on the app and
   redeploy it. Upload an artefact: its card picks up an image within a few seconds.
3. **Rollback:** unset `ARTEFACTOR_RENDERER_URL` and redeploy the app. Thumbnails already rendered
   stay; new cards show their placeholder.

> **Verified on Coolify** (4.3.23, Ubuntu 24.04, Docker 29): `docker inspect` shows every hardening
> key of the Compose file coming through — the user, the read-only root, `cap_drop: ALL`,
> `no-new-privileges` and the seccomp profile, the tmpfs mounts, the pids limit,
> `restart: always`, no mounts and no secrets — and the container exiting and restarting every
> ~10 s under load runs as designed. The network is what didn't hold on one host, hence the VM.

## Operations

- **Logs:** Coolify → application → **Logs** (live container logs). The renderer logs one line
  per container life (`sandboxed Chromium launched — ready`); a restart every ~10 s under load is
  the design (§9), not a crash loop. A repeated `unavailable:` line means the host blocks the
  sandbox — see [renderer-isolation.md](renderer-isolation.md) § Host prerequisites.
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
