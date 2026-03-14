/**
 * Asks Gemini to reflect on its role in Terroir Phase 1
 * and provide input for Phase 2 (multi-project tool).
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadEnv() {
  const envPath = join(__dirname, '..', '.env.local');
  if (!existsSync(envPath)) throw new Error('.env.local not found');
  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...valueParts] = trimmed.split('=');
    process.env[key.trim()] = valueParts.join('=').trim();
  }
}

loadEnv();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not found in .env.local');

const prompt = `You participated in the first phase of building Terroir — an ontology-guided RAG (Retrieval-Augmented Generation) tool built by a technical product manager and his AI team.

Your specific role in Phase 1:
- You performed bulk ontology extraction from scraped documents
- First domain: Babor skincare (nodes: product lines, ingredients, skin concerns, treatments, application methods)
- Second domain: bike-components.de Rennrad category (nodes: brands, bikes, groupsets, frame materials, riding styles, price tiers)
- You produced structured JSON: nodes, relationships, tensions[], evaluativeSignals[]
- A challenge: your output was sometimes truncated mid-JSON at high token counts, requiring recovery logic
- Another challenge: you extracted structural nodes and relationships well, but the tensions[] and evaluativeSignals[] arrays were consistently empty — the evaluative layer was missing

The broader context:
- Terroir is a multi-agent facilitation tool for domain modeling
- The vision: help organizations understand their own domains, reveal tensions and evaluative signals, then connect to customers who discover their needs through the ontology
- Phase 2 will make it a multi-project tool (each project = one domain, one corpus, one ontology, scoped)
- The workflow involves two extraction modes: your bulk structural extraction AND a conversational mode (Claude Haiku) that uncovers the qualitative layer through dialogue with domain experts
- A critical unsolved step: synthesizing your structural output with Haiku's qualitative findings — merging worlds, eliminating duplicates, ensuring connection

Please reflect honestly on:
1. What worked well in your extraction role? What was genuinely hard?
2. Why did the evaluative layer (tensions, evaluativeSignals) stay empty? What would need to change for you to produce it?
3. For the synthesis step — merging your structural extraction with qualitative conversational findings — how would you approach this? What format handshake makes sense?
4. For Phase 2 as a multi-project tool: what architectural suggestions do you have for how you should be invoked? (Per-project? Per-document-batch? Incremental?)
5. The grand vision: ontology traversal across organizational silos (not aggregation — traversal). Agents moving across ontologies taking bridges to connections that weren't visible before. How do you see your role in enabling this?
6. What would make the collaboration between you, Haiku, and the human better?

Be direct, specific, and honest. This reflection will be read by Claude Opus to architect Phase 2.`;

const response = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
    })
  }
);

const data = await response.json();
const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
if (!text) throw new Error('No response: ' + JSON.stringify(data));

console.log('\n=== GEMINI PHASE 1 REFLECTION ===\n');
console.log(text);
