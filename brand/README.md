# Fyrhaven — brand sheet

The mark is a lighthouse on its rock, with the beam that makes it readable at
16 px. One ink field, one white silhouette, one warm accent.

| File | Use |
|---|---|
| `fyrhaven-mark.svg` | the icon: favicon, plugin tile, sidebar, app icon |
| `fyrhaven-mark-mono.svg` | single colour (`currentColor`): stamps, invoices, embossing, anything printing one ink |
| `fyrhaven-lockup.svg` | horizontal logo — this is where the **red/white stripes** live, because there is room for them |
| `fyrhaven-lockup-dark.svg` | the same lockup with the wordmark in Paper, for a dark page (GitHub's dark theme, the store's footer) |
| `fyrhaven-banner.svg` | 1200×630 Open Graph / social card |
| `*.png` | rendered copies of the three above, because some places take no SVG: GitHub's social preview, avatars, slide decks |

Live copies sit in `fyrhaven-server/site/` (`favicon.svg`, `banner.svg`) and
are served by the store itself.

## Where each one goes

* **README header** — the lockup, in a `<picture>` so each theme gets the
  readable variant (`prefers-color-scheme`). GitHub renders SVG; the PNG is the
  fallback for anything that does not.
* **GitHub social preview** — `fyrhaven-banner.png`, uploaded by hand: *Settings
  → General → Social preview → Edit*. There is no API for it, so it is a one-off
  click, not a step in `npm run release`.
* **Org avatar / favicon** — `fyrhaven-mark.png` (512×512) or the SVG where SVG
  is accepted.
* **Printing one ink** — `fyrhaven-mark-mono.svg`, never a file with a field.

The PNGs are rendered from the SVGs with [sharp](https://sharp.pixelplumbing.com)
— a throwaway install, deliberately **not** a dependency of either package:

```bash
cd brand
npx --yes sharp-cli -i fyrhaven-banner.svg      -o fyrhaven-banner.png      resize 1200 630
npx --yes sharp-cli -i fyrhaven-lockup.svg      -o fyrhaven-lockup.png      resize 1260 288
npx --yes sharp-cli -i fyrhaven-lockup-dark.svg -o fyrhaven-lockup-dark.png resize 1260 288
npx --yes sharp-cli -i fyrhaven-mark.svg        -o fyrhaven-mark.png        resize 512 512
```

Re-render after any change to the palette or the wordmark; a stale PNG is the
one asset nobody notices is wrong.

## Palette

| Token | Hex | Where |
|---|---|---|
| Ink — night sea | `#0E2233` | icon field, headings, primary buttons |
| Paper | `#F7F9FA` | page background, the silhouette on ink. Never pure `#FFF` |
| Signal red | `#C8453B` | **only** the tower's bands, and the edge of the beam |
| Beam amber | `#F2B441` | the light, and one accent per screen. Never a background |
| Rock slate | `#5B7382` | secondary text, rules, metadata |

## Rules

1. **Stripes belong to the lockup, not the icon.** At 16 px a striped tower
   becomes a grey smear; the silhouette plus beam survives.
2. **One signal colour per screen.** Red *or* amber, never both fighting.
3. **Clear space**: ¼ of the mark's height on every side, never less.
4. **Minimum size**: mark 16 px (icon), lockup 120 px wide. Below those, use the mark alone.
5. **On photographs or busy art**, use the mono mark in `#F7F9FA`, never the colour one.
6. **Don't** add gradients, drop shadows, outlines, or a second red. Don't rotate
   the mark, recolor the beam, or place the lockup on the beam.

## To export

The PNGs in this folder are committed, because some places take no SVG. They are
rendered from the SVGs with [sharp](https://sharp.pixelplumbing.com) — a throwaway
install, deliberately **not** a dependency of either package:

```bash
cd brand
npx --yes sharp-cli -i fyrhaven-banner.svg      -o fyrhaven-banner.png      resize 1200 630
npx --yes sharp-cli -i fyrhaven-lockup.svg      -o fyrhaven-lockup.png      resize 1260 288
npx --yes sharp-cli -i fyrhaven-lockup-dark.svg -o fyrhaven-lockup-dark.png resize 1260 288
npx --yes sharp-cli -i fyrhaven-mark.svg        -o fyrhaven-mark.png        resize 512 512
```

Re-render after any change to the palette or the wordmark: a stale PNG is the one
asset nobody notices is wrong. If `rsvg-convert` is at hand it will do the same
job from the same sources.

The wordmark is set in a system humanist stack (`Inter`, `Segoe UI`, `system-ui`)
because no typeface is licensed yet. When one is, replace the two `<text>` nodes in
`fyrhaven-lockup.svg` with outlined paths so the logo stops depending on a font.

## The repository page on GitHub

The parts of the page that live in GitHub's settings rather than in this tree.
The API refuses them for the credential this workspace runs as — the app holds
*Contents: write*, not *Administration: write* — so they are pasted by hand,
once. These are the values to paste.

**Settings → General**

| Field | Value |
|---|---|
| Description | `Contacts, companies, projects and time for Bulwark Mail — find and merge duplicate contacts across every address book, keep notes and consent records on a server you own, and follow them between devices. Plus the record server they live on.` |
| Website | `https://fyrhaven.com` |
| Topics | `crm`, `contacts`, `address-book`, `duplicate-detection`, `email`, `stalwart`, `bulwark-mail`, `webmail`, `plugin`, `self-hosted` |
| Social preview | `brand/fyrhaven-banner.png` |

**The organisation page** (`github.com/Fyrhaven`) — avatar `brand/fyrhaven-mark.png`,
and the 160-character bio in [`social.md`](social.md).

The README header needs no clicks: it is a `<picture>` with a
`prefers-color-scheme` source, so each GitHub theme gets the variant it can read.

## The name

*Fyr* = lighthouse (Swedish/Norwegian); *haven* = a sheltered place for ships.
The line is **"Your mail. Your records. Your rock."** — the rock is the point:
your data sits on something solid, whether that is our server or yours.
