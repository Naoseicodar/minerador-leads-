# Ireland Trades Lead Miner — Design Spec
**Date:** 2026-03-16
**Status:** Approved

## Overview

Expand the existing minerador-leads system to target trade businesses (plumbers, electricians, painters, carpenters, builders) in Ireland that have no website. Outreach via cold email (primary) and Facebook Messenger DM (secondary). Offer: professional website + Google My Business setup for €400–500, delivered in 48 hours.

## Target

- **Region:** Ireland (Dublin, Cork, Galway, Limerick, Waterford, Kilkenny, Drogheda)
- **Niche:** Trades — plumber, electrician, painter, carpenter, builder
- **Filter:** Leads with NO website only
- **Language:** English (scraper locale must be `en-IE`, timezone `Europe/Dublin`)
- **Persona:** "Luan" — same persona as Brazil operation, presents as a web specialist

## Google Sheets Structure

New dedicated spreadsheet: `Leads-Ireland`

| Col | Field | Notes |
|-----|-------|-------|
| A | Status | Dropdown: Not Contacted / In Contact / Proposal Sent / Converted ✓ / Not Interested / No Response |
| B | Business Name | |
| C | Phone | +353 format |
| D | Email | Primary contact channel |
| E | Facebook | Facebook page URL or handle |
| F | Website | Must be EMPTY (filter) |
| G | Address | |
| H | City | Dublin, Cork, Galway, etc. (replaces Bairro) |
| I | Rating | Google Maps rating |
| J | Review Count | |
| K | Maps Link | |
| L | Date | |
| M | Notes | Contact log — `"Email Sent ✓"` or `"FB Sent ✓"` |

**Phase 1 (current):** Separate spreadsheet (validation)
**Phase 2 (after validation):** Migrate as `Leads-Ireland` tab in main Brazil spreadsheet

## Scraper Changes (`minerar-ireland.js`)

The Ireland scraper is a **separate script** copied from `minerar.js` with the following explicit changes:

### Environment variables
```
SHEET_ID_IRELAND=<new google sheet id>
SHEET_ABA_IRELAND=Leads-Ireland
TERMO_IRELAND=plumber     # run once per trade keyword
LIMITE_DIARIO=80
```

### Code changes required in `minerar-ireland.js`
1. **Locale/language:** Replace `--lang=pt-BR`, `locale: "pt-BR"`, `timezoneId: "America/Sao_Paulo"`, `?hl=pt-BR` with `--lang=en-IE`, `locale: "en-IE"`, `timezoneId: "Europe/Dublin"`, `?hl=en`
2. **City list:** Replace `CIDADES_PARANA` with Ireland cities:
   - Dublin (Dublin 1, Dublin 2, Dublin 4, Dublin 6, Dublin 8, Tallaght, Blanchardstown, Swords)
   - Cork (Cork City, Ballincollig, Bishopstown)
   - Galway (Galway City, Salthill, Tuam)
   - Limerick (Limerick City, Castletroy)
   - Waterford (Waterford City)
3. **Query format:** Change from `"${termo} em ${bairro} ${cidade}"` to `"${termo} in ${area} ${city} Ireland"`
4. **Column E:** Extract Facebook page URL from Maps profile instead of Instagram handle
5. **Column H:** Change `bairro` field to `city` in `formatarLinha()` — write city name only
6. **Status dropdown:** Change values to English: `Not Contacted`, `In Contact`, `Proposal Sent`, `Converted ✓`, `Not Interested`, `No Response`
7. **Cookie banner:** Change `button:has-text("Aceitar tudo")` to `button:has-text("Accept all")`
8. **Sheet tab name:** Hardcode `"Leads-Ireland"` or read from `process.env.SHEET_ABA_IRELAND`

### Filter (no change needed)
The `processarLink()` function already filters leads with no website — no modification required.

## Email Outreach (`email-sender.js` — new module)

### Gmail authentication
Use **Gmail App Password** (simpler than OAuth2 for Phase 1):
1. Enable 2FA on the Gmail account
2. Generate App Password at myaccount.google.com → Security → App Passwords
3. Store in `.env`: `GMAIL_USER=yourname@gmail.com` and `GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx`
4. Nodemailer transport: `{ service: "gmail", auth: { user, pass } }`
5. Add dependency: `npm install nodemailer`

### Daily limit
- **50 emails/day** — tracked via local counter file (`email-count-YYYY-MM-DD.json`) reset daily
- **Delays:** Randomized 60–180 seconds between sends

### Placeholder resolution
- `[Name]` = business name from column B (Google Maps does not expose owner names)

### Copy (AIDA framework)

**Subject:** `Your business isn't showing up on Google, [Business Name]`

> Hi [Business Name],
>
> I help tradespeople in Ireland get found on Google with a professional website + Google My Business setup.
>
> Most of my clients start getting calls within the first week. I handle everything in 48 hours for a flat fee of €400.
>
> Would that be useful for your business?
>
> — Luan
>
> P.S. To opt out of future emails, just reply "unsubscribe".

- Marks lead with `Email Sent ✓` in column M after send

## Facebook Messenger Outreach (`facebook-sender.js` — new module)

### Approach
Use Playwright to log into a Facebook account and send Messenger DMs to business pages found in column E. Follows the same human-behavior pattern as `claudio-insta.js` (random delays, cursor movement, typing per character).

### Authentication
- Facebook session saved to `facebook-session.json` after first login
- Credentials stored in `.env`: `FB_EMAIL` and `FB_PASSWORD`

### Daily limit
- **20 messages/day** (conservative to avoid Facebook detection)
- **Delays:** Randomized 45–120 seconds between sends

### Copy (AIDA framework)

> Hi [Business Name], I help tradespeople in Ireland get a professional website + Google My Business so customers find them online. I do it in 48 hours for €400. Would that interest you? — Luan

- Marks lead with `FB Sent ✓` in column M after send
- Does NOT skip leads already contacted by email — multi-channel exposure is intentional

### Status filter fix
The `facebook-sender.js` must filter out leads with status `Not Interested` or `Converted ✓` (English values — different from Brazil's Portuguese values in claudio-insta.js).

## Dependencies

| Package | Purpose | Already installed |
|---------|---------|-------------------|
| playwright | Scraping + Facebook automation | Yes |
| googleapis | Google Sheets API | Yes |
| nodemailer | Email sending | **No — run `npm install nodemailer`** |

## Rollout Phases

1. **Phase 1 — Validate:** Separate spreadsheet. Scrape Ireland trades, send emails + Facebook DMs, monitor response rate
2. **Phase 2 — Consolidate:** Once validated, add as tab in main Brazil spreadsheet

## Success Criteria

- Scraper finds 30+ Ireland trade leads per city run without website
- Email module sends up to 50/day without Gmail blocks
- At least 1 response per 50 contacts (2% response rate baseline)
