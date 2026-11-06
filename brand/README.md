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
| `fyrhaven-header.svg` | profile header, drawn at **2048×460 (40:9)** — the ratio Gravatar displays. **No mark in it**: the profile picture is the mark, and the beam leaves the avatar |
| `*.png` | rendered copies of the SVGs above, because some places take no SVG: GitHub's social preview, Gravatars, avatars, slide decks |

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
* **Profile headers** — `fyrhaven-header.png`, 2048×460 (40:9, the band Gravatar
  renders). **No words in it**, on purpose: the cover is the light, and anything
  else is added once the light is settled.

  What it is: an ink field, a yellow beam that starts narrow, opens at the avatar's
  edge and fades out to the right, the lantern's bloom behind the profile picture,
  and the tower as a shape you sense rather than see — the mark, hugely scaled and
  blurred past recognition, at 16% opacity.

  **Nothing in it is aligned to the avatar.** A cover is shown at wildly different
  widths — a phone cuts it to a sliver — so anything that has to meet the profile
  picture will be wrong somewhere. That is why the earlier drawn-beam versions
  never stayed right, and why this one is built from a beam that spans the canvas
  and a glow that sits behind whatever covers the left corner.

  Two filters, not one: a soft halo (`halo`, blur 22) and a tighter core (`tight`,
  blur 7). One blur cannot be both, and the diluted result goes olive instead of
  yellow — which it did, three times.
* **Printing one ink** — `fyrhaven-mark-mono.svg`, never a file with a field.

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
npx --yes sharp-cli -i fyrhaven-header.svg      -o fyrhaven-header.png      resize 2048 460
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

## The organisation page

`github.com/Fyrhaven` is rendered from a **public repository named `.github`** in
the organisation, at `profile/README.md`. That name is the mechanism, not a typo —
there is no org-level setting for the page, and no API that writes it.

The copy lives here, once: [`org-profile.md`](org-profile.md). The two lockups
travel with it, because the page's own images are relative. Publishing is one
command — it creates the repository on the first run and updates the files on
every run after:

```bash
node scripts/publish-org-profile.mjs            # the plan, changes nothing
node scripts/publish-org-profile.mjs --apply    # create or update, then read back
```

Creating a repository in an organisation needs *Administration: write* — the same
permission the page settings below need. Until it is granted, make the repository
by hand once (*New repository*, owner `Fyrhaven`, name `.github`, visibility
**public**) and re-run the script; it fills it and reads its own writes back. That
is the whole difference between the two routes.

Two traps this page has already sprung, both of which look fine while you are
signed in:

* **The images must live in the `.github` repository.** Pointing them at
  `Fyrhaven-CRM/brand/…` — which is where the logo actually is — renders for the
  author and 404s for every visitor, because that repository is private. Both
  lockups are copied into `profile/` under the names the copy references, so a run
  updates them rather than adding a second set.
* **`readme.md` is not `README.md`.** GitHub's lookup there is case-insensitive, so
  the lowercase spelling does render — but its documentation names `README.md`, and
  so do its own orgs (`github/.github`, `nodejs/.github`, `microsoft/.github`, all
  `profile/README.md`). The script writes the documented spelling and removes the
  variant, rather than leaving two copies to drift apart.

## The repository page on GitHub

The description, website and topics are the only part of the branding that is not
a file in this tree. Writing them needs a permission that pushing a commit does
not — *Administration: write* rather than *Contents: write* — and the app this
workspace runs as has the second and not the first. So the values live in one
script, which plans first and writes when it is allowed to:

```bash
node scripts/brand-github-page.mjs            # the exact strings, changes nothing
node scripts/brand-github-page.mjs --apply    # writes them, then reads them back
```

The script is the single source of the wording, so the plan and the write cannot
disagree. Without the permission it refuses and prints the one settings click that
grants it, instead of a stack trace.

Two things no API can set, so they stay clicks:

| Where | What |
|---|---|
| *Settings → General → Social preview* | `brand/fyrhaven-banner.png` (1200×630) — **only offered once the repository is public.** The setting first appears when the repository has one, and GitHub's own wording is that an image "can only be shared from a public repository". A private repository has no section to look for, which is not the same as it being somewhere else |
| The organisation page, `github.com/Fyrhaven` | avatar `brand/fyrhaven-mark.png`; the bio in [`social.md`](social.md) |

The card that works while the repository is private is the shop's, not GitHub's:
`fyrhaven-server/site/index.html` declares an absolute PNG (`/banner.png`, served
from `site/banner.png`) for Open Graph and Twitter, and a test pins that it stays
absolute and stays raster — a crawler resolves no relative path and renders no
SVG, so either mistake is a card that silently never appears.

The README header needs no clicks at all: it is a `<picture>` with a
`prefers-color-scheme` source, and GitHub renders it as `<themed-picture>`, so
each theme gets the lockup it can actually read.

## The name

*Fyr* = lighthouse (Swedish/Norwegian); *haven* = a sheltered place for ships.
The line is **"Your mail. Your records. Your rock."** — the rock is the point:
your data sits on something solid, whether that is our server or yours.
