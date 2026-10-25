import comments from "@eslint-community/eslint-plugin-eslint-comments";
import tsParser from "@typescript-eslint/parser";

// S43 — the client guardrail. Colours live in one tokens file
// (src/client/app.css) and reach components through Tailwind classes or
// `var(--…)`; nothing else in the client holds a raw colour or an inline style.
// The one allowed style is CSS custom properties carrying a per-item colour
// token — `style={{ "--hue": … }}`, or the `kindVars` / `hueVars` helpers in
// src/client/lib/style.ts that build exactly that.
const STYLE = 'JSXAttribute[name.name="style"]';
const VALUE = `${STYLE} > JSXExpressionContainer`;
const OBJECT = `${VALUE} ObjectExpression`;
const COLOUR = String.raw`/#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?|oklch|oklab|lab|lch)\(/`;

const noInlineStyle = "Inline styles are not allowed — use Tailwind classes; a style may only set CSS custom properties.";
const noRawColour = "Raw colour literals belong in the tokens file (src/client/app.css) — use a token instead.";

// r[impl platform.client.inline-style-lint]
const S43 = [
  { selector: `${STYLE} > Literal`, message: noInlineStyle },
  { selector: `${VALUE} > :not(ObjectExpression, TSAsExpression, CallExpression)`, message: noInlineStyle },
  { selector: `${VALUE} > TSAsExpression[expression.type!="ObjectExpression"]`, message: noInlineStyle },
  { selector: `${VALUE} > CallExpression[callee.name!=/^(kindVars|hueVars)$/]`, message: noInlineStyle },
  { selector: `${OBJECT} > Property[key.type!="Literal"]`, message: noInlineStyle },
  { selector: `${OBJECT} > Property[key.type="Literal"][key.value!=/^--/]`, message: noInlineStyle },
  { selector: `${OBJECT} > SpreadElement`, message: noInlineStyle },
  { selector: `Literal[value=${COLOUR}]`, message: noRawColour },
  { selector: `TemplateElement[value.raw=${COLOUR}]`, message: noRawColour },
];

// S49a — Design-system lint: token colours and wrapped Radix only. A Tailwind
// palette utility (`text-red-600`, `hover:bg-black/50`) paints a colour that
// isn't in the tokens file, and a direct Radix import skips the shadcn/ui
// wrapper. A class starts after anything but a word character or `-` (so
// variants like `hover:` and `!` pass through), and ends before one — an
// opacity (`/50`) may follow. Stock shadcn under lib/components/ui/ uses both,
// so these rules sit in a second object that ignores it; that object repeats
// S43's selectors, because a later `no-restricted-syntax` replaces the earlier.
// The lists follow the installed Tailwind (4.3: mauve/olive/mist/taupe,
// inset-ring, text-shadow, drop-shadow).
const PREFIX =
  "bg|text|text-shadow|border(-[trblxyse])?|ring(-offset)?|inset-ring|outline|divide|inset-shadow|shadow|drop-shadow|fill|stroke|from|via|to|decoration|accent|caret|placeholder";
const HUE =
  "red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|mauve|olive|mist|taupe|black|white";
// r[impl platform.lint.palette-utilities]
const PALETTE = String.raw`/(?<![\w-])(${PREFIX})-(${HUE})(-(50|[1-9]00|950))?(?![\w-])/`;
// `no-restricted-imports` sees static imports only; a dynamic `import()` is
// caught by syntax. (esquery regexes can't hold a bare `/`, hence `[\x2f]`.)
// r[impl platform.lint.radix-imports]
const RADIX_MODULE = String.raw`/^(radix-ui|@radix-ui[\x2f].*)$/`;

const noPalette = "Tailwind palette colours bypass the tokens — use a token utility (bg-primary, text-muted-foreground, border-border…) from src/client/app.css.";
const noRadix = "Import the shadcn/ui wrapper from $lib/components/ui/ instead of Radix directly.";

// S49b — Design-system lint: library controls only. A raw form or dialog
// element re-implements focus ring, hover and cursor that the shadcn/ui
// wrappers already carry; only stock shadcn under lib/components/ui/ renders
// one. Links and content elements (<a>, <table>, <img>) stay raw.
// r[impl platform.lint.library-controls]
const CONTROL = "/^(button|input|select|textarea|label|dialog)$/";
const noControl =
  "Hand-rolled control — compose the shadcn/ui wrapper (Button, Input, Select, Textarea, Label, Dialog) from $lib/components/ui/, or a product component from $lib/components/.";

const CLIENT = ["src/client/**/*.{ts,tsx}"];
const TESTS = "src/client/**/*.test.{ts,tsx}";

export default [
  {
    files: CLIENT,
    ignores: [TESTS],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    // An exception says why, and one that silences nothing fails.
    // r[impl platform.lint.disable-needs-reason]
    linterOptions: { reportUnusedDisableDirectives: "error" },
    plugins: { "@eslint-community/eslint-comments": comments },
    rules: {
      "no-restricted-syntax": ["error", ...S43],
      "@eslint-community/eslint-comments/require-description": "error",
    },
  },
  {
    files: CLIENT,
    // r[impl platform.lint.ui-exemption]
    ignores: [TESTS, "src/client/lib/components/ui/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...S43,
        { selector: `Literal[value=${PALETTE}]`, message: noPalette },
        { selector: `TemplateElement[value.raw=${PALETTE}]`, message: noPalette },
        { selector: `ImportExpression > Literal.source[value=${RADIX_MODULE}]`, message: noRadix },
        {
          // The module head is the first quasi, interpolated or not.
          selector: `ImportExpression > TemplateLiteral.source > TemplateElement:first-child[value.raw=${RADIX_MODULE}]`,
          message: noRadix,
        },
        { selector: `JSXOpeningElement[name.name=${CONTROL}]`, message: noControl },
      ],
      "no-restricted-imports": ["error", { patterns: [{ group: ["radix-ui", "@radix-ui/*"], message: noRadix }] }],
    },
  },
];
