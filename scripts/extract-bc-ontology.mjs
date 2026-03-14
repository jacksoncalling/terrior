#!/usr/bin/env node
/**
 * bike-components.de Ontology Extraction — Gemini Bulk Pass
 *
 * Sends scraped Rennrad product pages to Gemini, extracts a structured
 * knowledge graph for road bikes, saves Terroir-compatible GraphState JSON.
 *
 * Run: node scripts/extract-bc-ontology.mjs
 * Output: data/bc-ontology-gemini.json
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = join(__dirname, '..', 'data', 'bc-raw');
const OUTPUT    = join(__dirname, '..', 'data', 'bc-ontology-gemini.json');

const GEMINI_API_KEY = 'AIzaSyCW6LmzBTkYHelCLiimuJXcbagib-UlW0E';
const MODEL          = 'gemini-2.5-flash';

const ENTITY_TYPES = [
  { id: 'brand',          label: 'Brand',          color: '#8b5cf6' },
  { id: 'bike',           label: 'Bike',            color: '#3b82f6' },
  { id: 'groupset',       label: 'Groupset',        color: '#10b981' },
  { id: 'frame_material', label: 'Frame Material',  color: '#f59e0b' },
  { id: 'riding_style',   label: 'Riding Style',    color: '#ef4444' },
  { id: 'price_tier',     label: 'Price Tier',      color: '#6b7280' },
];

// ─── Load documents ───────────────────────────────────────────────────────────

function loadDocuments() {
  const files = readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => JSON.parse(readFileSync(join(DATA_DIR, f), 'utf-8')));
}

function buildCorpus(docs) {
  return docs
    .map(doc => `=== ${doc.title} ===\nURL: ${doc.url}\n\n${doc.content}`)
    .join('\n\n---\n\n');
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

function buildPrompt(corpus, docCount) {
  return `You are an ontology extraction expert for cycling and road bikes.

Your task: Build a precise knowledge graph from bike-components.de Rennrad (road bike) product pages.
Purpose: Power a recommendation system that helps customers find the right road bike using natural language — including beginners who don't know technical terms.
Key queries it must answer well:
- "I want a fast aero road bike for racing under €4000"
- "I need a comfortable bike for long endurance rides"
- "What is the difference between Shimano and SRAM groupsets?"
- "I want to convert my bike from 2x to 1x drivetrain"

## CORPUS (${docCount} road bike product pages from bike-components.de)

${corpus}

## ENTITY TYPES — extract ONLY these 6

### brand
The bicycle manufacturer. One node per brand.
INCLUDE: Specialized, Scott, Cannondale, Factor, Cervélo, Wilier, Marin Bikes, and any others found.
Label: exact brand name as used in the market.

### bike
A specific road bike model. One node per distinct model (not per color/size variant).
Label: Brand + Model name (e.g. "Specialized Tarmac SL8 Expert", "Scott Foil RC 30")
Description: include frame material, groupset, intended use, price range, and one sentence on who it's for.
INCLUDE: 15–22 distinct bikes found in the corpus.
EXCLUDE: color/size variants of the same model — merge into one node.

### groupset
The drivetrain component group. One node per distinct groupset.
INCLUDE: Shimano Ultegra Di2, Shimano 105 Di2, SRAM Force AXS, SRAM Rival AXS, Shimano Ultegra (mechanical), and any others found.
Description: manufacturer, tier (entry/mid/high), electronic or mechanical, speed count (11-speed, 12-speed), 1x or 2x capable.
Label: exact market name (e.g. "Shimano Ultegra Di2", "SRAM Force AXS").

### frame_material
Construction material of the frame. One node per material type.
INCLUDE: Carbon, Aluminum (Aluminium/Alloy), any others found.
Description: weight implications, ride quality, typical use case.

### riding_style
The intended use/riding discipline. One node per style.
INCLUDE: Race/Aero (stiff, fast, aggressive position), Endurance/Gran Fondo (comfort, long distance), Gravel (mixed terrain), Track/Fixed (velodrome). Only include styles actually represented in the corpus.
Description: what kind of rider/terrain this suits, typical geometry characteristics.

### price_tier
Price range grouping. One node per tier.
INCLUDE: only tiers that appear in the corpus.
Use these exact labels: "Entry (under €2.000)", "Mid-Range (€2.000–€4.000)", "Premium (€4.000–€7.000)", "High-End (over €7.000)"
Description: what the buyer gets at this tier, trade-offs.

## RELATIONSHIP TYPES — extract ONLY these 6

| Relationship   | Direction                   | Rule |
|----------------|-----------------------------|------|
| MADE_BY        | bike → brand                | Always: every bike has a manufacturer |
| USES_GROUPSET  | bike → groupset             | The drivetrain group installed on the bike |
| BUILT_FROM     | bike → frame_material       | Primary frame construction material |
| DESIGNED_FOR   | bike → riding_style         | Intended riding discipline from product description |
| PRICED_AS      | bike → price_tier           | Based on listed price |
| COMPATIBLE_WITH | groupset → groupset        | Same-speed groupsets that share components (e.g. Ultegra + 105 both 11-speed Shimano road) |

## QUALITY RULES

1. Every bike node needs: MADE_BY + at least one of USES_GROUPSET, BUILT_FROM, DESIGNED_FOR, PRICED_AS
2. No orphan nodes — every node needs ≥1 relationship
3. Descriptions: max 20 words each — be concise ("Lightweight carbon aero frame, race geometry, Di2 groupset, for competitive road racing")
4. COMPATIBLE_WITH relationships are valuable — they power upgrade advice queries
5. If a groupset appears on multiple bikes, create ONE groupset node connected to all of them
6. All labels in English
7. Keep total output compact — short descriptions save tokens

## OUTPUT

Return a single valid JSON object (no markdown, pure JSON):

{
  "nodes": [
    {
      "id": "node_1",
      "label": "Specialized",
      "type": "brand",
      "description": "American premium bicycle manufacturer known for performance road and mountain bikes",
      "position": { "x": 0, "y": 0 }
    }
  ],
  "relationships": [
    {
      "id": "rel_1",
      "sourceId": "node_2",
      "targetId": "node_1",
      "type": "MADE_BY",
      "description": "Specialized manufactures the Tarmac SL8"
    }
  ],
  "tensions": [],
  "evaluativeSignals": [],
  "entityTypes": [
    { "id": "brand",          "label": "Brand",         "color": "#8b5cf6" },
    { "id": "bike",           "label": "Bike",          "color": "#3b82f6" },
    { "id": "groupset",       "label": "Groupset",      "color": "#10b981" },
    { "id": "frame_material", "label": "Frame Material","color": "#f59e0b" },
    { "id": "riding_style",   "label": "Riding Style",  "color": "#ef4444" },
    { "id": "price_tier",     "label": "Price Tier",    "color": "#6b7280" }
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
        maxOutputTokens: 32768,
        responseMimeType: 'application/json',
      },
    }),
  });
  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (data.usageMetadata) {
    const { promptTokenCount, candidatesTokenCount } = data.usageMetadata;
    console.log(`  Tokens — prompt: ${promptTokenCount?.toLocaleString()}, output: ${candidatesTokenCount?.toLocaleString()}`);
  }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty response from Gemini');
  return text;
}

// ─── Validate + clean ─────────────────────────────────────────────────────────

function repairTruncatedJson(jsonText) {
  // If JSON is complete, return as-is
  try { JSON.parse(jsonText); return jsonText; } catch {}

  // Try progressively truncating at the last complete top-level array item
  // Find last complete relationship object (ends with })
  const lastRelEnd = jsonText.lastIndexOf('}\n  ]');
  if (lastRelEnd > 0) {
    const candidate = jsonText.slice(0, lastRelEnd + 1) + '\n  ],\n  "tensions": [],\n  "evaluativeSignals": [],\n  "entityTypes": []\n}';
    try { JSON.parse(candidate); console.warn('  ⚠ Repaired truncated JSON (trimmed at last complete relationship)'); return candidate; } catch {}
  }
  // Find last complete node object
  const lastNodeEnd = jsonText.lastIndexOf('},\n    {');
  if (lastNodeEnd > 0) {
    const candidate = jsonText.slice(0, lastNodeEnd + 1) + '\n  ],\n  "relationships": [],\n  "tensions": [],\n  "evaluativeSignals": [],\n  "entityTypes": []\n}';
    try { JSON.parse(candidate); console.warn('  ⚠ Repaired truncated JSON (trimmed at last complete node, no relationships)'); return candidate; } catch {}
  }
  throw new Error('Unexpected end of JSON input — could not repair');
}

function validateAndClean(jsonText) {
  const repairedText = repairTruncatedJson(jsonText);
  const graph = JSON.parse(repairedText);
  if (!Array.isArray(graph.nodes))         throw new Error('Missing nodes array');
  if (!Array.isArray(graph.relationships)) throw new Error('Missing relationships array');
  graph.tensions          = [];
  graph.evaluativeSignals = [];
  graph.entityTypes       = ENTITY_TYPES;
  for (const node of graph.nodes) node.position = node.position || { x: 0, y: 0 };
  const nodeIds = new Set(graph.nodes.map(n => n.id));
  const before  = graph.relationships.length;
  graph.relationships = graph.relationships.filter(r => nodeIds.has(r.sourceId) && nodeIds.has(r.targetId));
  const dropped = before - graph.relationships.length;
  if (dropped > 0) console.warn(`  Dropped ${dropped} relationships with unknown node IDs`);
  return graph;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== bike-components.de Ontology Extraction via Gemini ===\n');
  console.log('Loading scraped documents...');
  const docs = loadDocuments();
  console.log(`Loaded ${docs.length} documents\n`);

  const corpus = buildCorpus(docs);
  const prompt = buildPrompt(corpus, docs.length);
  console.log(`Estimated prompt size: ~${Math.round(prompt.length / 4).toLocaleString()} tokens`);
  console.log('Calling Gemini...\n');

  const rawJson = await callGemini(prompt);

  console.log('\nParsing and validating...');
  const graph = validateAndClean(rawJson);

  console.log('\n=== Extraction Results ===');
  const nodesByType = {};
  for (const node of graph.nodes) nodesByType[node.type] = (nodesByType[node.type] || 0) + 1;
  for (const [type, count] of Object.entries(nodesByType)) {
    console.log(`  ${type.padEnd(16)} ${count} nodes`);
  }
  console.log('\n  Relationships:');
  const relsByType = {};
  for (const rel of graph.relationships) relsByType[rel.type] = (relsByType[rel.type] || 0) + 1;
  for (const [type, count] of Object.entries(relsByType)) console.log(`  ${type.padEnd(16)} ${count}`);
  console.log(`\n  Total: ${graph.nodes.length} nodes, ${graph.relationships.length} relationships`);

  writeFileSync(OUTPUT, JSON.stringify(graph, null, 2));
  console.log(`\nSaved: ${OUTPUT}`);
  console.log('\nNext: Open Terroir → Import → select data/bc-ontology-gemini.json');
}

main().catch(err => { console.error('\nFailed:', err.message); process.exit(1); });
