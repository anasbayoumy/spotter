# Spotter V1 Product Contract

## 1. Product outcome

Spotter is a human-supervised coaching operating system. It prepares evidence-backed coaching work,
blocks deterministic safety violations, orders review by risk, and preserves the evidence behind
every decision. It is not an autonomous coach and not a medical product.

The product proves three loops:

1. **Plan:** generate a weekly programme, assess it, let a coach review it, then publish it.
2. **Adjust:** react to a session or check-in with a proposed adjustment that a coach must approve.
3. **Accountability:** detect disengagement deterministically, limit automated contact, and escalate
   ownership toward the coach.

The V1 success question is: can the system reduce repetitive coach attention without hiding risk,
uncertainty, history, or the source data used to make a proposal?

## 2. Actors

### Seeded coach

- There is exactly one seeded coach for V1.
- The server resolves the actor from `DEMO_COACH_ID`; a request may not nominate another coach.
- Every edit, approval, rejection, and override is attributed to this coach.
- The coach can review all seeded synthetic clients.

### Demo client

- Several synthetic clients represent baseline, constrained, disengaged, sparse-history, and
  temporal-expiry scenarios.
- A demo selector changes which client experience is shown; it is not login or impersonation.
- The selected client identifier is validated by the API and never grants access control semantics.
- `c_001` is synthetic in committed data. Real Client 001 data is outside the V1 repository.

### System actors

- The programme, adjustment, and accountability agents only draft structured output.
- Deterministic code selects intent, assembles context, calculates engagement, applies gates, and
  chooses accountability tier.
- Scheduled jobs invoke the same application use cases as interactive commands.
- No model or UI writes directly to the database.

## 3. Included scope

- One seeded coach, several selectable synthetic clients, and no auth flow.
- Coach queue, client detail, programme review, trace inspection, and scorecard screens.
- Expo client selector, Today, session logging, history, check-in, and in-app message surfaces.
- Weekly programme generation with exact context capture and structured model output.
- Deterministic safety gates, independent graded judges, and review-band calculation.
- Coach edit, approve, reject, blocked-plan override with reason, and transactional publication.
- Set/session logging and readiness/free-text check-ins.
- Proposed daily adjustments, with coach approval required for every proposal.
- Deterministic engagement scoring, accountability state, escalation, and 48-hour suppression.
- Recorded deterministic AI mode and PGlite as the mandatory no-key demo.
- Optional live provider mode behind the same gateway when credentials already exist.
- PostgreSQL 16 plus pgvector Docker parity, committed migrations, synthetic seed data.
- Model-call traces, cost/latency/token metadata, prompt hashes, evaluation records, and scorecard.
- Static, unit, integration, safety, web E2E, mobile acceptance, and non-functional verification.

## 4. Explicit non-goals

- Login, signup, sessions, passwords, authorization, roles, and permission administration.
- Organisations, B2B tenancy, row-level security, and multiple-coach assignment.
- Payments, subscriptions, pricing, or entitlements.
- Push, email, SMS, WhatsApp, or other real outbound messaging.
- Wearable synchronization, biomarker interpretation, diagnosis, medication advice, or treatment.
- Automatic adjustment application, including reductions.
- Fine-tuning or automatically learning from coach edits.
- Public deployment, app-store release, or infrastructure provisioning.
- Committing or exposing real client identity, contact, health, or training data.

Schema seams such as stable coach/client IDs are allowed for future evolution, but excluded behavior
must not appear in the V1 UI or add speculative infrastructure.

## 5. Product invariants

### Human control

- Only a published programme is visible to a client.
- Publication always records the seeded coach, approval time, and coach action.
- A normal approval cannot publish a blocked plan.
- A blocked plan may publish only through an explicit override with a non-blank written reason.
- Every adjustment is a proposal until the coach approves it.
- Editing published content creates a new version; history is never overwritten.

### Safety and context

- Context assembly is deterministic code, not an agent.
- Every active hard constraint is pinned before budgeted material and cannot be evicted.
- If pinned hard constraints exceed the budget, generation fails visibly before a model call.
- Temporal and supersession filters run before relevance ranking.
- Expired constraints and superseded notes/programmes cannot influence current generation.
- Unknown movement families fail closed.
- Red-flag input routes to human escalation without invoking a coaching agent.
- Safety failures are binary and blocking; judges cannot cancel or weaken them.

### Auditability

- A context trace is committed before every attempted model call.
- Model output is rejected unless it matches a versioned structured schema.
- Every attempted run records agent, model, prompt hash, trace, usage, latency, output or error.
- Evaluation results and coach actions are append-only evidence.
- User-visible failure messages and logs never expose prompts, secrets, stack traces, or raw PII.

### Accountability

- Engagement inputs and tier calculation are deterministic and stored.
- Higher tiers take precedence when several triggers match.
- Automated messages are limited to one per client per rolling 48 hours.
- Tiers 3 and 4 pause automated contact.
- Automated logic cannot take ownership back from a coach-owned escalation without a coach action.
- Tier 4 creates a churn flag and prohibits further automated contact.

## 6. Seeded no-auth demo

The demo must work with `AI_MODE=recorded`, `DATABASE_MODE=pglite`, no model key, and no Docker. A
clean seed is deterministic: stable actor IDs, stable handles, stable relative scenarios, and
recorded outputs whose schemas match the live path.

The seed must include, without real data:

1. A healthy client with a clear programme.
2. A client with an active hard movement constraint that produces a blocked example.
3. A client with an expired constraint proving the restriction has ceased to apply.
4. A client with a superseded note/programme proving stale information stays excluded.
5. A sparse-history client whose programme states uncertainty rather than inventing facts.
6. A disengaged client exercising the accountability ladder and nudge suppression.
7. A client with session/check-in data sufficient to propose an adjustment.

Repeated seeding must be safe and produce the same logical state instead of duplicate active rows.
The client selector and coach console may expose handles and synthetic labels, but no real identity.

## 7. Accountability decision policy

Tiering uses the highest matching rule:

| Tier | Deterministic trigger | Required result |
|---|---|---|
| 4 | At least 21 full days since the last app activity | Churn flag; human-owned; no automated contact. |
| 3 | At least 7 full days since activity, or adherence below 50% over 14 days with at least two due sessions | Coach-owned outreach task/context brief; automated messages paused. |
| 2 | At least two missed due sessions in 14 days, or current check-in latency at least twice a valid historical baseline | Draft a reduced-plan offer for coach review; do not send it automatically. |
| 1 | Exactly one missed due session in the rolling 7-day window and no higher trigger | Create one contextual in-app nudge if the suppression rule allows. |
| 0 | No trigger above | Do nothing. |

Boundary rules:

- Only sessions already due in the client's IANA timezone count as missed.
- Adherence is completed due sessions divided by planned due sessions; the percentage trigger is not
  used with fewer than two due sessions.
- Latency doubling needs at least two previous completed check-ins; otherwise that signal is absent.
- Missing app history degrades conservatively and does not fabricate a number of silent days.
- Exactly 48 elapsed hours permits another automated message; less than 48 hours suppresses it.
- A Tier 3/4 state remains human-owned even when a later sweep computes a lower tier, until a recorded
  coach action releases ownership.

These rules make underspecified thresholds explicit without delegating risk selection to a model.

## 8. Adjustment trigger policy

V1 permits an adjustment draft after either an explicit coach command or one of these deterministic
signals from newly stored data:

- Readiness is 1 or 2 on the validated 1-to-5 scale.
- A completed session has reported RPE of 9 or 10.
- Completed work is at most 70% of planned working sets, when at least one set was planned.

One event creates at most one active adjustment proposal through an idempotent event key. Red-flag
symptoms bypass adjustment generation and create a coach escalation. Proposals contain enumerated
operations. V1 supports only load reduction, volume reduction, or a documented equivalent movement
swap; increases and unknown operations are rejected. Even supported reductions wait for coach
approval.

