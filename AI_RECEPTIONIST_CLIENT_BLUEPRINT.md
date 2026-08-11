# AI Receptionist — Client Blueprint (Standardized Onboarding)

*Last updated: 2026-07-31 · Purpose: every client = clone → fill in the blanks → go live. Onboarding is configuration, not custom development.*

## How to use

One standardized AI Receptionist product. For each new client, copy this blueprint, fill every field, and BCM configures the GHL agent from it (via the Ask-AI-from-a-Google-Maps-link method). Nothing is built from scratch per client. **This is where the scalability comes from.**

Pairs with BCM's GHL "AI Receptionist onboarding" workflow + intake form in Notion. This doc is the master field list; the GHL intake form collects it.

## Pre-launch test (run once per trade / market, before outreach)

A standing gate. Before turning on outreach for a new trade or market, prove the whole verify loop from the LIVE site (same discipline as the Stripe webhook). Run once per trade, not per client:

1. On the live site, tap a listing's "Is this your business? Verify your information" link.
2. Confirm the form lands **pre-filled** with that business's data.
3. Submit a recognizable test entry.
4. Confirm **both**: the follow-up text arrives, and a lead card appears on the sales pipeline at "Verified."
5. Delete the test lead.

Green on all of the above = the live-site button, the pre-fill, and the capture path are proven end to end. Only then flip on outreach.

## The blueprint (fill for every client)

**1. Business information**
- Business name:
- Owner / main contact:
- Business phone (the number the AI answers):
- Service area:
- Website (if any):

**2. Services**
- Services offered:
- What they do NOT do (so the AI never over-promises):

**3. Emergency rules**
- What counts as an emergency (active leak, no water, gas smell, etc.):
- Emergency handling (immediate transfer? priority booking? after-hours callback?):

**4. Business hours**
- Regular hours:
- After-hours behavior (see #9):

**5. Calendar connection**
- Calendar system (Google / other):
- Booking rules (job length, buffer, max per day):

**6. Voice personality**
- Voice (provider + name, e.g., ElevenLabs "Hope"):
- Tone (friendly / professional / warm):
- Greeting line:

**7. FAQs**
- Pricing questions handling:
- Common Q&A the AI can answer (hours, service area, payment, warranty):

**8. Scheduling rules**
- Info to collect before booking (name, phone, address, problem):
- Confirmation method (text / email):

**9. After-hours rules**
- What the AI does after hours (book anyway / take a message / emergency transfer):

**10. Escalation rules**
- When to transfer to a human, and to what number:

**11. Notification recipients**
- Who gets the call summary (owner email / text):

**12. Call summary format**
- What each summary includes (caller name, phone, address, problem, booked slot):

**13. CRM pipeline**
- Pipeline + stage the lead lands in:
- Tags (e.g., `SML-home-services`, `plumber`):

## Go-live checklist

- [ ] Blueprint fully filled
- [ ] GHL agent cloned + configured
- [ ] Phone number assigned + test call passed
- [ ] Calendar connected + test booking
- [ ] Owner notification tested
- [ ] Backup / escalation tested
