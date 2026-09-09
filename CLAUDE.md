# San Mateo Local — Code Instructions

Repo for the San Mateo Local directory site (sanmateolocal.com). Read this before building or changing listings.

## Build & deploy essentials

- **Deploy = `git push origin main` → Vercel.** Never use the Vercel CLI.
- **`data/` and `scripts/` are gitignored.** The committed HTML at repo root is the deployed site; the generators (`build-*.mjs`) and `data/listings.json` live in `scripts/` and `data/` and are not deployed.
- **Run `scripts/check-listings.mjs` before every push** (the deploy gate: catches orphan/untracked detail pages, duplicates, dead `/business/` links).
- **After any listing change, run `scripts/build-business-pages.mjs --all`** — normal `build-pages.mjs` runs skip the `/business/` detail pages.
- `build-pages.mjs` regenerates `gone-but-not-forgotten.html` and drops its hand-added quiz CTA; restore it (`git restore gone-but-not-forgotten.html`) after running, until the CTA is moved into the generator.
- Global style changes touch all ~1,100 detail pages; use data-gated **inline** styles folded onto an existing template line so pages without the data get zero diff (avoids whitespace churn across every page).

## Regulated businesses need their own disclosure line

When building a listing for a business that **sells or advises on securities, investments, advisory services, or insurance**, copy the disclosure line **verbatim from the business's own website footer** and put it in the listing's `disclosure` field. `build-business-pages.mjs` renders it as a muted fine-print line below the About paragraph. **Do not write your own wording.** Does **not** apply to accountants, tax preparers, or attorneys (different rules, no FINRA obligation).

Why: FINRA links a rep's public promotion to the firm that supervises them; a page carrying the advisor's name that omits who stands behind them is compliance exposure for that person, on a page they did not write. One sentence costs nothing; omitting it does not.

Full rule, reasoning, and the worked Maven Lane / LPL Financial example: project doc **"Standing rule — regulated businesses need their own disclosure line."**
