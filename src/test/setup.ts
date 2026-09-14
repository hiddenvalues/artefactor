import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point every test run at a throwaway SQLite db + payload dir so the server
// composition root (which opens the DB at import time) never touches the dev
// database. Set before any module reads `env`. Runs once per test file.
const dir = mkdtempSync(join(tmpdir(), "artefactor-test-"));
process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = join(dir, "test.db");
process.env.ARTEFACTOR_PAYLOAD_DIR = join(dir, "payloads");
// S35 — tests seed thumbnails through the store; no test app launches Chromium.
process.env.ARTEFACTOR_THUMBNAIL_DIR = join(dir, "thumbnails");
process.env.ARTEFACTOR_THUMBNAILS = "off";
process.env.BETTER_AUTH_SECRET = "test-secret-at-least-32-characters-long";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
// Tests sign up with @example.com identities; admit them via the allowlist (IA4).
process.env.AUTH_ALLOWED_EMAIL_DOMAINS = "example.com,example.org";
