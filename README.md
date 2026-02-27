# SMU Investment Game

A minimal multiplayer investment experiment where 2‑4 players join a room, allocate $100 between two assets, and wait for simultaneous settlement.

- **Asset A** pays 1:1 back to the player who invests it.
- **Asset B** contributions are pooled, multiplied by **1.5**, and distributed equally across all players in the room.
- Results appear only after every player submits their allocation. Live updates flow via Server-Sent Events (SSE), so lobbies stay synchronized without page refreshes.

## Features at a glance

- Room-based play with enforced capacity (2‑4 seats) and unique join codes.
- Integer-only allocation controls with live validation (`A + B` must equal 100).
- One-shot settlement: results are computed and stored once, then broadcast via SSE.
- Allocation and payout breakdown per player, including total and boosted pools.
- Leave/rejoin safeguards (room status reverts to “waiting” if a player exits before completion); local storage restores sessions after refresh.

## Design rationale

- **Simultaneous decisions**: allocations stay private until every slot submits, so players experience the intended public-goods dilemma instead of reacting to partial information.
- **Results framing**: the summary shows pooled capital, the 1.5× boost, and per-player payouts together so cooperative vs. free-rider outcomes are easy to spot.
- **Lifecycle guardrails**: rooms flow `waiting → ready → completed`, preventing duplicate settlement and preserving the integrity of each round.
- **Context cues**: “You” badges, status pills, and allocation recaps keep players oriented without exposing others’ choices prematurely.

## Screenshots

| Lobby                    | Allocation                         | Results                      |
| ------------------------ | ---------------------------------- | ---------------------------- |
| ![Lobby](docs/lobby.png) | ![Allocation](docs/allocation.png) | ![Results](docs/results.png) |

## Tech stack

- **Frontend**: React 18 + Vite + TypeScript, EventSource for realtime updates.
- **Backend**: FastAPI, SQLAlchemy, Pydantic v2, PostgreSQL (Neon) with psycopg3.
- **Realtime**: In-memory SSE broker (simple queue per room). Can be swapped for Redis pub/sub if horizontally scaled.
- **Tests**: Pytest coverage for payout math.

## Project layout

```
backend/
  app/
    api/routers      # FastAPI routers (REST + SSE)
    core             # lightweight settings
    db               # SQLAlchemy base + session helpers
    models           # Room and Player models
    schemas          # Pydantic schemas shared with API
    services         # Game logic + SSE broker
    main.py          # FastAPI entrypoint
  tests/             # pytest unit tests for payout logic
frontend/
  src/               # React + Vite + TypeScript client
```

## Backend

### Requirements

- Python 3.11+
- PostgreSQL (Neon recommended) reachable via `DATABASE_URL` (falls back to `sqlite:///./dev.db` for smoke tests)

### Environment variables

```bash
DATABASE_URL=postgresql+psycopg://USER:PASSWORD@HOST/dbname
# optional test DB
TEST_DATABASE_URL=postgresql+psycopg://USER:PASSWORD@HOST/test_db
```

### Local runbook

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export DATABASE_URL="postgresql+psycopg://..."   # omit to use dev.db
uvicorn app.main:app --reload --port 8000
```

### REST & SSE surface

- `POST /rooms` → create room (`max_players` between 2 and 4)
- `POST /rooms/{code}/join` → join room with `display_name`
- `GET /rooms/{code}` → room details plus players
- `POST /rooms/{code}/submit` → submit `asset_a`/`asset_b` integers where `A+B=100`
- `GET /rooms/{code}/events` → SSE stream for lobby updates and final results

### Tests

Payout math is covered by pytest. Set `PYTHONPATH=.` so the `app` package resolves:

```bash
cd backend
source .venv/bin/activate
PYTHONPATH=. pytest tests
```

## Frontend

### Requirements

- Node.js 18+

### Environment

Set the API base URL so the client knows where to reach FastAPI:

```
# frontend/.env
VITE_API_BASE_URL=http://localhost:8000
```

### Setup & run

```bash
cd frontend
npm install
npm run dev
```

### Linting

```bash
cd frontend
npm run lint        # eslint
```

## Game logic reference

For a room with **n** players and allocations `(A_i, B_i)`:

- `total_B = Σ B_i`
- `boosted_pool = 1.5 * total_B`
- `each_share = boosted_pool / n`
- `payout_i = A_i + each_share`

The backend enforces valid sums, waits for all `n` submissions, and then writes each payout back to the database so clients can refetch historical results any time.

## Assumptions

- Primary deployment target is Postgres/Neon; SQLite is supported for local smoke tests only.
- Player identities are kept ephemeral (no auth) and tied to generated room/player IDs.
- SSE connections terminate at FastAPI directly; if running behind a proxy ensure SSE timeouts exceed 60s or enable periodic heartbeats.

## Room lifecycle

- `waiting` – seats open for joins until `max_players` is reached.
- `ready` – all seats filled; submissions open; results withheld until everyone submits.
- `completed` – settlement executed once, payouts immutable afterwards.

## Deployment plan

- **API (FastAPI + Postgres)**: Render (free tier) web service, points to Neon `DATABASE_URL`, enables keep-alive and SSE-friendly timeout. _(URL: TODO)_
- **Frontend (Vite app)**: Vercel or Netlify static deploy; build with `npm run build`, configure `VITE_API_BASE_URL` to the Render URL. _(URL: TODO)_
- **Observability**: Enable Render logs and Neon connection monitor; add health probe at `/health`.

## Quick demo steps

1. Open the hosted frontend (or `npm run dev`) and create a room.
2. Open another browser/incognito window and join with the displayed room code; repeat until the room is full.
3. Submit allocations from each player—validation keeps inputs integer-only and enforces `A + B = 100`.
4. Observe that results are emitted only after the final submission, then review pooled/boosted/payout values.
5. Click “Start Over” to reset your local session and host again.

## Question 2 responses

1. **Learning design** – The interface enforces simultaneous decision-making by hiding allocations until all players submit, preserving fairness. The results view then presents the pooled B total, the 1.5× multiplier effect, and individual payouts, making cooperation and free-riding dynamics immediately visible.

2. **Deployment approach & security** – The application is served over HTTPS with TLS terminated at the hosting edge (Render/Vercel). Secrets (Neon credentials) are stored as environment variables, CORS is restricted per environment, and server-side validation plus rate limiting protects room creation and submission endpoints from misuse.

3. **Scaling & reliability** – Room and player state is persisted in Postgres so restarts do not lose game data. Settlement runs transactionally to prevent duplicate computation. For horizontal scaling, the in-memory SSE broker can be replaced with Redis pub/sub or Postgres LISTEN/NOTIFY, and stale rooms can be cleaned up via TTL-based background jobs.
