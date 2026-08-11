# AI Language Tutor

## Overview

AI Language Tutor is an intelligent, multimodal language-learning platform that provides a highly personalized learning experience through natural conversations, real-time feedback, and adaptive study plans.

Unlike traditional language-learning applications that rely on static exercises, the platform acts as a private tutor capable of understanding the learner's strengths, weaknesses, goals, and learning pace. It combines Large Language Models (LLMs), speech recognition, text-to-speech, long-term memory, and autonomous agents to create immersive conversations and continuously adapt the learning experience.

The system supports multiple languages and interaction modes, including text, voice, images, and documents, enabling learners to practice real-world communication scenarios.

## Key Features

- 🎙️ Real-time voice conversations with an AI tutor
- 🗣️ Pronunciation analysis and instant feedback
- ✍️ Grammar, vocabulary, and writing correction
- 🧠 Long-term memory that remembers the learner's progress, mistakes, and preferences
- 📚 Personalized lesson plans generated dynamically
- 📝 Automatic generation of quizzes, exercises, and flashcards
- 🔁 Spaced repetition for vocabulary retention
- 🌍 Role-playing conversations (travel, business, healthcare, restaurants, interviews, etc.)
- 🎭 30 conversation scenarios with level-specific characters, goals, progression and complications
- 📖 Reading and listening comprehension exercises
- 📈 Learning analytics and progress dashboard
- 🎯 Adaptive difficulty based on learner performance
- 🌐 Multiple studied languages with per-language levels and a header switcher
- 💳 Free and Premium plans with daily feature entitlements
- 🛡️ Protected admin panel for usage, accounts and audited operations
- 📱 Cross-platform support through Web API and mobile-ready architecture

## Current architecture

- Next.js, React and TypeScript frontend deployed to Cloudflare Pages
- FastAPI backend packaged with Docker and deployed to Google Cloud Run
- Supabase Auth, PostgreSQL, Row Level Security and versioned migrations
- Provider-independent AI gateway with Gemini, DeepSeek and Kimi adapters
- Server-verified plan routing: DeepSeek-first conversation tutor for Premium users
- Gemini audio transcription through the authenticated backend
- Learning content and learner progress persisted in PostgreSQL
- Terraform for Cloudflare, Supabase and Google Cloud infrastructure
- GitHub Actions for validation and deployment
- Per-user and global usage controls with a US$10 monthly LLM ceiling

LangGraph, semantic memory with `pgvector`, specialized agents and Redis remain
optional future components. They will only be introduced when the product
workflow and measured load justify the additional complexity.

## Intelligent Agents

The system is composed of multiple specialized AI agents, including:

- Conversation Agent
- Pronunciation Coach
- Grammar Reviewer
- Vocabulary Coach
- Lesson Planner
- Exercise Generator
- Progress Analyzer
- Memory Manager

These agents collaborate to deliver contextual, personalized, and continuously improving learning sessions.

## Delivery status and roadmap

Implemented foundations include authentication and persistent onboarding,
learning-content catalogs, progress tracking, personalized review, textual
conversations with history and summaries, recorded-audio transcription, secure
account deletion, CI/CD and cost-controlled AI routing.

**Recently completed (August 2026):**

- **Phase 6 — Plans and administration:** `Free`/`Premium` plans, daily
  entitlements, admin roles, `/admin` panel, account management and audit logs.
  See [`docs/adr/0010-plans-entitlements-and-admin.md`](docs/adr/0010-plans-entitlements-and-admin.md).
- **Multiple languages:** `learner_languages` stores a level per studied language;
  the header flag switcher activates a language and restores its saved level.
- **Accessibility and navigation:** simplified mobile menu, conversation layout
  contained to the viewport, skip link, focus styles and WCAG-oriented E2E checks.

The next planned phases are:

1. **Text-to-speech:** Google Cloud Standard TTS for words, phrases,
   explanations and tutor messages. A provider-neutral `SpeechProvider`
   interface will make Google replaceable without changing product features.
2. **Corrections and spaced review:** structured feedback, recurring-error
   tracking and an FSRS/SM-2-style review schedule.
3. **Adaptive learning:** proficiency assessment, weekly study plans and
   exercises derived from observed learner needs.
4. **Advanced voice:** pronunciation feedback followed by real-time voice
   conversations once latency, quality and cost are validated.
5. **Production maturity:** broader E2E coverage, staging, observability,
   backups, privacy operations and a controlled private beta.

Longer-term possibilities include exam-preparation modules, teacher and
classroom dashboards, live translation, community challenges, native mobile and
offline experiences, fictional or historical characters, and MCP integrations.

## Goal

The ultimate goal of AI Language Tutor is to build an AI-powered personal language teacher that feels like interacting with a real human tutor—one that remembers every conversation, understands each learner's objectives, continuously adapts its teaching strategy, and helps users achieve fluency through natural, engaging, and personalized interactions.

## Repository Structure

```text
.
├── backend/          # FastAPI API, AI gateway and conversation services
├── frontend/         # Next.js web application
├── infra/terraform/  # Cloudflare, Supabase and Google Cloud infrastructure
├── supabase/         # Versioned database migrations
└── docs/             # Product and screen documentation
```

## Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

The production build is exported to `frontend/out` and is deployable to
Cloudflare Pages.

The frontend requires these public build variables:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

Add the same values as GitHub Actions variables in the `development`
environment. The publishable key is safe to expose in the browser; database
access is protected with Supabase Row Level Security.

## Complete local setup

Prerequisites: Node.js 22, Python 3.12+, `uv`, Docker, Terraform 1.10+ and the
Supabase CLI (or `npx supabase@latest`).

```bash
cp frontend/.env.example frontend/.env.local
cp backend/.env.example backend/.env
npm --prefix frontend ci
cd backend && uv sync --frozen --dev && cd ..
npx supabase@latest start
npx supabase@latest db reset
```

Use the local values printed by Supabase in `frontend/.env.local` and
`backend/.env`. Keep provider keys empty when running backend tests; tests use a
deterministic mock.

Start the applications in separate terminals:

```bash
npm --prefix frontend run dev
cd backend && uv run uvicorn app.main:app --reload
```

Run all validation:

```bash
./scripts/validate-all.sh
RUN_E2E=1 ./scripts/validate-all.sh
```

The tutor evaluation dataset and provider comparison commands are documented
in [`docs/LLM_EVALUATION.md`](docs/LLM_EVALUATION.md).

The project intentionally uses Supabase CLI instead of a parallel Docker
Compose definition because authentication, email capture, Storage and database
must be tested together. See `docs/adr/0006-local-development.md`.

## Database migrations

Database changes live under `supabase/migrations`. The Supabase GitHub
integration watches the `main` branch and automatically applies new migrations
to production. Its working directory is `.` because `supabase/` is at the
repository root.

Create a new timestamped migration, validate it locally, commit it, and merge it
to `main`. Do not run `supabase db push` manually while the GitHub integration is
processing the same commit.

The initial migration creates user profiles, persistent onboarding preferences,
automatic profile creation after signup, and per-user RLS policies.

Learning content is stored in the Supabase tables `learning_readings`,
`grammar_lessons`, and `quick_lesson_flashcards`. Published rows are readable by
the application, while changes require trusted database access. Content editors
can use Supabase Table Editor to add, reorder, unpublish, or remove lessons
without rebuilding the frontend. Prefer setting `is_published = false` when a
lesson already has learner history.

### Multiple studied languages

Each learner can keep separate levels in `learner_languages` (English, Spanish,
French and Italian). The active language lives in `learner_preferences` and is
switched from the header flag menu or from **Profile → Idiomas**. RPCs:

- `switch_active_language`
- `add_learner_language`
- `update_learner_language_level`

Migrations: `20260801150000_learner_languages.sql` and
`20260801151000_repair_learner_languages_backfill.sql`.

## Administration

The admin panel is a separate route in the web app. It never trusts a role sent
by the browser; FastAPI re-checks the JWT and reads `user_roles` through the
service role.

### How to open the admin panel

1. Log in with a normal learner account (onboarding completed).
2. Open **`/#/admin`** on the app origin, for example:
   - production: `https://ai-language-tutor.caps-labs.com/#/admin`
   - local dev: `http://localhost:3000/#/admin`
3. Ensure the backend is running and reachable (`NEXT_PUBLIC_API_BASE_URL` or
   the proxy configured in the frontend).

If your account is not promoted, the panel shows an access-denied message.

### How to promote the first administrator

Create the account through the normal signup flow, copy the Supabase user UUID,
then run in the Supabase SQL editor (or any trusted `service_role` session):

```sql
insert into public.user_roles (user_id, role)
values ('00000000-0000-0000-0000-000000000000', 'admin')
on conflict (user_id) do update set role = excluded.role;
```

Replace the UUID with your user id from **Authentication → Users**. There is no
public admin signup.

After the first admin exists, additional administrators can be promoted from the
admin panel (**Users** tab → select user → **Tornar admin**). Revoking admin
access is also available there (except for the last remaining admin and your
own account).

Revoke admin access manually (SQL):

```sql
delete from public.user_roles
where user_id = '00000000-0000-0000-0000-000000000000'
  and role = 'admin';
```

### What the panel provides

- Overview: users, activity (DAU/WAU), plan distribution, LLM usage and cost
- Users: search, daily usage, change plan (`free` / `premium`), promote or
  revoke admin, suspend or reactivate accounts
- Features: normalized usage by feature key
- Audit: administrative mutations from `admin_audit_logs`

Learners see their own plan usage under **Profile → Plano e metas**
(`GET /api/v1/account/entitlements`). Premium self-serve checkout uses
**Mercado Pago** at `#/pricing` (temporarily R$ 5,00 for monthly or annual while
real-credential charging is validated). Configure
`MERCADOPAGO_*` in the backend — see [`docs/adr/0011-premium-billing-mercadopago.md`](docs/adr/0011-premium-billing-mercadopago.md).

Further design notes: [`docs/adr/0010-plans-entitlements-and-admin.md`](docs/adr/0010-plans-entitlements-and-admin.md).

## Deployment

The frontend is deployed to the existing Direct Upload Cloudflare Pages project
by `.github/workflows/deploy-cloudflare-pages.yml`.

The canonical application URL is
`https://ai-language-tutor.caps-labs.com`. Terraform attaches this hostname to
the Pages project and configures it as the Supabase Auth Site URL. The default
`pages.dev` hostname remains an allowed callback for deployment diagnostics.

The workflow runs on frontend changes pushed to `main` and can also be started
manually. It audits production dependencies, runs lint and type-checking, builds
the static application, and deploys `frontend/out`.

Required GitHub environment configuration:

```text
Environment: development
Secret: CLOUDFLARE_API_TOKEN
Variables: CLOUDFLARE_ACCOUNT_ID
           NEXT_PUBLIC_SUPABASE_URL
           NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

## Infrastructure

```bash
terraform -chdir=infra/terraform init
terraform -chdir=infra/terraform plan
terraform -chdir=infra/terraform apply
```

Sensitive Terraform variables, plans, state files, and local provider data are
ignored by Git.

## Speech architecture (planned)

Text-to-speech will use Google Cloud Standard TTS behind a provider-neutral
backend contract:

```text
Frontend → FastAPI SpeechService → SpeechProvider → GoogleStandardTTSProvider
```

The frontend will never receive Google credentials. Generated audio will be
created on demand, cached by text/language/voice/rate/provider version, metered
in characters, and constrained by the active plan. Future providers can be
added as adapters without changing the API consumed by the frontend.

Plan entitlements and daily limits are already persisted and enforced
server-side for conversations, LLM requests and transcriptions.
