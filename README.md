# personal-website

My personal website. Built with Vite + TypeScript, deployed to GitHub Pages.

## Develop

```bash
npm install
npm run dev      # local dev server
npm run build    # type-check + build into dist/
npm run preview  # preview built site
```

## Deploy

Pushes to `main` are deployed by `.github/workflows/deploy.yml`. Enable Pages
in repo Settings → Pages → Source: **GitHub Actions** before the first deploy.

Live URL: https://phildeorsey.github.io/personal-website/

When a custom domain is added, drop `base` from `vite.config.ts`.
