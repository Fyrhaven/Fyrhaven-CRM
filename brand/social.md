# Fyrhaven — social launch pack

**What I can't do, and why:** create the accounts. Every one of those platforms
wants a phone or email verification, a CAPTCHA, and a click accepting *their*
terms as the account owner — and automating sign-ups is against all their terms.
So this file is everything up to the click: what to claim, what to write, what to
post. Ten minutes of your hands, not mine.

## Handles to claim — in this order

| Place | Handle | Checked |
|---|---|---|
| **GitHub** (org, not a user) | `fyrhaven` | free on 2026-11-05 |
| **npm** (scope, so packages publish as `@fyrhaven/…`) | `@fyrhaven` | `fyrhaven` free |
| **YouTube** | `@fyrhaven` | check at claim time |
| **X** | `@fyrhaven` | check at claim time |
| **Instagram** | `fyrhaven` | check at claim time |
| **TikTok** | `@fyrhaven` | check at claim time |
| **Mastodon** (social.linux.pizza or fosstodon.org) | `@fyrhaven` | where your audience is |
| **Reddit** (user, not subreddit) | `u/fyrhaven` | r/selfhosted is the room that matters |

Claim them **all in one sitting, even if you post nothing for months** — a handle
is a defensive registration, and `@fyrhaven` on a competitor is a bad afternoon.
Skip LinkedIn for now: it wants a real legal entity behind a company page.

## Bios, by platform

**YouTube (1 000 chars)** — "Mail hosting and a CRM for people who run their own
mail server. Stalwart + Bulwark. Your mail. Your records. Your rock. →
fyrhaven.com"

**X (160)** — "Mail hosting + CRM for self-hosters. Your mail. Your records. Your
rock. Built on Stalwart and Bulwark. → fyrhaven.com"

**Instagram (150)** — "Your mail. Your records. Your rock. Self-hosted mail and
CRM, set up properly. → fyrhaven.com"

**TikTok (80)** — "Self-hosted mail + CRM. fyrhaven.com"

**Mastodon (bio + 4 fields)** — same as X, plus fields for `Website`,
`Source: github.com/zyntrax/bulwark-plugins`.

**GitHub org (160)** — "Fyrhaven CRM — contacts, companies, projects and time for
Bulwark Mail, plus the record server it can talk to."

## Artwork (regenerate from `brand/`)

| Place | Size | File |
|---|---|---|
| Avatar everywhere | 400×400 px | `fyrhaven-mark.svg` → PNG (the mark reads at 16 px, so 400 is generous) |
| X header | 1500×500 | banner, cropped to the left third so the mark stays visible |
| YouTube banner | 2560×1440 (safe area 1546×423) | banner, mark inside the safe area |
| Instagram / TikTok | 1080×1920 story | mark on ink, headline in the lower third |
| OG card | 1200×630 | `fyrhaven-banner.svg` (already served at `/banner.svg`) |

## The first three posts (write once, adapt)

1. **The problem, not the product.** "Found 41 duplicate contacts in my own
   address book. Two of them were the same person under three spellings. So I
   built the thing that finds and merges them — and shows you exactly what will
   change before it does."
2. **The demo.** A 40-second screen recording: open the plugin, scan, review a
   group with the green `+` / orange `~` / `≠` marks, merge, undo. One feature,
   end to end. This clip is worth more than any copy.
3. **The honest one.** "It is not finished. Here is what works, here is what does
   not, and here is the price." Shipping in public is the only marketing a solo
   product actually gets — and it earns the self-hosted crowd's trust, which is
   the only crowd that will pay for this.

## Rules that keep it from becoming a chore

- **One channel, done properly, beats five abandoned ones.** For this audience
  that channel is **GitHub + r/selfhosted + Mastodon**; short-form video is where
  strangers are, not where your buyers are.
- **Never buy followers or engagement.** It is visible, it is fatal to trust in
  this niche, and it is against every platform's terms.
- **Link the thing, not the brand.** Every post should end with what a person can
  do in the next click: try the demo, read the price, install the plugin.
- **Do not post before the Stripe webhook and live prices exist** — a launch that
  takes money it cannot honour is the one mistake that cannot be undone.
