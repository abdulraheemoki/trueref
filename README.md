# TrueRef

**Check and fix your references. Your work never leaves your device.**

TrueRef is a free referencing helper for students. It has three tools:

1. **Check my work** – upload or paste an assignment. TrueRef compares your in-text citations with your reference list and lists anything to check: citations missing from the list, references never cited, year mismatches, spelling differences, list order, "et al." use, `and`/`&` use, and direct quotes without page numbers. It supports Harvard (Cite Them Right), APA 7th and Chicago author-date.
2. **Fix my reference list** – paste or upload your list. TrueRef reads each reference, shows you how it understood it (highlighting anything uncertain, with fields you can correct), then gives you the whole list in the right order and in your chosen style.
3. **Create a reference** – fill in a form, or paste a DOI, and copy a finished reference plus the in-text citation. Build up a list as you go.

Styles for fixing and creating: Harvard (Cite Them Right), APA 7th, Chicago author-date, MLA 9th, IEEE and Vancouver.

## Privacy promises

- No sign-up, no accounts, no analytics, no cookies, no database.
- Everything (including reading Word and PDF files) happens in the browser. Files are never uploaded.
- TrueRef **never rewrites the essay**. It only reads it and points things out. The reference list is the only thing it reformats.
- The only network request is optional and clearly labelled: looking up reference details on Crossref (a DOI, or the text of a reference). The essay is never sent.
- The page's Content Security Policy only allows connections to its own site and `api.crossref.org`, so this is enforced by the browser, not just promised.
- Once loaded, it works with Wi-Fi turned off.
- Light and dark mode follow the device setting, with a switch to change it. The choice is remembered only in that browser.
- The layout adapts to phones, tablets and desktops.

## Project layout

```
public/            The website (this is all that gets hosted)
  index.html       Page and styles
  app.js           Interface: tabs, file reading, rendering, copying
  core.js          Checking and reference-parsing logic (no network, no storage)
  vendor/          citeproc-js, mammoth.js, PDF.js
  csl/             Referencing styles and language files
  theme.js         Applies your saved light/dark choice before the page draws
  _headers         Security headers for Cloudflare
tests/             Sample essays and scripts to test core.js in Node
wrangler.jsonc     Cloudflare config (static files only)
```

## Run it locally

Any static file server works, for example:

```
cd public
python3 -m http.server 8000
```

Then open http://localhost:8000. (Opening `index.html` directly from disk will not work, because browsers block loading the style files from `file://`.)

## Test the logic

```
npm install
npm test
```

## Deploy (free) on Cloudflare

Same as TrueCVFit: push this folder to a GitHub repository, then in Cloudflare go to **Workers & Pages → Create → Import a repository**, pick the repo and deploy. Cloudflare reads `wrangler.jsonc` and serves the `public` folder. No build command is needed.

## Known limits

- It reads text with rules, not AI, so unusual citation wording can be missed or misread. Results are suggestions to check.
- PDFs can extract in a jumbled order, and scanned PDFs contain no text. Word files give the cleanest results.
- Universities adapt styles. Students should always follow their own module handbook.

Built by Abdulraheem Oki. See `THIRD_PARTY_NOTICES.md` for open-source credits.
