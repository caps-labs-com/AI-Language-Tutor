# AI Language Tutor API

FastAPI backend for authenticated AI requests, provider routing, usage
observability, and budget enforcement.

## Local setup

```bash
cd backend
cp .env.example .env
uv sync --dev
uv run uvicorn app.main:app --reload
```

The application defaults to Gemini 3.1 Flash-Lite with DeepSeek V4 Flash as
fallback. Tests inject the `mock` provider and do not consume paid tokens.

Endpoints:

- `GET /health`
- `GET /api/v1/me`
- `DELETE /api/v1/account`
- `POST /api/v1/ai/tutor/reply`
- `POST /api/v1/speech/transcribe`
- conversation session, message, summary, hint, translation and history routes

Run validation:

```bash
uv run ruff check .
uv run mypy app
uv run pytest
```

`SUPABASE_SERVICE_ROLE_KEY` is backend-only. Never expose it through a
`NEXT_PUBLIC_*` variable or commit it.

Account deletion requires an authenticated Supabase access token and the JSON
confirmation `{"confirmation":"EXCLUIR"}`. The backend deletes the Auth user
through the Supabase Admin API; profile, onboarding, progress, and usage rows
are removed by the database's `ON DELETE CASCADE` relationships.

## Provider routing

Choose the primary provider and ordered fallbacks through environment variables:

```env
LLM_PRIMARY_PROVIDER=gemini
LLM_FALLBACK_PROVIDERS=deepseek
LLM_PREMIUM_TUTOR_REPLY_PROVIDERS=deepseek,gemini
```

Supported adapter names are `mock`, `deepseek`, `kimi`, and `gemini`. Real
providers require both an API key and current input/output prices. Startup fails
when a real provider is enabled with zero prices, preventing untracked spend.

Example production routing:

```env
LLM_PRIMARY_PROVIDER=gemini
LLM_FALLBACK_PROVIDERS=deepseek
LLM_PREMIUM_TUTOR_REPLY_PROVIDERS=deepseek,gemini
```

The conversation route resolves the user's plan server-side through Supabase.
Free conversations use the normal task chain; Premium tutor replies use
DeepSeek first and Gemini as fallback. A plan supplied by the browser is never
used for authorization or provider routing. DeepSeek V4 runs in non-thinking
mode for interactive replies to keep latency predictable.

Conversation scenarios include a character role, personality, register,
situation, ordered conversation beats and optional complications. These fields
are loaded by the backend service role and combined with explicit A1-B2
instructions in the tutor prompt. The model stays in character, reacts to what
the learner said and advances the scenario without exposing internal metadata.

The checked-in defaults use the official prices verified on 2026-07-29:

```env
GEMINI_MODEL=gemini-3.1-flash-lite
GEMINI_INPUT_USD_PER_MILLION=0.25
GEMINI_OUTPUT_USD_PER_MILLION=1.50
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_INPUT_USD_PER_MILLION=0.14
DEEPSEEK_OUTPUT_USD_PER_MILLION=0.28
```

DeepSeek input is accounted at the cache-miss rate, so cached requests are
conservatively overestimated. Review official pricing before each production
release. Kimi remains supported by the adapter but is not enabled.

## Budget enforcement

Apply `supabase/migrations/20260729120000_create_llm_usage_and_budgets.sql`
and `20260729160000_enforce_monthly_llm_budget.sql` before deploying the API.
They create:

- atomic request reservations;
- per-user daily request and cost limits;
- a global monthly cost limit;
- token, model, provider, latency, and estimated-cost events;
- read-only RLS access for users to their own usage.

Default initial limits are intentionally conservative:

```text
100 LLM requests per user/day
US$ 0.25 per user/day
US$ 10.00 globally/month
US$ 0.02 reserved per request
```

Change database limits through `public.llm_budget_policies`, not from the
frontend.

## Plans, entitlements and administration

Implemented in Phase 6. Protected `Free` and `Premium` plans, daily feature
entitlements, normalized usage events, `/api/v1/admin/*` routes and the
`/#/admin` panel. Administrative authorization is evaluated from `user_roles`
via the backend service role; the API never trusts a role sent by the frontend.

**Promote an admin** (Supabase SQL editor):

```sql
insert into public.user_roles (user_id, role)
values ('your-user-uuid', 'admin')
on conflict (user_id, role) do update set role = excluded.role;
```

Then open `/#/admin` while logged in. Full steps are in the repository
[`README.md`](../README.md#administration).

See [`docs/adr/0010-plans-entitlements-and-admin.md`](../docs/adr/0010-plans-entitlements-and-admin.md).

## Planned text-to-speech API

Speech synthesis will use a provider-neutral Strategy/Adapter design:

```text
SpeechService
└── SpeechProvider
    ├── GoogleStandardTTSProvider  # initial provider
    └── additional providers      # future adapters
```

The public contract will use generic fields such as text, BCP-47 language,
voice, speaking rate and output format. Provider-specific SDK types must not
escape the adapter.

Initial operational rules:

- Google Cloud Standard TTS is called only by the authenticated backend.
- Cloud Run uses its runtime service account; no credential JSON is shipped.
- Synthesis is on demand rather than automatic.
- Reusable audio is cached by normalized request and provider version.
- Text length, language, voice and output format are validated.
- Usage is metered in characters and associated with user, feature and plan.
- Rate limits, plan entitlements and global cost controls are enforced before
  calling the provider.
- Device `speechSynthesis` may be used only as an explicit availability
  fallback, not as the primary production voice.
