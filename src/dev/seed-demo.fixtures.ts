import type { ArtefactKind } from "../domain/artefact/kind";
import type { DataVisibility, Visibility } from "../domain/artefact/visibility";

// The local demo (`pnpm dev:seed`): the one place its people, credentials and
// content are defined. Data only — `seed-demo.lib.ts` walks it through the BFF.
// Dev-only: `src/dev/` is never bundled into `dist/`, and the seed refuses to
// run outside a local checkout (see `seed-guards.ts`).
//
// Not shared with `src/client/design/fixtures.ts` (UI-shaped summaries with fake
// ids for the previews): it keeps only the same cast and flavour of titles.

// BetterAuth's minimum password length is 8. Shared by both people.
export const DEMO_PASSWORD = "artefactor-demo";

export type PersonKey = "demo" | "maya";

export interface DemoPerson {
  name: string;
  email: string;
}

// Both on the default `AUTH_ALLOWED_EMAIL_DOMAINS` (`example.com`), so sign-up
// passes the real sign-up gate.
export const DEMO_PEOPLE: Record<PersonKey, DemoPerson> = {
  demo: { name: "Demo User", email: "demo@example.com" },
  maya: { name: "Maya Chen", email: "maya@example.com" },
};

export interface FixtureCollection {
  key: string;
  owner: PersonKey;
  name: string;
  // Another fixture collection's key: nested under it.
  parent?: string;
  visibility?: Visibility;
}

export interface FixtureArtefact {
  key: string;
  owner: PersonKey;
  title: string;
  kind: ArtefactKind;
  html: string;
  // A fixture collection's key, owned by the same person.
  collection?: string;
  visibility?: Visibility;
  // People put on the artefact's access list (the `selected` tier's members).
  grantTo?: PersonKey[];
  dataVisibility?: DataVisibility;
  // Each person's saved data: the `localStorage` map the shim seeds.
  data?: Partial<Record<PersonKey, Record<string, string>>>;
  bookmarkedBy?: PersonKey[];
  archived?: boolean;
}

export interface DemoFixture {
  people: Record<PersonKey, DemoPerson>;
  collections: FixtureCollection[];
  artefacts: FixtureArtefact[];
}

function page(title: string, body: string, head = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 0; padding: 2rem; color: #1f2328; background: #fafaf9; }
  main { max-width: 44rem; margin: 0 auto; }
  h1 { font-size: 1.75rem; margin: 0 0 1rem; }
  section { background: #fff; border: 1px solid #e5e5e4; border-radius: 12px; padding: 1rem 1.25rem; margin: 0 0 1rem; }
  label { display: block; margin: 0.75rem 0 0.25rem; font-weight: 600; }
  input, select, textarea { width: 100%; box-sizing: border-box; font: inherit; padding: 0.5rem; border: 1px solid #d0d0cf; border-radius: 8px; }
  .muted { color: #6b6b69; font-size: 0.875rem; }
</style>
${head}
</head>
<body>
<main>
<h1>${title}</h1>
${body}
</main>
</body>
</html>
`;
}

function doc(title: string, sections: [string, string][]): string {
  return page(
    title,
    sections.map(([h, p]) => `<section><h2>${h}</h2><p>${p}</p></section>`).join("\n"),
  );
}

function deck(title: string, slides: string[]): string {
  return page(
    title,
    slides.map((s, i) => `<section><p class="muted">Slide ${i + 1} of ${slides.length}</p><h2>${s}</h2></section>`).join("\n"),
  );
}

// The customer survey: saves through `localStorage` under one versioned key,
// following the persistence contract in `skills/artefactor/SKILL.md`.
export const SURVEY_STORAGE_KEY = "customer-survey-v1";

const SURVEY_HTML = page(
  "Customer survey",
  `<section>
<p class="muted">Your answers save as you type.</p>
<label for="name">Name</label><input id="name" name="name">
<label for="role">Role</label><input id="role" name="role">
<label for="rating">How likely are you to recommend us? (0–10)</label>
<input id="rating" name="rating" type="number" min="0" max="10">
<label for="comments">Anything else?</label><textarea id="comments" name="comments" rows="4"></textarea>
<p id="status" class="muted"></p>
</section>
<script>
  const KEY = "${SURVEY_STORAGE_KEY}";
  const fields = ["name", "role", "rating", "comments"];
  let state = {};
  try { state = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { state = {}; }
  for (const f of fields) {
    const el = document.getElementById(f);
    el.value = state[f] ?? "";
    el.addEventListener("input", () => { state[f] = el.value; save(); });
  }
  let timer;
  function save() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify(state));
        document.getElementById("status").textContent = "Saved.";
      } catch {
        document.getElementById("status").textContent = "Not saved (read-only or offline).";
      }
    }, 400);
  }
</script>`,
  `<script type="application/artefactor-schema+json">
{ "key": "${SURVEY_STORAGE_KEY}",
  "version": 1,
  "description": "One survey response per person.",
  "example": { "name": "Sam Doe", "role": "Designer", "rating": "8", "comments": "Loved the onboarding." } }
</script>`,
);

function surveyAnswers(answers: Record<string, string>): Record<string, string> {
  return { [SURVEY_STORAGE_KEY]: JSON.stringify(answers) };
}

export const DEMO_FIXTURE: DemoFixture = {
  people: DEMO_PEOPLE,
  collections: [
    { key: "specs", owner: "demo", name: "Specs" },
    { key: "drafts", owner: "demo", name: "Drafts", parent: "specs" },
    { key: "roadmap-planning", owner: "demo", name: "Roadmap planning" },
    // Shared to every signed-in user: Demo sees it read-only (S28), never as a
    // contributor, which a `selected` grant on the root would make them.
    { key: "design-roadmaps", owner: "maya", name: "Design roadmaps", visibility: "authenticated" },
  ],
  artefacts: [
    {
      key: "roadmap-q3",
      owner: "demo",
      title: "Roadmap Q3",
      kind: "interactive-doc",
      collection: "specs",
      bookmarkedBy: ["demo"],
      html: doc("Roadmap Q3", [
        ["Themes", "Search everywhere, faster sharing, and a calmer sidebar."],
        ["Milestones", "July: global search. August: share invitations. September: beta hardening."],
      ]),
    },
    {
      key: "onboarding-prototype",
      owner: "demo",
      title: "Onboarding flow prototype",
      kind: "prototype",
      collection: "drafts",
      html: page(
        "Onboarding flow prototype",
        `<section><h2>Step 1 of 3 — Welcome</h2><p>Tell us about your team.</p>
<button type="button">Continue</button></section>`,
      ),
    },
    {
      key: "style-guide",
      owner: "demo",
      title: "Style guide",
      kind: "interactive-doc",
      html: doc("Style guide", [
        ["Voice", "Plain, short sentences. Say what happens, then why."],
        ["Colour", "One accent, used sparingly, never for decoration."],
      ]),
    },
    {
      key: "launch-deck",
      owner: "demo",
      title: "Launch deck",
      kind: "slide-deck",
      html: deck("Launch deck", ["Why now", "What we built", "Who it is for", "What's next"]),
    },
    {
      key: "customer-survey",
      owner: "demo",
      title: "Customer survey",
      kind: "form",
      visibility: "authenticated",
      dataVisibility: "shared",
      html: SURVEY_HTML,
      data: {
        demo: surveyAnswers({ name: "Demo User", role: "Product lead", rating: "9", comments: "Testing my own survey." }),
        maya: surveyAnswers({ name: "Maya Chen", role: "Designer", rating: "7", comments: "The rating field needs labels." }),
      },
    },
    {
      key: "pricing-page",
      owner: "demo",
      title: "Pricing page",
      kind: "prototype",
      visibility: "public",
      html: page(
        "Pricing page",
        `<section><h2>Team — €12 / seat / month</h2><p>Unlimited artefacts, sharing and saved data.</p></section>
<section><h2>Free</h2><p>For one person trying things out.</p></section>`,
      ),
    },
    {
      key: "old-pitch",
      owner: "demo",
      title: "Old pitch",
      kind: "slide-deck",
      archived: true,
      html: deck("Old pitch", ["The problem", "Our first idea"]),
    },
    {
      key: "roadmap-review-deck",
      owner: "maya",
      title: "Roadmap review deck",
      kind: "slide-deck",
      visibility: "authenticated",
      bookmarkedBy: ["demo"],
      html: deck("Roadmap review deck", ["Where we are", "What slipped", "What we commit to"]),
    },
    {
      // The access list is consulted only at the `selected` tier, so a grant on
      // a private artefact would share nothing.
      key: "team-handbook",
      owner: "maya",
      title: "Team handbook",
      kind: "interactive-doc",
      visibility: "selected",
      grantTo: ["demo"],
      html: doc("Team handbook", [
        ["How we work", "Small changes, reviewed the same day."],
        ["Time off", "Tell the team a week ahead; nobody needs to approve it."],
      ]),
    },
    {
      key: "mobile-nav-prototype",
      owner: "maya",
      title: "Mobile nav prototype",
      kind: "prototype",
      collection: "design-roadmaps",
      html: page(
        "Mobile nav prototype",
        `<section><h2>Tab bar</h2><p>Home · Search · Shared · Profile</p></section>`,
      ),
    },
  ],
};
