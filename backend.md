# Trex Backend — running today, portable tomorrow

## Production codebase: `backend/` + `web/`

The chosen stack now exists as real code: NestJS API (`backend/`,
Prisma Postgres schema, Better Auth + Resend, Paystack client with
webhook verification, idempotent ledger, server state machine) and the
Next.js scaffold (`web/`, typed API client, home route). Bring-up and
acceptance gates are in `backend/README.md`. It cannot execute on this
Mac yet (no Node/Postgres) — first `typecheck + prisma validate +`
money-path run on a Node 20 machine is the gate before calling it done.

## What runs now: `api.rb`

Zero-install JSON API + static server on Ruby stdlib (the one runtime on
this Mac). Start it with:

```sh
ruby api.rb 8080
```

- App: http://localhost:8080/ (all pages, now API-backed)
- Health: http://localhost:8080/api/health
- Data: `./data/*.json` (offers, trades, disputes, bond, ledger, audit…)

Verified end-to-end: OTP request/verify, offer CRUD + validation, full
trade lifecycle with illegal-transition and missing-proof rejection,
capacity/min/max enforcement, idempotent retries (same key, one effect),
dispute → second-approval-gated resolution, bond top-up/release with
append-only ledger (`reserve → release/refund/forfeit`) and audit trail.

## Live integrations

- **Resend (email OTP): LIVE since 2 Oct 2026** — verified end to end
  (real inbox code accepted by `/api/verify`). `POST /api/otp {email}`
  sends a real code when the server starts with a key:
  `RESEND_API_KEY=re_xxx RESEND_FROM="Trex <hello@yourdomain>" ruby api.rb 8080`.
  Without a key it returns a preview `demo_code`; with a key the code
  lives ONLY in the inbox — never in the response.
- **SMS via Twilio behind Better Auth phone OTP: wired, awaiting keys.**
  `POST /api/otp {phone}` (full E.164 from the 200+ dial-code picker)
  sends a real SMS when started with `TWILIO_SID`, `TWILIO_TOKEN`,
  `TWILIO_FROM`; otherwise preview fallback. Verify always server-side.
- Status: `GET /api/integrations` → `{resend, sms, paystack}`.
- **Paystack:** not connected (`false` above). Next in line.

## Porting to NestJS + Postgres (chosen stack)

Same routes, same rules — re-implement behind them:

- `POST /api/otp`, `POST /api/verify` → Better Auth + Resend sender
- `GET|POST /api/offers` → `offers` table
- `POST /api/trades`, `POST /api/trade_action` → server state machine (§5)
- `POST /api/resolve` → 4-eyes check, compensation from bond
- `POST /api/bond` (`topup|release|switch`) → Paystack DVA/Transfers
- `GET|POST /api/config|ledger|ratings|tickets|audit`

The frontend (`js/api.js` + local fallback) needs no redesign — point it
at the new host. Full entity map: `Docs/phase2-backend.md`,
`Docs/phase3-5-backend.md`, `Docs/phase6-8-backend.md`.
