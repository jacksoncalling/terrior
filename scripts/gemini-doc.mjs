const API_KEY = 'AIzaSyCW6LmzBTkYHelCLiimuJXcbagib-UlW0E';
const MODEL = 'gemini-2.5-flash';

const prompt = `You are a technical writer helping document an experiment comparing two RAG (Retrieval-Augmented Generation) architectures.

## The Experiment

We built two retrieval systems on top of Babor Beauty Group's German website content (66 scraped pages, ~236 chunks in Supabase with pgvector):

**Vector RAG**: Embeds the raw query → searches vector store → returns top-5 chunks by cosine similarity

**Ontology-Guided RAG**: 
1. Keyword-matches the query against a knowledge graph (63 nodes, 95 relationships, extracted by Gemini from the same corpus)
2. Traverses the graph up to 2 hops to find connected entities
3. Builds an expanded query string (original query + entity descriptions + relationship context + related node labels)
4. Embeds the *expanded* query → searches same vector store → returns top-5 chunks

Embedding model: all-MiniLM-L6-v2 (384 dims, English-trained, running locally)
Corpus language: German
Similarity metric: cosine similarity, displayed as %

## Query 1: "Eye care" 

**Vector RAG results (post-dedup):**
- #1 48.0% — Generic product catalog/listing page (no eye care content)
- #2 47.1% — Same generic listing page (different URL, same boilerplate)
- #3 47.0% — SPF/sun products page
- #4 46.9% — Same generic listing page again
- #5 46.9% — Category navigation page

**Ontology-Guided RAG results:**
- Matched entities: Eye Care, DOCTOR BABOR, Doctor Babor Collagen-Peptide Booster Cream, Skinovage, Masking
- 30 graph hops traversed
- #1 65.3% — Product catalog with Doctor Babor line
- #2 58.8% — Contains "Skinovage Instant Fresh Smooth Eye Serum + Patches — Das perfekte Duo für intensive Feuchtigkeit" (directly relevant eye product!)
- #3 57.8% — SPF products
- #4 56.0% — Blog listing page
- #5 55.5% — Blog listing page

## Query 2: "Which products are best for sensitive and dehydrated skin?"

**Vector RAG results:**
- #1 49.2% — Gift/product catalog page (contains Collagen-Peptide Booster, general)
- #2 47.7% — Another catalog page with Derma Filler Serum, Rose Toner
- #3 47.2% — General bestseller page
- #4 46.9% — General bestseller/makeup page
- #5 43.4% — Homepage highlights

**Ontology-Guided RAG results:**
- Matched entities: Sensitive Skin, Toning, Eye Care, Sun Protection, Postbiotics
- 17 graph hops traversed
- #1 68.7% — Product catalog with Empfindliche Haut (Sensitive Skin) filter
- #2 61.3% — Contains Doctor Babor Instant Soothing Ampoule (for sensitive/reactive skin), Cleansing Soothing Rose Toner, Hydra Plus (for dehydrated skin) — highly relevant!
- #3 59.3% — SPF products
- #4 58.7% — Contains Skinovage Eye Serum, Probiotika/Postbiotika article (relevant to sensitive skin microbiome)
- #5 56.6% — Blog content

## Known Limitations
- Corpus is German, embedding model is English-trained → both systems are equally handicapped
- Many scraped pages are e-commerce listing/catalog pages with minimal semantic content → creates noise
- Chunks are titled "Untitled" because scraper didn't always extract page titles
- No LLM re-ranking step — raw vector similarity only

---

Write a SHORT technical write-up (max 400 words) in English covering:
1. What we built and why
2. Key findings from the two queries (be specific about the numbers and what was actually retrieved)
3. Why ontology-guided RAG outperformed (mechanistic explanation)
4. Honest limitations of this test
5. One sentence on what the next harder test should be

Keep it tight. No fluff. This is for a technical audience who built this themselves.`;

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
if (!response.ok) {
  console.error('Gemini error:', JSON.stringify(data, null, 2));
  process.exit(1);
}

const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
console.log('\n=== GEMINI DOCUMENTATION ===\n');
console.log(text);
