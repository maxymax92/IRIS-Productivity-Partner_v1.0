-- =============================================================================
-- Migration: Allowed Emails Table + Seed Data
-- Purpose: Restrict sign-ups to pre-approved email addresses
-- =============================================================================

-- =============================================================================
-- Table: allowed_emails
-- =============================================================================
-- Controls which email addresses are permitted to sign up.
-- Used by auth hooks or application logic to gate registration.

create table if not exists public.allowed_emails (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  created_at timestamptz not null default now(),

  constraint allowed_emails_email_unique unique (email)
);

-- =============================================================================
-- Row Level Security
-- =============================================================================

alter table public.allowed_emails enable row level security;

-- Only service_role can manage allowed emails (no direct user access)
-- Application checks this table via edge functions or auth hooks

-- =============================================================================
-- Seed Data
-- =============================================================================
-- Update the email below to the address(es) you want to allow.

insert into public.allowed_emails (email)
values
  ('your-email@example.com')  -- TODO: Replace with your actual email
on conflict (email) do nothing;

-- =============================================================================
-- Comments
-- =============================================================================

comment on table public.allowed_emails is
  'Pre-approved email addresses allowed to sign up';
