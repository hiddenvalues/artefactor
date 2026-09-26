# Theme: Mint garden

## Summary

Mint garden replaces the neutral black theme. Light mode is pure white with a mint primary and
forest-green text on it. Dark mode is near-black forest with the same mint primary. Neutrals stay
gray, so green appears only on primary actions, focus rings and product colours.

## Colours

| Token | Light | Dark |
| -- | -- | -- |
| `--background` | `#fff` | `oklch(0.11 0.02 150)` |
| `--foreground` | `oklch(0.145 0 0)` | `oklch(0.97 0.02 90)` |
| `--card` | `#fff` | `oklch(0.155 0.025 150)` |
| `--card-foreground` | `oklch(0.145 0 0)` | `oklch(0.97 0.02 90)` |
| `--popover` | `#fff` | `oklch(0.155 0.025 150)` |
| `--popover-foreground` | `oklch(0.145 0 0)` | `oklch(0.97 0.02 90)` |
| `--primary` | `oklch(0.85 0.05 170)` | `oklch(0.85 0.05 170)` |
| `--primary-foreground` | `oklch(0.26 0.05 150)` | `oklch(0.26 0.05 150)` |
| `--secondary` | `oklch(0.97 0 0)` | `oklch(0.21 0.025 150)` |
| `--secondary-foreground` | `oklch(0.205 0 0)` | `oklch(0.97 0.02 90)` |
| `--muted` | `oklch(0.97 0 0)` | `oklch(0.21 0.025 150)` |
| `--muted-foreground` | `oklch(0.556 0 0)` | `oklch(0.78 0.03 150)` |
| `--accent` | `oklch(0.97 0 0)` | `oklch(0.25 0.035 150)` |
| `--accent-foreground` | `oklch(0.205 0 0)` | `oklch(0.85 0.05 170)` |
| `--destructive` | `oklch(0.577 0.245 27.3)` | unchanged |
| `--border` | `oklch(0.922 0 0)` | `oklch(1 0 0 / 9%)` |
| `--input` | `oklch(0.922 0 0)` | `oklch(1 0 0 / 14%)` |
| `--ring` | `oklch(0.62 0.1 170)` | `oklch(0.85 0.05 170)` |
| `--sidebar` | `#fff` | `oklch(0.155 0.025 150)` |
| `--sidebar-foreground` | `oklch(0.145 0 0)` | `oklch(0.97 0.02 90)` |
| `--sidebar-primary` | `oklch(0.85 0.05 170)` | `oklch(0.85 0.05 170)` |
| `--sidebar-primary-foreground` | `oklch(0.26 0.05 150)` | `oklch(0.26 0.05 150)` |
| `--sidebar-accent` | `oklch(0.97 0 0)` | `oklch(0.25 0.035 150)` |
| `--sidebar-accent-foreground` | `oklch(0.205 0 0)` | `oklch(0.85 0.05 170)` |
| `--sidebar-border` | `oklch(0.922 0 0)` | `oklch(1 0 0 / 9%)` |
| `--sidebar-ring` | `oklch(0.62 0.1 170)` | `oklch(0.85 0.05 170)` |

## Product colours

| Token | Light | Dark |
| -- | -- | -- |
| `--kind-prototype` | `oklch(0.56 0.09 170)` | `oklch(0.85 0.06 170)` |
| `--kind-slide-deck` | `oklch(0.64 0.13 55)` | `oklch(0.80 0.11 60)` |
| `--kind-form` | `oklch(0.56 0.11 240)` | `oklch(0.78 0.08 240)` |
| `--kind-interactive-doc` | `oklch(0.60 0.14 350)` | `oklch(0.80 0.09 350)` |
| `--kind-other` | `oklch(0.55 0.02 160)` | `oklch(0.74 0.02 160)` |
| `--kind-*-tint` | same colour at 12% (slide deck 13%) | same colour at 16% |
| `--collection-1` | `oklch(0.58 0.09 170)` | `oklch(0.85 0.05 170)` |
| `--collection-2` | `oklch(0.64 0.13 40)` | `oklch(0.80 0.08 40)` |
| `--collection-3` | `oklch(0.56 0.11 240)` | `oklch(0.76 0.08 240)` |
| `--collection-4` | `oklch(0.68 0.13 70)` | `oklch(0.80 0.10 75)` |
| `--collection-5` | `oklch(0.62 0.14 350)` | `oklch(0.80 0.09 350)` |
| `--collection-6` | `oklch(0.50 0.10 145)` | `oklch(0.72 0.08 145)` |

## Radius

Unchanged.

## Fonts

Unchanged.

## Prototype

[https://artefactor.cloud/a/9UlOi_dDWZQ](<https://artefactor.cloud/a/9UlOi_dDWZQ>)

## Notes for engineering

* The product colours currently exist only in `:root`. This change adds `.dark` overrides for them.
* After `/design-sync`, the `ThemeSpecimen` card should match the prototype.
* The design-sync check shows two issues from Tailwind's internal variables (`--tw-*` and the
  `space-y-*` / `divide-*` helpers). Please leave those out of the design-sync export, or mark
  them `/* @kind other */`.
