# WRKOUT

A private, phone-first training app. You pick a race, describe your week and how fast you are, and Claude builds a periodised plan up to race day. Every session you record on your Garmin is logged and analysed automatically, the plan adapts, and you get push notifications.

- **Plans** — macro plan (base → build → peak → taper) for every week to race day, with full structured workouts written about two weeks ahead so they fit how training is actually going.
- **Paces and zones** — Daniels VDOT paces from your race times (or zone 2 pace), Friel heart-rate zones, Coggan power zones.
- **Automatic analysis** — new Garmin activities are pulled every 15 minutes, matched to the plan, scored for compliance and analysed by Claude. Small adjustments to the next days are applied automatically; bigger ones wait for your OK.
- **Weekly review** every Sunday evening, which can also propose updated paces/zones.
- **Treadmill runs** — switch a run session to *Treadmill* and its targets show as belt speed (km/h). A treadmill run's watch distance is treated as a guess (load from heart rate, pace not scored) until you enter what the treadmill showed, in total or lap by lap with incline; incline counts towards load.
- **Live treadmill sessions** — start a planned run (or an unplanned one) on the treadmill in the app. The live screen counts down each step and sets the speed it plans; you nudge speed and incline when you run faster or slower. When the watch's run syncs, its distance, laps (one per step, with the watch's heart rate) and incline come from the session; a session not recorded on the watch becomes an activity of its own.
- **Coach chat** — tell it about soreness, travel or a bad night and it adapts the plan.
- **App feedback** — the lightbulb in the top corner of every page saves a note about the app, with the page it was written on, for reading back while developing.
- **Strava through Claude** — the coach can look up your Strava history through Strava's official MCP server.

## How it fits together

```
Phone (PWA + Web Push) ─► Next.js on Vercel (wrkout.hermanostengen.com)
                              ├─ Supabase Postgres (schema "wrkout") + pg_cron → /api/cron/tick every 15 min
                              ├─ Garmin Connect Personal API (activities, FIT files, sleep, HRV)
                              ├─ Claude API (claude-opus-5-5) + MCP connector → mcp.strava.com
                              └─ Strava webhook (optional trigger only)
```

| Path | What lives there |
| --- | --- |
| `src/lib/training/` | Pure training science: VDOT, zones, load (TSS/CTL/ATL/ACWR), matching, compliance, guardrails, change scoping. Unit-tested. |
| `src/lib/ai/` | Coach prompt, context builder, plan generation, activity analysis, weekly review, coach replies. |
| `src/lib/garmin/` | Personal API client, activity mapping, FIT parsing. |
| `src/lib/strava/` | OAuth (dynamic client registration + PKCE) for Strava's MCP server. |
| `src/lib/jobs.ts`, `src/lib/tick.ts` | Durable job queue and the 15-minute scheduler. |
| `src/app/` | Pages (Today, Plan, Workout, Activities, Coach, Settings, Onboarding) and API routes. |

### Why it's built this way

- **Garmin is the data source.** Garmin's Personal API (opened October 2026) is free and official, but read-only and pull-only — hence polling, and no pushing workouts to the watch (yet).
- **Strava data only reaches the AI through Strava's MCP server.** Strava's API policy (June 2026) bans feeding Strava API data to AI apps; its MCP connector is the sanctioned route. The webhook is only used as a "something new happened" trigger.
- **Guardrails in code, judgement in Claude.** Ramp rate, deload frequency, taper, quality-session caps and hard-day spacing are checked in code; failing plans are sent back to Claude once for a fix.
- **Each long AI step runs in its own function invocation** (job queue), so nothing hits Vercel's 300-second limit.

## Setup

You need: a GitHub repo (this one), and free Vercel and Supabase accounts. You also need a Claude API key (pay-as-you-go), a Garmin Connect account, and, for the Strava features, a Strava subscription.

1. **Supabase.** Create a project (Stockholm region is closest). From *Connect* copy:
   - the **transaction pooler** URI (port 6543), as `DATABASE_URL`
   - the **session pooler** URI (port 5432), as `DIRECT_DATABASE_URL`
2. **Secrets.** Run:
   ```bash
   npm install
   ```
   ```bash
   npm run setup:secrets -- "choose-a-good-password"
   ```
   Copy the output plus the values below into `.env.local` (see `.env.example`).
3. **Claude API key.** Get it at console.anthropic.com → API keys and set it as `ANTHROPIC_API_KEY`. Set a monthly spend limit, e.g. $15. To go through a gateway instead, see *Using a Claude gateway* below.
4. **Garmin key.** In Garmin Connect on the web, go to Settings → Personal API and create a key valid for 1 year. Set `GARMIN_API_KEY`, and set `GARMIN_API_KEY_EXPIRES` to its expiry date (you'll get a reminder 14 days before).
5. **Create the tables:**
   ```bash
   npm run db:migrate
   ```
6. **Vercel.**
   - Import the repo.
   - Add every variable from `.env.local`, with `APP_URL=https://wrkout.hermanostengen.com`. Leave out `DATABASE_POOL_MAX`.
   - Deploy.
   - In Project → Domains, add `wrkout.hermanostengen.com` and create the CNAME record it shows (usually `wrkout` → `cname.vercel-dns.com`) at your DNS provider.
7. **Scheduler.** In Supabase → SQL Editor, run `docs/supabase-cron.sql` after putting in your `CRON_SECRET`.
8. **Phone.**
   - Open the site in Safari, then Share → *Add to Home Screen*.
   - Open WRKOUT from the home screen and sign in.
   - In Settings, choose *Turn on notifications*, then *Send a test*.
9. **Strava (optional, experimental).** In Settings → *Connect Strava*, approve access on Strava. To confirm Claude can reach it, run:
   ```bash
   npm run check:claude -- --strava
   ```
   Run it locally with the production env.

   If Strava refuses the connection, everything else keeps working on Garmin data alone.
10. **Strava webhook (optional).** This catches sessions recorded in the Strava app rather than on the watch.
    - Create an API app at strava.com/settings/api.
    - Register the webhook:
      ```bash
      curl -X POST https://www.strava.com/api/v3/push_subscriptions -F client_id=ID -F client_secret=SECRET -F callback_url=https://wrkout.hermanostengen.com/api/strava/webhook -F verify_token=$STRAVA_WEBHOOK_VERIFY_TOKEN
      ```
    - Set `STRAVA_SUBSCRIPTION_ID` (from the response) and `STRAVA_ATHLETE_ID` (from your Strava profile URL).

Then open the app and choose a goal. Building the plan takes a few minutes, and you'll get a notification when it's ready.

### Checking the integrations

```bash
npm run spike:garmin
```
```bash
npm run try:plan -- 2027-04-25 21097
```

- `spike:garmin` covers the token exchange, recent activities, FIT parsing, and the sleep/HRV fields.
- `try:plan` generates a real plan into the configured database and prints the outline, the checks and the cost. It costs roughly $0.50–1.

### Using a Claude gateway

The Anthropic SDK reads `ANTHROPIC_BASE_URL` plus `ANTHROPIC_API_KEY` (or `ANTHROPIC_AUTH_TOKEN`), so a gateway such as Netlight's LiteLLM proxy needs no code changes:

```
ANTHROPIC_BASE_URL=https://llm.netlight.ai
ANTHROPIC_API_KEY=sk-...
```

Run this to see what the endpoint supports:

```bash
npm run check:claude
```

It sends a few tiny requests and reports:
- the Claude model names the endpoint offers
- whether structured output works (required)
- whether refusal fallbacks and top-level prompt caching work (optional)

Optional features the endpoint rejects are switched off automatically at runtime. If the model name differs, set `COACH_MODEL`.

Notes:
- **Data routing.** Garmin health data and Strava history are sent to the model. A key in the gateway's `safe-eu-models` group keeps that traffic EU-hosted; `unsafe-all-models` may route it outside the EU.
- **Strava MCP.** The MCP connector needs Anthropic's own API behind the gateway. If the gateway routes Claude through Bedrock or Vertex, the coach runs on Garmin data only.
- **Inherited variables.** A variable already set in your shell overrides `.env.local`. Terminals started from the Claude desktop app inherit its own `ANTHROPIC_BASE_URL`, so run local commands from a regular terminal.
- **Switching later.** To move to a private Claude API key, remove `ANTHROPIC_BASE_URL` and set your own `ANTHROPIC_API_KEY`.

## Reading app feedback

```bash
npm run feedback
```

Prints the open notes from the lightbulb button, read from the database in `.env.local` (production, usually).
- `-- --all` includes notes already marked done; `-- --json` prints JSON.
- `-- --done <id> …` marks notes done; `-- --done` alone marks every open note done.

## Local development

```bash
npm run db:local
```
```bash
npm run db:migrate
```
```bash
npm run seed:demo
```
```bash
npm run dev
```

1. `db:local` starts an embedded Postgres (PGlite) on port 54322. For it, set `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres` and `DATABASE_POOL_MAX=1`. All connections share one PGlite session, so a process killed mid-transaction can leave work uncommitted. If local data looks wrong, restart `db:local`.
2. `db:migrate` creates the tables. Run it in another terminal.
3. `seed:demo` (optional) fills the database with a demo plan, activities and a proposal.
4. `dev` starts the app.

Other commands:
- `npm test`: unit tests for the training core
- `npm run typecheck`
- `npm run lint`
- `npm run build`

## Running costs

| | Cost |
| --- | --- |
| Vercel Hobby, Supabase free, Garmin Personal API, Web Push | $0 |
| Claude Opus 5.5 | about $3–8/month: ~$0.05–0.15 per analysis, ~$0.30 per weekly review, ~$0.50–1 per full plan |
| Strava subscription | needed for the MCP connector only |

Current spend is shown in Settings. To use a cheaper model, set `COACH_MODEL=claude-sonnet-5-5`.

## Limits and follow-ups

- Workouts aren't pushed to the watch: the Garmin Personal API is read-only. Options are Garmin's Starter tier (Training API, meant for organisations) or exporting .FIT workouts.
- The Garmin key must be renewed at least yearly.
- Swimming and triathlon are modelled in the data (sport `swim`, workout type `brick`) but not yet planned for.
- Supabase pauses free projects after a week without activity. The 15-minute scheduler keeps it awake.
