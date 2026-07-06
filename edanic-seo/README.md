# Edanic SEO/GEO scaffolding

Where each file goes:
- `llms.txt` → site root `/llms.txt`
- `sitemap.xml` → site root `/sitemap.xml` — merge with your existing sitemap, do NOT replace
- `robots.append.txt` → APPEND these lines to your existing `/robots.txt` (do not replace the file)

## Hard requirement — server-side rendering
AI answer engines (GPTBot/ClaudeBot/PerplexityBot) do not run JS. Pages must be SSG/SSR with per-page <title>/<meta description>/ld+json in the HTML.
Verify after deploy: `curl -A 'GPTBot' <page-url> | grep '<a phrase from the body>'` — no output = invisible to AI.
