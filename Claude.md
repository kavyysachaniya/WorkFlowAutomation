# Role
Senior full-stack engineer, backend architect and UI/UX designer. Execute directly in this
directory. Don't just give snippets. I'm under a strict placement deadline.

# Assessment
Tech Ahir AI Full-Stack Developer placement. 60-minute build, strict.
SELECTED PROJECT: Workflow Automation Engine. No API key is available. Never fake AI.

# Problem (summary)
A workflow = trigger + optional conditions + steps (task | wait | branch | message).
Customers can also describe a workflow in plain English.
Deliverables:
1. Design note (5-6 bullets) for 50,000 concurrent workflows, in the README.
2. Working engine: runs many workflows at once. If stopped and restarted midway, every run
   continues correctly and NO message is sent twice.
Judged on HOW it is built. Working core first, extras after. README must be well documented.

# Working Rules
- Be decisive, fast, brief. Don't ask questions; make sensible decisions and execute.
- pnpm only. Check installed tools first. No global installs. Minimal dependencies.
- Start dev servers early. Don't rewrite working code.
- Don't claim anything is tested unless you actually ran it.
- Every visible control must work. Include loading, empty and error states.

# Stack
- server/: Node 22, zero dependencies, built-in node:sqlite, plain http + SSE.
- web/: React + Vite + Tailwind + lucide-react.
- No auth, Docker, external DB, paid APIs or keys.

# Engine Requirements (build and verify BEFORE any UI)
- Tables: workflows, runs(id, workflow_id, status, step_index, context_json, wake_at,
  lease_owner, lease_expires), step_log(run_id, step_index; UNIQUE together),
  deliveries(run_id, step_index; UNIQUE together, body, created_at).
- Executing a step and advancing the run happen in ONE SQLite transaction. Message steps
  insert into deliveries in that same transaction (this is the exactly-once guarantee).
- Scheduler tick ~250ms: claim due runs (wake_at <= now) with a lease, run steps until a
  wait or end, then release. Many runs concurrently.
- On boot: reclaim expired leases and resume each run from its saved step_index.
- Waits store wake_at timestamps (survive restarts). Demo time multiplier: 1 "day" = a few
  seconds, configurable.
- Branch steps evaluate conditions against the run context. Task steps are simulated work
  and must be labeled as such.
- Parser: POST /api/parse converts plain English to workflow JSON. It is RULE-BASED, not AI.
  Label it as "Rule-based parser (no AI)" in the UI and README. Unparseable input shows a
  clear error. Keep it behind an interface so an LLM can be swapped in later.
- API: create workflow, fire trigger event, list runs, SSE event stream.

# Testing (actually run it and report results)
server/test/crash.test.js: spawn the engine, start 200 runs, SIGKILL mid-flight, restart,
then assert all runs complete AND deliveries has exactly one row per (run, message step).
Also check the main UI journey in the browser if available, and check console errors.

# UI / Design
Premium, minimal, modern. Strong hierarchy, one restrained palette, consistent spacing,
lucide icons (no emoji), subtle transitions, fully responsive.
Avoid: generic AI-dashboard look, heavy gradients, glassmorphism, oversized headings,
decorative filler.
Screens: workflow builder (plain-English box + visual step list), live runs table with
per-run step timeline, deliveries feed, "Kill engine" / "Start engine" demo controls
(a supervisor process restarts it).

# README (required)
Design note (5-6 bullets for 50k concurrent workflows: partitioned scheduler by
hash(run_id), Postgres/queue-backed durable state, timer wheel or delayed queue for waits,
lease-based claiming, idempotency keys end-to-end, backpressure and per-tenant rate limits).
Also: how to run, how the crash guarantee works and how it was tested, and honest limitations
(rule-based parser, simulated tasks and messages, SQLite single-node).

# Timeline
0-5 setup | 5-25 engine + crash test | 25-40 API + UI core | 40-50 polish/responsive |
50-57 test/fix | 57-60 demo-ready

# Model / Effort
Engine and crash test: high effort (xhigh if available). UI polish and fixes: medium.
Raise effort briefly only if stuck on a bug.

# Demo Script (keep working at all times)
1. Create a workflow from plain English. 2. Fire many orders. 3. Kill engine mid-run.
4. Start engine. 5. Show all runs resume and deliveries has no duplicates.