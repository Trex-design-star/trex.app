# Implementation Plan — P2P Exchange Platform (from PRD v1.3)

Source: `Docs/p2p-exchange-prd.md` (v1.3, 19 Sep 2026)
Model: supervised P2P, Bybit-style. Platform holds **only the vendor bond**. Trade currency moves directly vendor <-> customer.

## Build order

0 Foundation → 1 Onboarding → 2 Bond ledger + provider integration → 3 Offers → 4 Trade engine + chat → 5 Disputes + Admin + Ratings + Notifications + Support → 6 Automation (P1s) → 7 Expansion

Do not start 4 until 2 capacity reservation works. Do not launch until ≥97% dispute-free in beta, median payment-to-complete ≤45min, and legal sign-off on bond custody.

---

## Phase 0 — Foundation

**Goal:** decisions, ledger design, pipeline.
**PRD:** §10, §13, §15.

Outputs (founder-chosen stack, 28 Sep 2026; bond updated 2 Oct 2026: per-trade 50% ONLY — no standing model, no switching):
- Repo monorepo: `app` (Next.js — founder choice for initial web app), `api` (Node.js NestJS modular: onboarding/liveness, bond ledger, offers, trade, chat, disputes, notifications, admin), `admin-web` (Next.js), `infra`.
- Envs dev/staging/prod with separate Paystack credentials (founder choice), secrets vault, CI/CD, migrations, backups, logging, error tracking, feature flags.
- Data baseline: PostgreSQL (ledger + trades — founder choice), Redis (presence + rate-limit), Cloudflare R2 (proofs/attachments — founder choice).
- Auth/OTP: Better Auth only (founder choice, 29 Sep 2026) for sessions + phone/email OTP; email delivery via Resend (founder choice); liveness provider still open (Smile ID vs alternatives to validate).
- Bond ledger spec: append-only `bond_events`, balance = sum(events), idempotency key = ledger event ID, daily reconciliation job design (BND-10, BND-18).
- Resolve open decisions §13: fault table, grace period hours, 72h switch cooldown confirm, chat retention, contact-rule strictness, launch directions, backstop vendor, business vendors, rate caps, provider choice + BND-17 threshold, app name, legal on bond custody.
- Analytics baseline: dispute rate, time-to-complete, forfeiture rate, false-claim rate, repeat rate.

Exit: staging deploy, can create user in staging with audit trail.

## Phase 1 — Onboarding (customers + vendors)

**PRD:** ON-01 to ON-05, SUP-02.

Outputs:
- Sign-up: Better Auth phone + email OTP (email via Resend — founder choice), resend/expiry/rate-limit, enumeration-safe errors.
- No ID path enforced. In-house liveness capture + duplicate-account deterrence.
- Vendor application: choose per-trade (50%) vs standing (25% of limit), choose limit, pay bond (stubbed until Phase 2), optionally link PayPal/bank, auto-assign probation tier.
- Published rules screen: fault outcomes §6.3 shown at sign-up.

Accept: complete phone+email+liveness <5min on low-end and higher-end Android, tier visible, audit logged.

## Phase 2 — Bond ledger + automated funding/release

**PRD:** §6.6, BND-01 to BND-07, BND-09 to BND-18, ADM-06.

Outputs:
- Ledger: used vs available capacity real-time (BND-02), block over-capacity trades (BND-03), separate bond vs fee entries (BND-04), auto-release on Completed (BND-05), auto-refund on pre-payment cancel (BND-06), forfeit + compensate workflow (BND-07), exit withdrawal (BND-09), switch workflow with cooldown + zero-open-trades guard (BND-11).
- Provider integration (Paystack — founder choice): DVA per vendor (BND-13), webhook + poll dual detection (BND-15), Transfers API with idempotency keys (BND-14), retry with backoff → manual queue (BND-16), webhook signature verify, two-person approval over threshold (BND-17), daily ledger vs provider vs bank reconciliation + alerts (BND-18).
- Admin: bond reserve view (total held vs exposure).

Accept: sandbox DVA funding credits ledger, Completed event triggers idempotent payout, webhook confirm required before marking released, failed payout retries then queues, double-trigger cannot double-pay.

## Phase 3 — Offers

**PRD:** OFR-01 to OFR-03 (P0).

Outputs:
- Vendor create/edit/pause offers: pair (USD/GBP/EUR vs NGN), rate, min/max, payment methods.
- Customer browse/filter by currency, rate, tier, rating. Open trade against offer (calls Phase 2 capacity check).
- Server-side validation: min ≤ amount ≤ max, offer live, vendor has capacity.

Accept: offer → trade opens only if capacity passes, otherwise blocked with reason.

## Phase 4 — Trade engine + in-trade chat (core loop)

**PRD:** §5, TRD-01 to TRD-08, CHT-01 to CHT-03, CHT-05, TRU-01, NOT-01/02 (trade events).

Outputs:
- State machine enforced server-side: Offer posted → Opened → Awaiting payment → Payment sent → Payment confirmed → Delivery sent → Completed / Cancelled / Disputed / Resolved. Cancellation only pre-payment. Dispute button only post-payment-sent. Full audit trail per trade.
- Mandatory proof uploads: customer proof-of-payment before vendor confirm; vendor proof-of-delivery before customer confirm. Stored to object storage, linked to trade.
- Configurable windows: vendor confirmation window, auto-release grace period (auto-complete for vendor if no dispute).
- Chat: auto-open per trade, scoped, quick-action buttons, photo/file attachments, hidden from admin unless disputed.
- Trust: manual confirmation with bounded window for all vendors, probation limits.
- Notifications: trade opened, payment sent, confirmation needed/closing, delivery sent, completed, disputed/resolved + escalating reminders.

Accept: <1s trade actions, near-instant chat, works on 3G and full Android range (low-end to higher-end), every state change logged with actor + timestamp.

## Phase 5 — Disputes + Admin + Ratings + Support

**PRD:** DIS-01 to DIS-05, DIS-07/08, ADM-01 to ADM-06, ADM-08, RAT-01/02, TRU-02 to TRU-04, SUP-01.

Outputs:
- Disputes: freeze trade + reserved capacity, admin view (chat + proofs + timeline), actions: compensate from bond / exonerate / partial, two-person approval over threshold, vendor sanctions (rating hit, demotion, suspension), outcome feeds trust records.
- Admin web (network-restricted, RBAC): dispute queue, vendor management (bond/capacity/tier/history/suspend/demote), config (fees, windows, grace, tier thresholds), immutable admin audit log.
- Ratings: mutual post-trade ratings, public vendor profile (completion rate, count, avg response, dispute rate, rating), tier auto-rise/fall/freeze.
- Support: help center + ticketing separate from chat.

Accept: dispute → resolution ≤24h target in beta, forfeiture requires second approval over threshold, all admin actions audited.

## Phase 6 — Automation (Phase 2 P1s)

**PRD:** BND-08, OFR-04/05, CHT-04/06, DIS-06, RAT-03, ADM-07.

Outputs:
- Standing limit increase/decrease self-serve (top-up / partial refund when unused).
- Offer ranking favoring tier/rating, rate guardrails vs market.
- Chat off-platform contact detection + soft-block + notify, configurable retention.
- Customer sanctions for false claims, auto-review on repeated poor ratings.
- Fraud pattern detection: repeat disputes same actor, abnormal pricing, rapid account creation, max-limit new accounts.

## Phase 7 — Expansion (deferred)

Parking lot + §11 Phase 3: more currencies, business vendor accounts, platform backstop liquidity, referrals, UX detail passes, fee/bond tuning from beta data.

---

## FR coverage map

- P0 MVP = Phases 0-5. P1 = Phase 6. P2/later = Phase 7.
- Explicitly out of v1: wallet hold/convert/move, ID KYC, multi-country, backstop vendor (unless §13 decides otherwise).
