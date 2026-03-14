#!/usr/bin/env node
/**
 * Terroir Phase 2 — Data Migration
 *
 * Creates the two existing projects (Babor Beauty, Bike Components)
 * and backfills project_id on existing documents + chunks.
 *
 * Run AFTER migrate-phase2.sql has been run in Supabase SQL Editor.
 *
 * Usage: node scripts/migrate-data.mjs
 */

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const envContent = readFileSync(new URL('../.env.local', import.meta.url), 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const [key, ...rest] = line.split('=');
  if (key && rest.length) env[key.trim()] = rest.join('=').trim();
});

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);

const EMBEDDING_MODEL = 'paraphrase-multilingual-MiniLM-L12-v2';

async function main() {
  console.log('=== Terroir Phase 2 — Data Migration ===\n');

  // ── 1. Create projects ────────────────────────────────────────
  console.log('Creating projects...');

  const projects = [
    {
      name: 'Babor Beauty Group',
      sector: 'Skincare / E-Commerce',
      description: 'Babor Beauty Group German website — skincare products, ingredients, sustainability. Phase 1 test corpus.',
      embedding_model: EMBEDDING_MODEL,
      phase: 'live',
      metadata: { section: 'service', source: 'phase1-babor', created_by: 'migration' },
    },
    {
      name: 'Bike Components — Rennrad',
      sector: 'Sporting Goods / E-Commerce',
      description: 'bike-components.de road bike (Rennrad) product catalog. Phase 1 test corpus.',
      embedding_model: EMBEDDING_MODEL,
      phase: 'live',
      metadata: { section: 'rennrad', source: 'phase1-bc', created_by: 'migration' },
    },
  ];

  const createdProjects = {};

  for (const project of projects) {
    // Check if already exists
    const { data: existing } = await supabase
      .from('projects')
      .select('id, name')
      .eq('name', project.name)
      .single();

    if (existing) {
      console.log(`  ✓ Already exists: "${existing.name}" (${existing.id})`);
      createdProjects[project.name] = existing.id;
      continue;
    }

    const { data, error } = await supabase
      .from('projects')
      .insert(project)
      .select('id, name')
      .single();

    if (error) {
      console.error(`  ✗ Failed to create "${project.name}":`, error.message);
      process.exit(1);
    }

    console.log(`  ✓ Created: "${data.name}" (${data.id})`);
    createdProjects[data.name] = data.id;
  }

  const baborProjectId = createdProjects['Babor Beauty Group'];
  const bikeProjectId = createdProjects['Bike Components — Rennrad'];

  console.log();

  // ── 2. Backfill documents ────────────────────────────────────
  console.log('Backfilling documents with project_id...');

  // Babor (section = 'service' or any non-rennrad section)
  const babor_sections = ['service', 'magazine', 'product', 'about', 'home', 'sustainability', 'other'];
  for (const section of babor_sections) {
    const { error, count } = await supabase
      .from('documents')
      .update({ project_id: baborProjectId })
      .eq('section', section)
      .is('project_id', null)
      .select('*', { count: 'exact', head: true });

    if (error) console.error(`  Error updating section=${section}:`, error.message);
    else if (count > 0) console.log(`  Babor  section=${section}: ${count} docs`);
  }

  // Bikes
  const { error: bikeErr, count: bikeCount } = await supabase
    .from('documents')
    .update({ project_id: bikeProjectId })
    .eq('section', 'rennrad')
    .is('project_id', null)
    .select('*', { count: 'exact', head: true });

  if (bikeErr) console.error('  Error updating bike docs:', bikeErr.message);
  else console.log(`  Bikes  section=rennrad: ${bikeCount} docs`);

  console.log();

  // ── 3. Backfill document_chunks via join ────────────────────
  console.log('Backfilling chunks with project_id...');
  console.log('  (This uses a two-step approach via document IDs)');

  // Get all documents for Babor
  const { data: baborDocs } = await supabase
    .from('documents')
    .select('id')
    .eq('project_id', baborProjectId);

  if (baborDocs && baborDocs.length > 0) {
    const baborDocIds = baborDocs.map(d => d.id);
    // Update in batches of 50
    for (let i = 0; i < baborDocIds.length; i += 50) {
      const batch = baborDocIds.slice(i, i + 50);
      const { error } = await supabase
        .from('document_chunks')
        .update({ project_id: baborProjectId })
        .in('document_id', batch)
        .is('project_id', null);
      if (error) console.error(`  Chunk batch error:`, error.message);
    }
    console.log(`  Babor: updated chunks for ${baborDocs.length} documents`);
  }

  // Get all documents for Bikes
  const { data: bikeDocs } = await supabase
    .from('documents')
    .select('id')
    .eq('project_id', bikeProjectId);

  if (bikeDocs && bikeDocs.length > 0) {
    const bikeDocIds = bikeDocs.map(d => d.id);
    for (let i = 0; i < bikeDocIds.length; i += 50) {
      const batch = bikeDocIds.slice(i, i + 50);
      const { error } = await supabase
        .from('document_chunks')
        .update({ project_id: bikeProjectId })
        .in('document_id', batch)
        .is('project_id', null);
      if (error) console.error(`  Chunk batch error:`, error.message);
    }
    console.log(`  Bikes:  updated chunks for ${bikeDocs.length} documents`);
  }

  console.log();

  // ── 4. Verify ─────────────────────────────────────────────
  console.log('Verification:');

  const { count: nullDocCount } = await supabase
    .from('documents')
    .select('*', { count: 'exact', head: true })
    .is('project_id', null);
  console.log(`  Documents with no project_id: ${nullDocCount ?? '?'} (should be 0)`);

  const { count: nullChunkCount } = await supabase
    .from('document_chunks')
    .select('*', { count: 'exact', head: true })
    .is('project_id', null);
  console.log(`  Chunks with no project_id: ${nullChunkCount ?? '?'} (should be 0)`);

  const { count: baborDocTotal } = await supabase
    .from('documents')
    .select('*', { count: 'exact', head: true })
    .eq('project_id', baborProjectId);
  console.log(`  Babor documents: ${baborDocTotal}`);

  const { count: bikeDocTotal } = await supabase
    .from('documents')
    .select('*', { count: 'exact', head: true })
    .eq('project_id', bikeProjectId);
  console.log(`  Bike documents: ${bikeDocTotal}`);

  console.log('\n=== Migration complete ===');
  console.log(`\nBabor project ID: ${baborProjectId}`);
  console.log(`Bike project ID:  ${bikeProjectId}`);
  console.log('\nNext step: open the app at /projects — you should see both projects listed.');
}

main().catch(err => {
  console.error('\nMigration failed:', err.message);
  process.exit(1);
});
