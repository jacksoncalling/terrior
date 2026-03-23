-- Migration 002: Enable Supabase Realtime on ontology tables
--
-- Required for the live graph sync feature (Supabase Realtime subscription
-- in page.tsx). Without this, Postgres change events are not broadcast.
--
-- Run this once in the Supabase SQL editor.

ALTER PUBLICATION supabase_realtime ADD TABLE ontology_nodes;
ALTER PUBLICATION supabase_realtime ADD TABLE ontology_relationships;
