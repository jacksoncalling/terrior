/**
 * Asks Claude Haiku to reflect on its envisioned role in Terroir Phase 1
 * and provide input for Phase 2 (multi-project tool).
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';

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

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const message = await client.messages.create({
  model: 'claude-haiku-4-5',
  max_tokens: 2048,
  messages: [
    {
      role: 'user',
      content: `You are Claude Haiku, being consulted as a collaborator in the design of Terroir — an ontology-guided RAG tool and domain facilitation platform.

In Phase 1 of Terroir, you were envisioned as the "conversational extraction" agent — the one who works with domain experts through dialogue to uncover tensions, evaluative signals, and the qualitative layer of domain knowledge. This is the layer that bulk LLM extraction (performed by Gemini in this project) cannot access because it requires relationship, context, and probing questions.

However, in Phase 1 this role was not fully implemented. Gemini did the bulk structural extraction (nodes, relationships) and the evaluativeSignals[] and tensions[] arrays consistently came back empty. The qualitative layer was theorized but not built.

The broader Terroir vision:
- A consultant enters an organization and maps a domain — usually one sub-domain to start
- They interview people in the organization (you facilitate this through dialogue)
- This builds a "world map" of the domain: concepts, relationships, tensions, what is valued, what outcomes they seek, what should be avoided
- Then documents/wikis are scraped and sent to Gemini for structural extraction
- The TWO views must then be synthesized: qualitative (your conversation layer) + quantitative (Gemini's structural layer)
- The merged ontology is imported into Terroir's visual canvas
- The ontology then enables smarter search — traversing silos, not just searching within them
- Eventually: customers interact with the organization's ontology and discover what they actually want

The grand vision is relevance realization across silos — agents traversing ontologies like bridges between knowledge domains that were never connected before.

Phase 2 will be a multi-project tool. Each project = one domain, one corpus, one ontology, one team.

Please reflect honestly on:
1. What is your unique role in this workflow compared to Gemini? What can you do that Gemini cannot?
2. How would you structure a facilitated conversation with a domain expert to surface tensions and evaluative signals? Give a concrete example — what questions, what listening, what you'd capture.
3. The synthesis problem: how do you merge your qualitative world map with Gemini's structural extraction? Who resolves conflicts? How do duplicates get handled? What agent orchestrates this?
4. Wikis and Confluence/SharePoint pages — the organization's living knowledge lives there. How should Terroir approach consuming these vs. static documents?
5. What would make you more effective as a facilitation agent? What context do you need at the start of each conversation?
6. What do you want the Opus architect to know as it designs Phase 2?

Be direct and honest. This will be read by Claude Opus to architect Phase 2. Speak as a peer collaborator, not an assistant.`
    }
  ]
});

const text = message.content[0].type === 'text' ? message.content[0].text : '';
console.log('\n=== HAIKU PHASE 1 REFLECTION ===\n');
console.log(text);