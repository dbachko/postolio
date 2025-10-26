# shadcn/ui Usage Guide (Project Standard)

This project standardizes all UI on shadcn/ui. Follow the guidelines below for adding components, importing them, and using colors consistently.

## Install Components

- Preferred (auto‑path via components.json):
  - From `packages/apps/web/`:
    - `pnpm dlx shadcn@latest add <component> -y`
  - Example: `pnpm dlx shadcn@latest add button input select dialog`
- If the CLI ever prompts or writes to the wrong place, pass the explicit path:
  - `pnpm dlx shadcn@latest add <component> -y -p src/components/ui`
- Verify configuration:
  - `pnpm dlx shadcn@latest info` → `resolvedPaths.ui` should be `src/components/ui`
- Registry notes:
  - Some compound patterns (e.g., `date-picker`, `combobox`) may not exist as single items. Compose them per docs using `calendar + popover + input` (date picker) and `command + popover` (combobox).

## Import Pattern

- Always import UI primitives from the local alias path:
  - `import { Button } from '@/components/ui/button';`
- Do not import from relative paths like `./ui/*`, `../components/ui/*`, or `src/components/ui/*`.
  - The linter will fail such imports.

## Colors and Tokens

We do not keep legacy Tailwind color classes. Use shadcn tokens and neutral styling.

- Use semantic token classes:
  - Backgrounds: `bg-background`, `bg-card`, `bg-muted`
  - Text: `text-foreground`, `text-muted-foreground`, `text-card-foreground`
  - Borders: `border`, `border-border`
- Avoid hard-coded palette utilities:
  - Don’t use `text-blue-600`, `bg-red-100`, `border-gray-200`, etc.
  - Prefer neutral or tokenized classes that adapt to theme.
- Exception: dynamic, data-driven colors are allowed
  - Keep colors that come from data (e.g., brand/campaign palette, user-selected color chips).
  - Apply via inline styles or CSS variables, not Tailwind palette utilities.
    - Example (campaign accent):
      ```tsx
      <div
        style={{ borderLeftColor: campaignColor, borderLeftWidth: 4, borderLeftStyle: 'solid' }}
      />
      ```
    - Example (chip):
      ```tsx
      const chipStyle = { backgroundColor: hex, color: 'hsl(var(--foreground))' };
      <span className="inline-flex items-center rounded px-2 py-0.5 text-xs" style={chipStyle}>
        {label}
      </span>;
      ```
  - Consider contrast: when placing text on a dynamic background, compute readable text color or use neutral text and only color the border/dot.
- Destructive/Status:
  - Use `text-destructive` for error text and component variants (e.g., `Alert` “destructive” variant) instead of bespoke red classes.
  - For status visualization, prefer icons and neutral backgrounds instead of color‑coding by status.
- If you must reference a token directly in inline styles, use CSS variables:
  - Example: `style={{ color: 'hsl(var(--foreground))' }}`

## Composition & Variants

- shadcn components are open code. Extend them by editing files under `src/components/ui/*`.
- In app code, avoid creating new CVA color variants. Use the provided component variants (e.g., `variant="outline"`) or neutral classes.
- Use `cn()` sparingly for layout concerns; not for custom color palettes.

## Minimal CSS Baseline

- Tailwind is present only to support shadcn/ui styles. We removed custom tokens.
- Keep `src/index.css` minimal; don’t add new custom color scales or theme layers.
- Base color: Slate
  - Config: `packages/apps/web/components.json` → `tailwind.baseColor: "slate"` (packages/apps/web/components.json:9)
  - Tokens: defined in `packages/apps/web/src/index.css` under `:root` and `.dark` (packages/apps/web/src/index.css:71 and packages/apps/web/src/index.css:99)
  - To change base color in the future, run `pnpm dlx shadcn@latest init` or update `components.json` and regenerate tokens per docs: https://ui.shadcn.com/docs/theming#base-colors

### Prevent Theme Flash (Preload Snippet)

We use `next-themes` with the class strategy and a short pre-hydration script to avoid a flash of the wrong theme on first paint.

- Already added in `packages/apps/web/index.html:7`.
- Storage key: `postolio-theme-mode` (matches our ThemeProvider).
- What it does:
  - Reads saved mode: `system | light | dark`.
  - Applies `html.dark` before React mounts (when system prefers dark or mode is `dark`).
  - Temporarily disables CSS transitions via `html.theme-preload` to avoid flicker, then removes it after load.

Reference snippet (for future apps):

```html
<style id="theme-preload-style">
    html.theme-preload *,
    html.theme-preload *::before,
    html.theme-preload *::after {
      transition: none !important;
      animation: none !important;
    }
  }
</style>
<script>
  (function () {
    try {
      var storageKey = 'postolio-theme-mode';
      var mode = localStorage.getItem(storageKey) || 'system';
      var prefersDark =
        window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      var isDark = mode === 'dark' || (mode === 'system' && prefersDark);
      var root = document.documentElement;
      root.classList.add('theme-preload');
      if (isDark) root.classList.add('dark');
      else root.classList.remove('dark');
      var removePreload = function () {
        root.classList.remove('theme-preload');
      };
      if (document.readyState === 'complete') {
        requestAnimationFrame(function () {
          requestAnimationFrame(removePreload);
        });
      } else {
        window.addEventListener('load', function () {
          requestAnimationFrame(function () {
            requestAnimationFrame(removePreload);
          });
        });
      }
    } catch (e) {}
  })();
</script>
```

## Validation & Tooling

- Lint enforces import path to `@/components/ui/*`.
- Build locally:
  - `pnpm --filter @postolio/web build`

## Quick Examples

- Button:
  ```tsx
  import { Button } from '@/components/ui/button';
  <Button>Save</Button>
  <Button variant="outline">Cancel</Button>
  ```
- Form inputs:
  ```tsx
  import { Label } from '@/components/ui/label';
  import { Input } from '@/components/ui/input';
  <Label htmlFor="email">Email</Label>
  <Input id="email" type="email" className="w-full" />
  ```
- Dialog:
  ```tsx
  import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
  } from '@/components/ui/dialog';
  <Dialog>
    <DialogTrigger asChild>
      <Button>Open</Button>
    </DialogTrigger>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Title</DialogTitle>
      </DialogHeader>
      Content
    </DialogContent>
  </Dialog>;
  ```

## Do / Don’t

- Do
  - Install with the CLI and keep components under `src/components/ui`
  - Import from `@/components/ui/*`
  - Use token classes (`bg-muted`, `text-foreground`, `border-border`)
  - Keep colors neutral unless a component variant provides semantics
- Don’t
  - Don’t use `text-blue-*`, `bg-red-*`, `border-gray-*` in app components
  - Don’t duplicate primitives outside `src/components/ui`
  - Don’t invent new color scales or themes in `index.css`

## Links

- shadcn/ui docs: https://ui.shadcn.com/docs/components
- CLI: `pnpm dlx shadcn@latest --help`
- Our migration plan: docs/shadcn-ui-migration-plan.md
