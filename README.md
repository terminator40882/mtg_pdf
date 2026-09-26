# MTG Card PDF

Upload card images, adjust crop and corner rounding, reorder by dragging, and get a PDF
with one 3.5" × 3.5" page per card.

Everything runs in the browser: the images are never uploaded anywhere. The site is
static files, deployed to GitLab Pages.

## Develop

```bash
npm ci
npm run dev        # http://127.0.0.1:4173
```

`npm run dev` is required — opening `src/index.html` over `file://` does not work,
because ES modules need an HTTP origin.

## Test

```bash
npm run test       # Vitest: geometry and PDF-matrix maths (Node, no browser)
npm run test:e2e   # Playwright: real browser, asserts the generated PDF
```

The first Playwright run needs `npx playwright install chromium`.

## Deploy

The repository is currently published with **GitHub Pages** from the repo root, so the
app is served at `<pages-url>/src/`. The `index.html` at the repo root is nothing but a
redirect to `src/`, so the bare URL works too; `.nojekyll` keeps Pages from running the
files through Jekyll.

`.gitlab-ci.yml` targets **GitLab** Pages instead: it runs both suites and copies `src/`
into `public/` for the `pages` job, landing at `https://<user>.gitlab.io/<project>/`.
GitHub ignores that file — it is only useful once a GitLab remote exists. There is no
GitHub Actions workflow yet, so the test suites do not run in CI on GitHub.

Because Pages serves the project from a subdirectory, **every path in the page must be
relative** (`./app.js`, not `/app.js`). There is no service worker, so a deploy can never
leave a stale asset behind; if a browser ever does hold on to an old module, add a `?v=`
query to the import in `index.html`.

## Layout

| Path | Purpose |
| --- | --- |
| `src/index.html`, `src/styles.css` | markup and styling |
| `src/app.js` | state, file input, generate/download/reset |
| `src/preview.js` | preview grid and drag-to-reorder |
| `src/geometry.js` | card maths and limits — pure, no DOM |
| `src/image-process.js` | canvas crop + rounded corners → JPEG |
| `src/thumbnail.js` | 200px preview thumbnails |
| `src/pdf-build.js` | page layout via pdf-lib |
| `src/controls.js` | padding, corner radius and alignment offset rows |
| `src/print-command.js` | the CUPS command shown on the Linux target |
| `src/copy-button.js` | click-to-copy with a clipboard fallback |
| `src/vendor/` | pdf-lib browser bundle (committed, so Pages needs no build) |
| `index.html`, `.nojekyll` | root redirect to `src/` for GitHub Pages |
| `old/` | the previous Flask + Pillow + fpdf2 version, kept for reference |

To refresh the vendored library after bumping `pdf-lib`: `npm run vendor`.

## Output targets

The button at the top of the page picks the page layout. The page is 88.9 × 88.9 mm
(252 pt) either way, and the crop and corner rounding are identical — only the rectangle
the card is drawn into changes.

**Linux (default)** — for borderless printing. Four adjustments, all measured against
real prints:

- the height starts at `CARD_MM.height` (88.9 mm) shrunk by the Canon G600 overscan
  factor (`OVERSCAN`, 1.0533) so the printer blows it back up,
- shrunk again by `LINUX_SIZE_CORRECTION` (835/818),
- then grown by `LINUX_SIZE_BOOST_MM` (1.1 mm),
- centred horizontally, with the card centre lifted `LINUX_LIFT_MM` (1.6 mm) above the
  page centre — so the top margin ends up 3.2 mm smaller than the bottom one,
- and cropped `LINUX_BORDER_MM` (0.7 mm) less than the padding control asks for, which
  leaves that much extra black border on the card.

The width follows the cropped image's own aspect ratio, so the card is scaled 1:1 and
never distorted. That makes the width scan-dependent: `CARD_MM.width` records the
finished size a card is meant to have, but it no longer constrains the drawing.

**Windows** — the original fpdf2 layout, unchanged: full height, width following the
cropped image's aspect ratio, flush with the top edge.

| | Linux | Windows |
| --- | --- | --- |
| image rectangle | 60.495 × 83.783 mm | 63.189 × 88.098 mm |
| margin left / right | 14.202 / 14.202 mm | 13.163 / 12.548 mm |
| margin top / bottom | 0.959 / 4.159 mm | 0.000 / 0.802 mm |
| card centre | 46.050 mm (page centre + 1.6) | 44.851 mm |
| effective crop padding | 2.1 mm | 2.8 mm |
| distortion | none (1:1) | none (1:1) |

The height is fixed; the width in that table is what the 2187 × 2975 sample scan
produces. A scan with a different aspect ratio gives a different width.

Those are measured off generated PDFs, not computed. The constants live in
`src/geometry.js` (`OVERSCAN`, `CARD_MM`, `PAGE_MM`); switching the target discards any
PDF already generated, since it was built for the other layout. The target is a printer
setting, so "Generate another" leaves it alone.

### Print alignment

On the Linux target two extra control rows appear next to padding and corner radius:
**X offset** (positive moves the card right) and **Y offset** (positive moves it up,
shown as the total including the 1.6 mm built-in lift). Both step in 0.1 mm and are
capped at ±`OFFSET_LIMIT_MM` (10 mm). They shift the card without resizing it.

These calibrate a printer rather than a batch, so "Generate another" keeps them — only
padding and corner radius reset. They are not persisted across a reload; say so if you
want that. Nudging discards an already generated PDF, since it sits at the old position.

On the Linux target the page also shows the CUPS command at the bottom; a left click
copies it, line continuations included. It lives in `src/print-command.js` — the one
place to edit when the queue name or its options change. The path is hard-coded as
`~/Downloads/mtg_cards.pdf`: the browser always names the download `mtg_cards.pdf`, so
only the directory needs adjusting if it saves somewhere else.

Note that the padding control still shows the value you set (2.8 by default); the 0.7 mm
Linux reduction is applied on top of it when the PDF is built.

## Differences from the Flask version

The page geometry is identical — `src/geometry.js` keeps the original constants,
including `mm2inch` dividing by 25.6 rather than 25.4, and the card width still follows
the cropped image's aspect ratio because that is what fpdf2 computed when given only a
height. `test/geometry.test.js` pins those numbers against a PDF built by the Python code.

Two deliberate changes:

- **Cards are embedded as JPEG on a white ground instead of PNG with transparency.**
  A page drops from ~13 MB to ~1.8 MB, which is what makes 50+ cards viable in a browser
  tab. On white paper or a white viewer background the result is indistinguishable; the
  corners are white rather than transparent. Corner edges are also antialiased now, which
  Pillow's mask was not.

  `JPEG_QUALITY` in `src/image-process.js` sets the trade-off. Measured against the
  Pillow output for a 2187×2975 scan (mean absolute channel error over the whole card):

  | quality | page size | mean Δ | 99th pct Δ |
  | --- | --- | --- | --- |
  | 0.90 | 1.21 MB | 3.2 | 12 |
  | **0.95** | **1.75 MB** | **2.6** | **9** |
  | 0.98 | 2.54 MB | 1.9 | 7 |
  | 1.00 | 5.54 MB | 0.8 | 3 |
- **Padding stops at 0 mm.** Previously the "−" button had no lower bound, and negative
  padding made Pillow *grow* the frame with black borders.
