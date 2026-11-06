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

## Descriptions, by length

One sentence about the company, stretched to fit each space GitHub and the shop
give you. Start at the top: if a longer draft no longer reads as the line above
it, it is describing something else.

| Where | Length / limit | Text |
|---|---|---|
| Tagline | 35 | `Your mail. Your records. Your rock.` |
| One line | 61 | `Mail hosting and records for people who run their own server.` |
| **GitHub org description** | 131 / 160 | `Mail hosting and record keeping for people who run their own mail server — a CRM for Bulwark Mail, and the record server behind it.` |
| Long description (About page, press, a reply) | 207 | `Mail hosting and record keeping for people who run their own mail server: a CRM for Bulwark Mail, and the record server that keeps its projects, notes and consent records across your devices — yours or ours.` |
| Site `<meta name="description">` | 117 / 155 | `Mail hosting and a CRM for people who run their own mail server: contacts, projects and time, on your server or ours.` |
| Share blurb (`og:description`, `twitter:description`) | 130 / 155 | `Your mail. Your records. Your rock. Contacts, projects and time for people who run their own mail server — on your server or ours.` |
| Social bio | 131 / 160 | `Your mail. Your records. Your rock. Mail hosting, plus the CRM that gives it contacts, companies, projects and time. → fyrhaven.com` |

Search engines cut around 155–160 characters and social unfurls around 200, so the
literal lives under the limit rather than at it.

**The organisation description holds 160 characters and cuts the rest without
saying so.** That is measured, not guessed: a 207-character paste was stored by
the API as *exactly* 160, ending mid-word — `…notes and conse`. There was no
error, the field simply stopped. So the org row is deliberately short, and
`scripts/brand-github-page.mjs` refuses to plan one that is longer.

The **repository** description is not in this table on purpose: it is a string in
[`scripts/brand-github-page.mjs`](../scripts/brand-github-page.mjs), which is the
one place that writes it, and a copy here would drift from the copy there.

**Fyrhaven or Fyrhaven CRM?** *Fyrhaven* is the host and the record server — the
company, which is what the organisation page and the shop lead with. *Fyrhaven
CRM* is the plugin, and only the plugin. A repository description that opens with
"Fyrhaven CRM" is right; an **organisation** description that does is a product
page standing where the company should be. The org description above is the one
to paste at <https://github.com/organizations/Fyrhaven/settings/profile>.

**The long one — an About page, a press note, or the reply to "so what is it?":**

> Fyrhaven is mail hosting and record keeping for people who run their own mail
> server. It comes in two pieces. **Fyrhaven CRM** is a plugin for Bulwark Mail
> that adds contacts and companies, projects with milestones, time and expenses,
> follow-ups, private notes and consent records — and finds the duplicate
> contacts every address book collects over the years, showing exactly what a
> merge will change before it changes it. **The record server** is where the
> plugin's own records live: a small key/value service with no runtime
> dependencies, encrypted at rest, running on your infrastructure or ours, so a
> note is not trapped in one browser profile.
>
> The line is *your mail, your records, your rock* — the rock being the point:
> your data sits on something solid, and you can point at it.

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
`Source: github.com/Fyrhaven/Fyrhaven-CRM`.

**GitHub org** — the description is the ladder's row above. There is no separate
bio field on an organisation: it is description (350), website, location and
email, at <https://github.com/organizations/Fyrhaven/settings/profile>. The old
line here led with "Fyrhaven CRM", which is why the organisation read as a
product page rather than a company.

## Artwork (regenerate from `brand/`)

| Place | Size | File |
|---|---|---|
| Avatar everywhere | 400×400 px | `fyrhaven-mark.svg` → PNG (the mark reads at 16 px, so 400 is generous) |
| Gravatar / profile header | upload 2048×1024, shown as a 4:1 band | `fyrhaven-header.png` — no mark in it: the avatar *is* the mark, and the beam leaves the avatar. `fyrhaven-header-wide.png` is that band |
| X header | 1500×500 (3:1) | `fyrhaven-header-wide.png` (2048×512) — X crops it to 3:1, which keeps the wordmark and the line |
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
