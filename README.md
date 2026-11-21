# Tech Ahir · Workflow Automation Engine

A durable workflow engine: **trigger → optional conditions → steps** (`task | wait | branch | message`).
Runs survive hard crashes (SIGKILL) and resume from their last committed step. Message deliveries are exactly-once at the database level: no duplicates across crashes, and none with two engine processes sharing the database.

```
server/   Node 22, zero dependencies (node:sqlite, node:http, SSE)
  src/engine.js        scheduler, leases, step execution (the core)
  src/parser.js        rule-based plain-English → workflow JSON (regex, no AI)
  src/parsers.js       parser interface (swap in an LLM parser via PARSER=<id>)
  src/server.js        engine process: HTTP API + SSE + scheduler
  src/supervisor.js    public port :8787, spawns/kills the engine, proxies /api
  test/crash.test.js         200 runs, 3× SIGKILL + restart
  test/multi-engine.test.js  2 engines on one DB, 200 runs, then takeover after a kill
web/      React + Vite + Tailwind v4 + lucide-react
scripts/dev.mjs  one-command dev launcher (no extra deps)
```

## Run it (fresh clone)

Requirements: **Node ≥ 22.13** (for the built-in `node:sqlite`; developed on 22.22.3) and **pnpm ≥ 9** (developed on 10.33.0; `corepack enable` will provide it).

```bash
git clone https://github.com/kavyysachaniya/WorkFlowAutomation.git
cd WorkFlowAutomation
pnpm install          # only web/ has dependencies; the server has none
pnpm dev              # supervisor :8787 (+ engine :8788) and Vite :5173
# open http://localhost:5173

pnpm test             # crash test + multi-engine test (about 10s)
pnpm build            # production build of the web UI
```

The database is created at `server/data/engine.db` on first start. Delete that folder to reset.
Useful env vars: `DAY_MS` (demo speed, default 3000 = 1 simulated day is 3s), `LEASE_MS` (3000), `MAX_CONCURRENCY` (64), `AUTO_RESTART=1` (supervisor restarts a killed engine automatically).

## Demo script

1. Click **Load demo**. It sends *"When a new order arrives, if it is over $500, wait one day, then send a follow-up message"* through `/api/parse` and saves the result as `branch(total > 500) → wait 1 day → message`. Or click the sentence or the **High-value order** example to put it in the builder, then **Parse** → review/edit steps → **Save workflow**.
2. Click **Fire 20 orders**: 11 orders over $500 wait a (demo) day, and 9 skip the branch and complete.
3. Click **Kill engine** while runs are waiting. The engine process is SIGKILLed; runs freeze in SQLite.
4. Click **Start engine**. It reclaims expired leases and every run resumes from its saved `step_index`.
5. All 20 runs complete, with exactly 11 follow-ups in **Deliveries** and no duplicates. Expand any run to see its step timeline, including steps skipped by the branch.

## API (via the supervisor on :8787)

| Method | Path | |
|---|---|---|
| POST | `/api/parse` | `{text, name?}` → `{workflow}` or `422 {errors:[{clause, reason}]}`; response says which parser ran (`ai: false`) |
| GET/POST | `/api/workflows` | list / create (validated; `422` with a list of errors) |
| DELETE | `/api/workflows/:id` | archive |
| POST | `/api/events` | `{event, payload, event_id?}` fires a trigger; `event_id` is an idempotency key per workflow |
| GET | `/api/runs`, `/api/runs/:id` | runs; detail includes step_log + deliveries |
| GET | `/api/deliveries`, `/api/stats` | |
| GET/PUT | `/api/config` | `{day_ms}` demo speed |
| GET | `/api/stream` | SSE: `run.created`, `step`, `delivery`, `run.completed`, `engine.boot`… |
| GET/POST | `/sup/status`, `/sup/kill`, `/sup/start` | demo controls (`kill` = SIGKILL; returns after the process has exited) |

## How the crash guarantee works

- **State lives only in SQLite** (WAL mode). Process memory holds nothing that a restart can't rebuild.
- **One step = one transaction.** `BEGIN IMMEDIATE` → re-check the lease (`lease_owner = me`) and `step_index` → insert `step_log(run_id, step_index)` → for message steps, insert `deliveries(run_id, step_index)` → advance `runs.step_index` / status / `wake_at` → `COMMIT`.
  - A crash before COMMIT rolls everything back, and the step runs again on resume.
  - A crash after COMMIT means the step is done and never repeats.
  - There's never a delivery without the run advancing, or the reverse.
- **Belt and braces:** `UNIQUE(run_id, step_index)` on both `step_log` and `deliveries`. A duplicate would be a constraint error, not a silent double send.
- **Scheduler:** a 250ms tick claims due runs with one atomic `UPDATE … WHERE (lease_owner IS NULL OR lease_expires < now) … RETURNING id`. It executes steps until a `wait` or the end, extending the lease on every commit and releasing it in the final one.
- **Waits** commit `status='waiting'`, `wake_at = now + amount × day_ms`, and release the lease. Nothing sleeps in memory, so waits survive restarts.
- **Boot:** clears expired leases and resumes every `pending`/`waiting` run from its saved `step_index`. Leases held by a killed process expire after `LEASE_MS`, and those runs are then re-claimed by whichever engine is alive.
- **Several engines** can share the database. The claim is a single atomic statement, so two engines can't both claim a run. Each commit re-checks ownership, so an engine that lost its lease can't advance the run. Lock contention (`SQLITE_BUSY`) is treated as retryable, never as a failed run.

### How it was tested (all of these were run; results below are from this machine)

Windows 11, Node 22.22.3. `pnpm test` runs both suites against real engine processes on temp databases.

**`crash.test.js`.** Creates an 8-step workflow (task, email, wait, task, branch `plan = pro`, slack for pro only, wait, sms) and fires 200 events, half pro and half free, each with an `event_id`. Re-firing one must not create a run. It then **SIGKILLs the engine 3 times** at different points and restarts it each time. Every run must complete, with the exact expected delivery steps (pro 1, 5, 7; free 1, 7), each delivered **once**. The exact expected `step_log`, released leases, and total deliveries = 500 are also checked.

```
kill #1: {"runs":{"pending":138,"waiting":62},"deliveries":63}
kill #2: {"runs":{"pending":18,"waiting":182},"deliveries":183}
kill #3: {"runs":{"pending":9,"waiting":191},"deliveries":263}
final:   {"runs":{"completed":200},"deliveries":500}
verified 200 runs, 500 deliveries (expected 500), 0 duplicates
```

**`multi-engine.test.js`.** Two engine processes on **one SQLite file**, with events fired at both alternately: 200 runs, the same per-run exactly-once assertions, and a check that both engines did real work. Phase 2 fires 200 more runs, SIGKILLs engine A mid-flight, and checks that engine B finishes A's leased runs once the lease expires, still exactly once.

```
steps executed per engine: [{"engine":"engine-19420-…","n":744},{"engine":"engine-24140-…","n":756}]
verified 200 runs, 500 deliveries (expected 500), 0 duplicates
takeover verified: 500 deliveries (expected 500), 0 duplicates
```

The full suite passed in 4 of 4 consecutive runs.

**UI click-through.** I wrote a temporary Playwright script, driving installed Edge via `playwright-core` and kept outside the repo. It went 22/22 from an empty database:
- empty states, and a parse error being shown;
- parse → edit a step → add/move/delete steps → rename → save, with the edit persisted in the API;
- Load demo → Fire 20 orders → Kill engine (controls disabled while down) → Start engine → all runs complete with 11 follow-ups and 0 duplicates;
- expanding run timelines (including branch-skipped steps), run filters, firing from a workflow card, changing speed, archiving, and Build manually;
- at **390px** width: no horizontal overflow, header controls on screen, timeline expands;
- no unexpected console errors or HTTP errors.

## Design note: scaling to 50,000 concurrent workflows

- **Partitioned scheduler:** shard runs by `hash(run_id) % P`, with each scheduler node owning a set of partitions (assigned via DB leases or a coordinator). Throughput scales horizontally, and no two nodes scan the same rows.
- **Durable state in Postgres (or a log + queue):** the same "step + advance + outbox insert in one transaction" pattern carries over directly. Claim with `SELECT … FOR UPDATE SKIP LOCKED` per partition, or put runnable work on a durable queue (Kafka/SQS) and keep run state in Postgres.
- **Timer wheel / delayed queue for waits:** don't poll 50k `wake_at` rows. Use a hierarchical timer wheel per partition for near-term wakeups and a delayed queue (SQS delay, Redis ZSET, or a partitioned `wake_at` index scanned per time bucket) for long waits.
- **Lease-based claiming with fencing:** short leases with heartbeats, plus a fencing token checked on every commit, so a paused or partitioned worker can never advance a run after losing its lease. Here, the `lease_owner` + `step_index` re-check does this job.
- **Idempotency keys end to end:** `event_id` on ingest (implemented), and `(run_id, step_index)` as both the outbox key and the provider idempotency key for email, SMS and webhooks. That makes the outbox relay's at-least-once sending effectively exactly-once at the provider.
- **Backpressure and per-tenant rate limits:** bounded in-flight work per node, and token buckets per tenant and per channel. Ingest returns `429` or queues when partitions lag, so one noisy tenant can't starve the rest.

## Honest limitations

- **Rule-based parser (no AI).** It uses regex with a fixed vocabulary: known triggers or explicit `foo.bar` event names; `wait`/`after`; `send`/`email`/`text`/`notify`; `if …`; task verbs. Anything else is a visible error, never a guess. An `if` guards the rest of its sentence ("If X." on its own guards the next step). There are no else-paths or loops. The parser sits behind `parsers.js`, so an LLM parser can be added; its output would still go through the same validation.
- **Tasks and messages are simulated.** Exactly-once holds up to the `deliveries` table (an outbox); nothing is actually sent. A real sender needs an at-least-once relay keyed by `(run_id, step_index)`. A task's simulated work happens before its transaction, so if the engine dies mid-task the *work* runs again, though its recorded effect still happens once. Real side-effecting tasks would need idempotency keys.
- **SQLite, single node.** Multiple engine processes on one machine are tested, but SQLite serializes writers, so this doesn't scale out (see the design note). `synchronous=NORMAL` in WAL mode survives process crashes, which is what's tested. An OS crash or power loss can lose the last few transactions; they roll back atomically, so that still never creates duplicates.
- After a kill, runs resume within one lease period (3s) of the engine coming back. Auto-restart is off by default so the demo shows the stall.
- Changing demo speed affects new waits only, not ones already scheduled.
- SSE events aren't persisted. The UI reconnects and also polls every 4s.
- **`pnpm dev` shutdown:** Ctrl+C kills the whole process tree on Windows (`taskkill /T`). That path wasn't exercised automatically: I couldn't send a real Ctrl+C from the test harness.
- No auth, no multi-tenancy. `node:sqlite` is still experimental in Node 22 (its warning is hidden in `pnpm dev`).
