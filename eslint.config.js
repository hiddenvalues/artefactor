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

export default [
  {
    files: ["src/client/**/*.{ts,tsx}"],
    ignores: ["src/client/**/*.test.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: `${STYLE} > Literal`, message: noInlineStyle },
        { selector: `${VALUE} > :not(ObjectExpression, TSAsExpression, CallExpression)`, message: noInlineStyle },
        { selector: `${VALUE} > TSAsExpression[expression.type!="ObjectExpression"]`, message: noInlineStyle },
        { selector: `${VALUE} > CallExpression[callee.name!=/^(kindVars|hueVars)$/]`, message: noInlineStyle },
        { selector: `${OBJECT} > Property[key.type!="Literal"]`, message: noInlineStyle },
        { selector: `${OBJECT} > Property[key.type="Literal"][key.value!=/^--/]`, message: noInlineStyle },
        { selector: `${OBJECT} > SpreadElement`, message: noInlineStyle },
        { selector: `Literal[value=${COLOUR}]`, message: noRawColour },
        { selector: `TemplateElement[value.raw=${COLOUR}]`, message: noRawColour },
      ],
    },
  },
];
