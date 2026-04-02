-- 005_hub_nodes.sql
ALTER TABLE ontology_nodes ADD COLUMN IF NOT EXISTS is_hub BOOLEAN DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_ontology_nodes_is_hub ON ontology_nodes(project_id) WHERE is_hub = true;

-- Backfill: mark existing hub nodes (seeded with type = 'hub') as is_hub = true
UPDATE ontology_nodes SET is_hub = true WHERE type = 'hub';
