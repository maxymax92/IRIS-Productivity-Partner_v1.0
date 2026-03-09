# Contributing to Iris

Thanks for your interest in contributing! This guide will help you get started.

## Development Setup

### Prerequisites

- Node.js 20+
- npm 10+
- Deno 2+ (for edge functions)
- Supabase CLI (`npx supabase`)
- A Supabase project (free tier works)
- An Anthropic API key

### Getting Started

```bash
# Clone the repo
git clone https://github.com/maxymax92/IRIS-Productivity-Partner_v1.0.git
cd IRIS-Productivity-Partner_v1.0

# Install dependencies
cd supabase/next
npm install

# Copy the example env file and fill in your values
cp .env.example .env.local

# Start the dev server
npm run dev
```

### Environment Variables

See `supabase/next/.env.example` for all required variables. At minimum you need:

- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — from your Supabase project
- `SUPABASE_SECRET_KEY` — service role key (never expose client-side)
- `ANTHROPIC_API_KEY` — for the AI agent

## Code Standards

### Quality Gate

All PRs must pass the quality gate:

```bash
npm run gate:ci
```

This runs Prettier, ESLint, and TypeScript type checking. Zero errors and zero warnings required.

### Key Rules

- **Tailwind v4 semantic tokens only** — no hardcoded colours, pixels, or raw hex/rgb values
- **No `eslint-disable` or `@ts-ignore`** — fix at root cause
- **Import from installed packages** — don't reimplement library internals
- **Prefer editing existing files** over creating new ones

### Commit Messages

Use conventional commits:

```
feat: add memory browser search
fix: correct date format in sidebar
refactor: simplify conversation loading
docs: update architecture guide
```

## Pull Requests

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Ensure `npm run gate:ci` passes
4. Write a clear PR description explaining what and why
5. Link any related issues

### PR Title Format

Keep titles under 70 characters. Use the description for details.

## Project Structure

```
supabase/
  next/           # Next.js 16 app (frontend + API routes)
    app/           # App Router pages and API routes
    components/    # React components
    hooks/         # Custom React hooks
    lib/           # Utilities, agent tools, constants
  functions/       # Supabase Deno edge functions
  migrations/      # Postgres migrations
docs/              # Architecture and feature documentation
```

## Need Help?

- Check the [README](README.md) for an overview
- Read `docs/architecture.md` for system design
- Read `docs/features.md` for detailed feature documentation
- Open an issue for bugs or feature requests
