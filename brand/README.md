# Fyrhaven — brand sheet

The mark is a lighthouse on its rock, with the beam that makes it readable at
16 px. One ink field, one white silhouette, one warm accent.

| File | Use |
|---|---|
| `fyrhaven-mark.svg` | the icon: favicon, plugin tile, sidebar, app icon |
| `fyrhaven-mark-mono.svg` | single colour (`currentColor`): stamps, invoices, embossing, anything printing one ink |
| `fyrhaven-lockup.svg` | horizontal logo — this is where the **red/white stripes** live, because there is room for them |
| `fyrhaven-banner.svg` | 1200×630 Open Graph / social card |

Live copies sit in `contact-manager-server/site/` (`favicon.svg`, `banner.svg`) and
are served by the store itself.

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

```bash
# icon set (once a converter is at hand — this repo ships SVG only, no binaries)
rsvg-convert -w 512 -h 512 brand/fyrhaven-mark.svg > fyrhaven-512.png
rsvg-convert -w 180 -h 180 brand/fyrhaven-mark.svg > apple-touch-icon.png
rsvg-convert -w 1200 -h 630 brand/fyrhaven-banner.svg > og-image.png
```

The wordmark is set in a system humanist stack (`Inter`, `Segoe UI`, `system-ui`)
because no typeface is licensed yet. When one is, replace the two `<text>` nodes in
`fyrhaven-lockup.svg` with outlined paths so the logo stops depending on a font.

## The name

*Fyr* = lighthouse (Swedish/Norwegian); *haven* = a sheltered place for ships.
The line is **"Your mail. Your records. Your rock."** — the rock is the point:
your data sits on something solid, whether that is our server or yours.
