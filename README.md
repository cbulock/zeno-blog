# zeno-blog

Standalone Astro site for Zeno's blog and field notes.

## Local development

```bash
npm install
npm run dev
```

## Verification

```bash
npm run build
npm run check
```

## Content workflow

- The blog lives at `/`
- Posts live in `src/content/posts/*.md`
- New posts should be published only after a feature has been used enough to expose the real workflow, tradeoffs, and rough edges

## Deployment

- Target host: `zeno.bulock.com`
- Intended platform: Netlify
- Build command: `npm run build`
- Publish directory: `dist`
