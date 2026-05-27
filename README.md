# personal-website

Source for [phildeorsey.github.io/personal-website](https://phildeorsey.github.io/personal-website/).

Primarily my personal site, but this repo also hosts the occasional demo, sandbox, or proof-of-concept — small things I want to share publicly or point at from a conversation. If you landed here from a link, the relevant code is probably under `projects/` or `src/`.

Built with Vite + TypeScript, deployed to GitHub Pages.

## Develop

```bash
npm install
npm run dev      # local dev server
npm run build    # type-check + build into dist/
npm run preview  # preview built site
```

## Deploy

Pushes to `main` are deployed by `.github/workflows/deploy.yml`. Pages source is set to **GitHub Actions** in repo settings.

When a custom domain is added, drop `base` from `vite.config.ts`.
