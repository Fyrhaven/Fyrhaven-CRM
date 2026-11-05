# Fyrhaven — the business checklist

Kept here rather than in a chat, because it has dates and money in it.

## Now: enskild firma (sole trader)

- [ ] **F-skatt** — apply through [verksamt.se](https://verksamt.se) (Skatteverket). Free. You can invoice the day it is approved.
- [ ] **VAT (moms)** — same flow. Required for selling digital services.
- [ ] **Register the business name** (`firma`) with Bolagsverket so "Fyrhaven" is yours — ~1 000 SEK, optional, worth it.
- [ ] **Business insurance** (`ansvarsförsäkring`, home-business cover) — ~1 500–3 000 SEK/year. This is the mitigation that lets a sole trader hold other people's data.
- [ ] **Fill the four brackets** in `fyrhaven-server/site/imprint.html`: name, address, organisation number (if registered), VAT number.
- [ ] **Keep a simple ledger** from the first invoice: receipts in a folder, a spreadsheet with date / what / amount / VAT.

## Before taking real money

- [ ] Stripe **live** keys (`sk_live_…`), re-run *Create in Stripe* on each product (test prices do not exist live), add a live webhook with its own `whsec_…`.
- [ ] Prices decided **per currency as prices**, not conversions (EUR base; SEK/USD added per product with their own Stripe price).
- [ ] VAT handling chosen: under the €10 000 EU B2C threshold, or **OSS** registration via Skatteverket. Stripe Tax calculates; you still file.
- [ ] `/terms` and `/privacy` read once more by you, as the person who has to stand behind them.

## When revenue justifies an AB

Any of: ~10–15 000 SEK/month profit; a customer's procurement asking for a registered company; or risk growing (holding mail for a dozen businesses). Then: Bolagsverket registration, 25 000 SEK share capital (capital, not a fee), ~2 200 SEK fee, a Swedish bank account for the deposit certificate. Moving a sole trader's business into an AB is routine and has tax-relief rules — one hour with an accountant when you get there.

## GDPR, because you are a **processor** for your customers

- [ ] A one-page **data-processing agreement** you can send a business customer.
- [ ] An **Art. 30 record** of processing (what, why, where, how long).
- [ ] The honesty already written on `/privacy` stays: records are encrypted at rest with a server-held key, so the operator *can* read them. A customer-held key is the change that would make that untrue, and it is not built.

## Brand

- [ ] Claim the handles in one sitting — see `brand/social.md`. `github.com/fyrhaven` and the npm name `fyrhaven` were free on 2026-11-05; create the GitHub one as an **organisation** and transfer the repo before the first public release.
- [ ] Trademark search (PRV, EUIPO, USPTO; classes 9 and 42) before spending money on promotion.
