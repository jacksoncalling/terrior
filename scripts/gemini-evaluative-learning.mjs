const API_KEY = 'AIzaSyCW6LmzBTkYHelCLiimuJXcbagib-UlW0E';
const MODEL = 'gemini-2.5-flash';

const prompt = `You are writing a technical learning document for a builder who is developing an ontology-guided RAG system using a tool called Terroir (a knowledge graph canvas). Help capture an important architectural insight they just had.

## Context: What Terroir Actually Is

Terroir is a knowledge graph tool originally designed for organizational knowledge discovery. An AI (Claude Haiku) has a *conversational* session with a human, and as the human tells stories about their organization, Haiku extracts a rich graph with four layers:

**Layer 1: Nodes** (entities with label, type, description)
**Layer 2: Relationships** (typed edges between nodes)
**Layer 3: TensionMarkers** — conflicts or unresolved divergences in the knowledge domain
  \`{ description: string, relatedNodeIds: string[], status: "unresolved" | "resolved" }\`
**Layer 4: EvaluativeSignals** — what the system/org is oriented toward, away from, or protecting
  \`{ label: string, direction: "toward" | "away_from" | "protecting", strength: 1-5, sourceDescription: string }\`

The evaluative layer draws from complexity theory (Bonnitta Roy's work on dispositional states — organizations as processes with directional orientation, not just structures). An evaluative signal is not a tag or a score; it is a *directional property* of the knowledge system. The system is "moving toward" something, "protecting" something, or "moving away from" something.

## What Actually Happened in the RAG Experiment

When we extracted the Babor and bike-components ontologies using **Gemini bulk extraction** (send all scraped documents in one prompt, get back nodes + relationships), we got:
- ✅ Nodes (63 entities)
- ✅ Relationships (95 edges)  
- ❌ No TensionMarkers
- ❌ No EvaluativeSignals

The compare page tested Vector RAG vs Ontology-Guided RAG using only the structural layer (nodes + relationships). The evaluative layer was completely absent.

When Max used Terroir *conversationally* with Haiku about his own business/coaching practice, the result included:
- 20 entities, 30 relationships
- 2 unresolved tensions (e.g., "employee health during upheaval")
- 3 evaluative signals (e.g., "financial stability during practice building" — protecting, strength 4)

## The New Insight: Evaluative Layer in RAG

Max's insight: for a real deployment (e.g., bike-components.de — a German e-commerce shop for bike parts), the shop owner has evaluative orientations that should influence retrieval ranking:

**Tensions example:**
- "Trek Madone overstock vs. premium brand positioning" [unresolved] — certain bikes need to move fast but surfacing them too aggressively damages brand perception
- "Price-sensitive new customers vs. enthusiast high-margin customers" — different query intents should be resolved differently

**Evaluative signal examples:**
- "Inventory clearance" → direction: toward, strength: 4 — bikes with high stock should surface higher in ambiguous queries
- "Premium brand positioning" → direction: protecting, strength: 5 — flagship products shouldn't be buried even if similarity score is lower
- "New customer acquisition" → direction: toward, strength: 3 — beginner-friendly framing preferred when query is ambiguous about expertise level

These signals could re-rank retrieval results *after* cosine similarity scoring. A result with similarity 62% for a bike with inventory pressure + "toward clearance" signal should outrank a 65% result for a bike with no pressure.

## The Architectural Gap

The current RAG pipeline uses:
  query → embed → cosine similarity → top-5 → display

With evaluative layer it becomes:
  query → embed → cosine similarity → top-N → re-rank by evaluative signals → top-5 → display

The evaluative layer is *operator knowledge* — it doesn't come from the scraped corpus (documents don't say "this bike needs to sell fast"). It comes from a conversation between the shop owner and the Terroir AI. This is the layer that Gemini batch extraction cannot produce.

## The Two Extraction Modes

| Mode | What it produces | How |
|------|-----------------|-----|
| Gemini bulk extraction | Nodes + Relationships only | One-shot prompt over all documents |
| Haiku conversational extraction | Nodes + Relationships + Tensions + Evaluative Signals | Multi-turn dialogue with human |

The conversational mode is slower but captures the *orientation* of the knowledge system — what it cares about, what it's trying to protect, what it's moving away from. This is what makes the ontology a living representation of the organization rather than a static schema.

---

Write a learning document (max 350 words) covering:
1. What the evaluative layer is and where it comes from (complexity theory / Bonnitta Roy / dispositional states)
2. Why Gemini bulk extraction misses it and always will
3. The concrete bike-components example of how tensions + evaluative signals would change retrieval ranking
4. The architectural implication: the full RAG pipeline needs both extraction modes
5. One sentence on what to build next to test this

Be precise. No fluff.`;

const response = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3 }
    })
  }
);

const data = await response.json();
if (!response.ok) { console.error(JSON.stringify(data, null, 2)); process.exit(1); }
const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
console.log(text);
