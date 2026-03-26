-- Migration 003: Add reflection score columns to evaluative_signals
--
-- Enables the Reflect tab: users rate each evaluative signal on two axes
-- (relevance × intensity) with an optional freetext note.
--
-- HOW TO RUN:
--   Paste into Supabase Dashboard → SQL Editor → Run.
--
-- All four columns are nullable so existing rows are unaffected.
-- Scores are 1-5 integers; NULL means "not yet rated".

ALTER TABLE evaluative_signals
  ADD COLUMN IF NOT EXISTS relevance_score integer CHECK (relevance_score BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS intensity_score integer CHECK (intensity_score BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS reflected_at    timestamptz,
  ADD COLUMN IF NOT EXISTS user_note       text;
