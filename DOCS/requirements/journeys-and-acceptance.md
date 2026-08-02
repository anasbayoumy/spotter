# Product Journeys and UI Acceptance

## 1. Plan loop

### Generate

1. The coach or weekly job requests a programme for one active client and target week.
2. The API validates the command and an idempotency key.
3. The application loads temporally current state and deterministically assembles ordered context.
4. The system writes the exact selected records and rendered input as a context trace.
5. The recorded or live programme gateway returns a schema-validated programme with citations.
6. Deterministic gates run before independent judges.
7. Review band is calculated: any gate failure is `blocked`; all required judge scores at least 4 is
   `clear`; all other valid output is `attention`.
8. The proposal and complete evidence are stored and appear in the coach queue.

If any step fails, no client-visible programme is created. A persisted run/trace records model
failures. A repeated command with the same key returns the original outcome.

### Review and publish

1. The queue shows `blocked`, then `attention`, then `clear` groups.
2. Opening a proposal shows programme content, gate findings, judge findings, citations, and a link
   to the exact trace.
3. The coach may edit the proposal. Each edit records a structured before/after diff and reruns
   schema validation and all deterministic gates before approval is enabled.
4. Reject records the reason when supplied, removes the item from actionable review, and exposes
   nothing to the client.
5. Approve publishes a non-blocked plan in one transaction.
6. Override requires a written reason and is the only way to publish a blocked plan.
7. Publication supersedes the previous current programme for that client/week in the same
   transaction and creates sessions from the approved payload without duplicates.
8. The client app then sees the approved sessions. Draft, queued, rejected, and superseded versions
   remain invisible.

Concurrent approval attempts must converge on one published current version. Losing requests return
the already-current state or a lifecycle conflict; they may not create two active programmes.

## 2. Adjust loop

1. The client submits a session log/completion or readiness check-in.
2. The system stores the event before evaluating adjustment triggers.
3. Red-flag input creates a human escalation and stops before any adjustment model call.
4. If a deterministic trigger matches, the system assembles and traces current context.
5. The adjustment agent drafts schema-validated enumerated operations.
6. Safety gates reject increases, unknown operations, unsafe swaps, constraint contradictions, and
   medical language.
7. A valid proposal enters the coach queue; it does not change the published programme.
8. The coach inspects, edits, approves, or rejects it.
9. Approval creates a new programme version, reruns required deterministic gates, attributes the
   action to the seeded coach, publishes transactionally, and supersedes the earlier version.

Repeated event delivery creates no duplicate active adjustment. If the referenced programme has
already been superseded, approval fails with a lifecycle conflict and asks the coach to regenerate
against current context.

## 3. Accountability loop

1. The daily job or demo action starts an idempotent sweep.
2. For every active client, deterministic code calculates adherence, latency signal, app recency,
   score inputs, and the highest matching tier.
3. The system appends the score evidence and transitions accountability state.
4. Tier 0 produces no client message.
5. Tier 1 drafts a contextual message tied to a specific missed session and client goal. It is sent
   to the in-app outbox only if no automated message was sent in the preceding 48 hours.
6. Tier 2 creates a reduced-plan offer for coach approval; it is not auto-sent or auto-applied.
7. Tier 3 assigns coach ownership, creates a context brief, and pauses automated messaging.
8. Tier 4 creates a churn flag and prohibits further automated contact.
9. A retry returns/reuses the same run and does not duplicate scores, states, messages, or tasks.

Suppressed messages remain auditable with the reason and attempted time. A model may draft wording,
but it cannot choose the tier, recipient, ownership, or suppression result.

## 4. Coach frontend acceptance

### Global behavior

- `/` redirects to `/queue`; there is no login page.
- The layout clearly identifies demo mode and uses synthetic handles.
- Navigation reaches Queue, a client, a programme, its trace, and Scorecard without dead ends.
- Loading, empty, validation, conflict, offline/server-error, and retry states are visible and do
  not discard unsaved coach edits.
- Keyboard navigation, visible focus, semantic headings, accessible names, and meaningful status
  announcements work at supported desktop and narrow widths.
- Destructive-looking actions require clear confirmation where recovery is not immediate. Reject and
  override state their effect before submission.

### Queue `/queue`

- Three visibly distinct groups appear in priority order: blocked, attention, clear.
- Counts match actionable programmes and adjustments returned by the API.
- Blocked and attention items show the specific finding, not only a color.
- Clear may begin collapsed but every item remains individually inspectable.
- Stable ordering prevents items moving unpredictably during a refresh: band, then oldest queued
  first, then stable ID.
- An empty queue explains that there is nothing to review and offers a route to clients.

### Client detail `/clients/[clientId]`

- Shows goals, equipment/schedule profile, active constraints with validity, current programme,
  recent due/completed sessions, adherence, check-ins, and in-app messages.
- Expired constraints are excluded from the active summary and may be shown only in clearly labelled
  history.
- Missing optional data appears as unknown/empty, never as invented coaching information.
- Generate-programme and accountability actions show idempotent progress and final outcome.

### Programme review `/programmes/[programmeId]`

- Shows lifecycle state, review band, programme days/exercises, all gate outcomes, judge scores and
  rationales, citations, generator/prompt metadata, and trace navigation.
- Edits are schema constrained and preserve the unsaved form after a recoverable API failure.
- Approve is disabled for blocked output; override is available only with a non-blank reason.
- Reject cannot later be approved without a new proposal/version.
- Successful publication is obvious and repeated submission cannot duplicate publication.

### Trace `/traces/[traceId]`

- Shows intent, client handle, creation time, budget, token estimate, ordered selected sections, and
  exact rendered model input.
- Active hard constraints are identifiable as pinned.
- It does not show real names, contact information, provider secrets, or hidden chain-of-thought.
- Failed model calls still have a trace page when assembly succeeded.

### Scorecard `/scorecard`

- Shows safety results by gate, judge score distributions, calibration results, review-band
  accuracy, cost per published plan, and p50/p95 latency where data exists.
- Empty/no-live-data metrics are labelled unavailable rather than displayed as zero.
- Recorded and live modes are distinguished so deterministic fixtures are not presented as live
  production evidence.

## 5. Client frontend acceptance

### Selector

- The selector lists only seeded synthetic active clients.
- Selection persists locally for demo convenience but is not represented as authenticated identity.
- A deleted, paused, or unknown selection returns to the selector safely.

### Today

- Displays sessions only from the client's current published programme.
- Shows today's session in the client's timezone and the next relevant session when none is due.
- Displays at most the currently outstanding in-app message, honoring paused/churned contact state.
- Never renders draft, queued, rejected, or superseded programme content, even if an ID is guessed.
- Loading, no programme, rest day, already completed, and API failure states are distinct.

### Session logging

- Shows the approved planned exercises and accepts structured sets, reps, load, notes, and RPE.
- Numeric ranges and required fields are validated before submission and again on the server.
- Retrying the same log/completion does not duplicate actual work or completion events.
- A completed session clearly reports success and appears in History.
- If the programme/session became stale, the app preserves local input and explains the conflict.

### History

- Shows recent completed and missed due sessions in deterministic date order.
- Future sessions are not labelled missed.
- Superseded programme history may be labelled, but it cannot become the current Today source.
- Empty history has an informative state.

### Check-in

- Accepts readiness from 1 to 5 and bounded free text.
- A repeat submission with the same idempotency key returns the same check-in.
- Success explains that the coach may review the response; it does not promise an automatic change.
- Red-flag text never produces diagnosis or self-care advice and is routed for human review.

## 6. Cross-surface consistency

- A newly published programme becomes the sole current source for coach detail and client Today.
- A client log/check-in is visible to the coach and appears in the next trace context.
- A proposed adjustment is coach-visible but client-invisible until approved and published.
- Accountability messages shown to the client match outbox/audit state shown to the coach.
- All dates are stored as UTC instants and rendered relative to the client's IANA timezone where the
  product meaning is local date/day.
- Every error response includes a request ID that the UI can display for diagnosis.
