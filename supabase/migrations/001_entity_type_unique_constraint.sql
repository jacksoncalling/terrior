-- Migration 001: Add unique constraint for entity_type_configs upsert
--
-- The saveOntology function upserts entity_type_configs with:
--   onConflict: 'project_id,type_id'
--
-- This requires a unique index on (project_id, type_id). Without it,
-- Supabase returns 400 and entity type colours are never persisted to the DB.
--
-- Run this once in the Supabase SQL editor.

CREATE UNIQUE INDEX IF NOT EXISTS entity_type_configs_project_type_unique
  ON entity_type_configs (project_id, type_id);
