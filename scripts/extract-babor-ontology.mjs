#!/usr/bin/env node
/**
 * Babor Ontology Extraction — Gemini Bulk Pass
 *
 * Sends all scraped Babor documents to Gemini in one shot (it has 1M context),
 * extracts a structured knowledge graph, and saves a Terroir-compatible
 * GraphState JSON ready for import.
 *
 * Run: node scripts/extract-babor-ontology.mjs
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Usage: node extract-babor-ontology.mjs           → data/babor-raw  → data/babor-ontology-gemini.json
//        node extract-babor-ontology.mjs bc-raw    → data/bc-raw     → data/bc-ontology-gemini.json
const dataSubdir = process.argv[2] || 'babor-raw';
const DATA_DIR   = join(__dirname, '..', 'data', dataSubdir);
const OUTPUT     = join(__dirname, '..', 'data', `${dataSubdir.replace('-raw', '')}-ontology-gemini.json`);

const GEMINI_API_KEY = 'AIzaSyCW6LmzBTkYHelCLiimuJXcbagib-UlW0E';
const MODEL          = 'gemini-2.5-flash';

// The 6 entity types for the Babor product domain
const ENTITY_TYPES = [
  { id: 'product_line', label: 'Product Line', color: '#8b5cf6' },
  { id: 'product',      label: 'Product',      color: '#3b82f6' },
  { id: 'ingredient',   label: 'Ingredient',   color: '#10b981' },
  { id: 'skin_concern', label: 'Skin Concern', color: '#f59e0b' },
  { id: 'skin_type',    label: 'Skin Type',    color: '#ef4444' },
  { id: 'routine_step', label: 'Routine Step', color: '#6b7280' },
];

// ─── Load documents ───────────────────────────────────────────────────────────

function loadDocuments() {
  const files = readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => JSON.parse(readFileSync(join(DATA_DIR, f), 'utf-8')));
}

function buildCorpus(docs) {
  return docs
    .map(doc => `=== ${doc.title} [section: ${doc.section}] ===\nURL: ${doc.url}\n\n${doc.content}`)
    .join('\n\n---\n\n');
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

function buildPrompt(corpus, docCount) {
  return `You are an ontology extraction expert specializing in cosmetics and skincare.

Your task: Build a precise knowledge graph from Babor Beauty Group's website content.
Purpose: Power a product recommendation system for customer service reps and B2B institute partners.
The query it must answer well: "Which Babor products suit sensitive AND dehydrated skin, and why?"

## CORPUS (${docCount} pages from de.babor.com)

${corpus}

## ENTITY TYPES — extract ONLY these 6

### product_line
A named product series. One node per series, not per product.
Examples: NEURO CALM, Skinovage, Doctor Babor LIFTING RX, CLEANSING, HY-ÖL, HSR Lifting
Label in English. Max 15 nodes.

### product
A specific hero product. Focus on 25-40 products with rich descriptions.
EXCLUDE: gift sets, size variants, kits, "starter sets".
INCLUDE: named creams, serums, ampoules, cleansers with clear skin functions.
Label in English (translate German if needed).

### ingredient
Only active ingredients Babor explicitly names and markets.
INCLUDE: 3D Hyaluron, Collagen-Peptide, THD Ascorbic Acid, Niacinamide, Retinol, Lactic Acid, Peptides, Panthenol
EXCLUDE: water, preservatives, emulsifiers, vague "plant extracts"
Label in English. Max 20 nodes.

### skin_concern
Specific skin problems. Translate from German. Keep distinct.
RULE: "feuchtigkeitsarm" (dehydration/lacking moisture) ≠ "trocken" (dry skin type) — these are DIFFERENT nodes.
INCLUDE: Dehydration, Dryness, Loss of Firmness, Wrinkles, Hyperpigmentation, Redness, Blemishes/Acne, Dullness, Sensitivity, Puffiness
Label in English. Max 12 nodes.

### skin_type
Skin type categories — stable traits, not problems.
INCLUDE: Dry, Oily, Combination, Sensitive, Normal, Mature, Demanding
Max 8 nodes.

### routine_step
Steps in a skincare routine.
INCLUDE: Cleansing, Toning, Serum/Treatment, Eye Care, Moisturizing, Sun Protection, Masking
Max 8 nodes.

## RELATIONSHIP TYPES — extract ONLY these 6

| Relationship   | Direction                        | Rule |
|----------------|----------------------------------|------|
| CONTAINS       | product → ingredient             | Product page explicitly names this ingredient as active |
| ADDRESSES      | ingredient → skin_concern        | Ingredient is described as targeting this concern |
| TARGETS        | product → skin_concern           | Product explicitly claims to treat/improve this concern |
| SUITABLE_FOR   | product → skin_type              | Product page says "für [skin type]" or equivalent |
| BELONGS_TO     | product → product_line           | Product is part of this named series |
| USED_IN        | product → routine_step           | Product is described as a [cleanser/serum/moisturizer/etc] |

## QUALITY RULES

1. DEPTH over BREADTH: 40 nodes × 90 edges beats 100 nodes × 40 vague edges
2. No orphan nodes — every node needs ≥1 relationship
3. Descriptions must be specific ("binds water at 3 skin depths" not "moisturizing")
4. Source hierarchy: product description pages > ingredient glossary > category pages > magazine
5. TARGETS / SUITABLE_FOR: only from explicit product claims, not inferred from line positioning
6. All labels and descriptions in ENGLISH

## OUTPUT

Return a single valid JSON object with this exact shape (no markdown, pure JSON):

{
  "nodes": [
    {
      "id": "node_1",
      "label": "NEURO CALM",
      "type": "product_line",
      "description": "Sensitive skin collection using neuro-cosmetic approach to reduce skin reactivity and redness",
      "position": { "x": 0, "y": 0 }
    },
    {
      "id": "node_2",
      "label": "3D Hyaluron",
      "type": "ingredient",
      "description": "Triple-molecular-weight hyaluronic acid that hydrates at three different skin depths simultaneously",
      "position": { "x": 0, "y": 0 }
    }
  ],
  "relationships": [
    {
      "id": "rel_1",
      "sourceId": "node_3",
      "targetId": "node_2",
      "type": "CONTAINS",
      "description": "Key active for deep moisture binding"
    }
  ],
  "tensions": [],
  "evaluativeSignals": [],
  "entityTypes": [
    { "id": "product_line", "label": "Product Line", "color": "#8b5cf6" },
    { "id": "product",      "label": "Product",      "color": "#3b82f6" },
    { "id": "ingredient",   "label": "Ingredient",   "color": "#10b981" },
    { "id": "skin_concern", "label": "Skin Concern", "color": "#f59e0b" },
    { "id": "skin_type",    "label": "Skin Type",    "color": "#ef4444" },
    { "id": "routine_step", "label": "Routine Step", "color": "#6b7280" }
  ]
}

IDs: use node_1, node_2, ... and rel_1, rel_2, ...
Positions: always { "x": 0, "y": 0 } — Terroir auto-layouts on import.
`;
}

// ─── Gemini API ───────────────────────────────────────────────────────────────

async function callGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 16384,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API ${res.status}: ${err}`);
  }

  const data = await res.json();

  // Log token usage if available
  if (data.usageMetadata) {
    const { promptTokenCount, candidatesTokenCount } = data.usageMetadata;
    console.log(`  Tokens — prompt: ${promptTokenCount?.toLocaleString()}, output: ${candidatesTokenCount?.toLocaleString()}`);
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty response from Gemini');
  return text;
}

// ─── Validate + clean ─────────────────────────────────────────────────────────

function validateAndClean(jsonText) {
  const graph = JSON.parse(jsonText);

  if (!Array.isArray(graph.nodes))         throw new Error('Missing nodes array');
  if (!Array.isArray(graph.relationships)) throw new Error('Missing relationships array');

  // Ensure defaults
  graph.tensions          = [];
  graph.evaluativeSignals = [];
  graph.entityTypes       = ENTITY_TYPES;

  // Ensure positions exist
  for (const node of graph.nodes) {
    node.position = node.position || { x: 0, y: 0 };
  }

  // Remove relationships referencing unknown nodes
  const nodeIds = new Set(graph.nodes.map(n => n.id));
  const before  = graph.relationships.length;
  graph.relationships = graph.relationships.filter(
    r => nodeIds.has(r.sourceId) && nodeIds.has(r.targetId)
  );
  const dropped = before - graph.relationships.length;
  if (dropped > 0) console.warn(`  Dropped ${dropped} relationships with unknown node IDs`);

  return graph;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Babor Ontology Extraction via Gemini ===\n');

  console.log('Loading scraped documents...');
  const docs   = loadDocuments();
  console.log(`Loaded ${docs.length} documents\n`);

  const corpus          = buildCorpus(docs);
  const prompt          = buildPrompt(corpus, docs.length);
  const promptTokenEst  = Math.round(prompt.length / 4);
  console.log(`Estimated prompt size: ~${promptTokenEst.toLocaleString()} tokens`);
  console.log('Calling Gemini...\n');

  const rawJson = await callGemini(prompt);

  console.log('\nParsing and validating...');
  const graph = validateAndClean(rawJson);

  // Print summary
  console.log('\n=== Extraction Results ===');
  const nodesByType = {};
  for (const node of graph.nodes) {
    nodesByType[node.type] = (nodesByType[node.type] || 0) + 1;
  }
  for (const [type, count] of Object.entries(nodesByType)) {
    const label = ENTITY_TYPES.find(t => t.id === type)?.label || type;
    console.log(`  ${label.padEnd(14)} ${count} nodes`);
  }

  const relsByType = {};
  for (const rel of graph.relationships) {
    relsByType[rel.type] = (relsByType[rel.type] || 0) + 1;
  }
  console.log('\n  Relationships:');
  for (const [type, count] of Object.entries(relsByType)) {
    console.log(`  ${type.padEnd(14)} ${count}`);
  }

  console.log(`\n  Total: ${graph.nodes.length} nodes, ${graph.relationships.length} relationships`);

  writeFileSync(OUTPUT, JSON.stringify(graph, null, 2));
  console.log(`\nSaved: ${OUTPUT}`);
  console.log('\nNext step: Open Terroir → Import button → select babor-ontology-gemini.json');
}

main().catch(err => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});
