const API_KEY = 'AIzaSyCW6LmzBTkYHelCLiimuJXcbagib-UlW0E';
const MODEL = 'gemini-2.5-flash';

const prompt = `You previously wrote a technical write-up about a Vector RAG vs Ontology-Guided RAG experiment on Babor Beauty Group's German website corpus (66 pages, ~236 chunks, all-MiniLM-L6-v2 embeddings, English-trained model).

We ran a fourth query that produced the most dramatic finding of the experiment. Please write a short addendum (max 200 words) to the original write-up covering this result.

## New Query: "Retinol aging skin" (English query, German corpus)

**Vector RAG:**
- #1: 13.7% — Press login page
- #2: 8.9% — Flood disaster donation page  
- #3: 8.7% — Legal/Impressum page
→ Complete failure. The English-trained model has near-zero cosine similarity between English "Retinol aging skin" and German product text.

**Ontology-Guided RAG:**
- 5 nodes matched: Retinol, Skinovage, Mature Skin, Weakened Skin Barrier, Wrinkles
- 25 graph hops traversed
- #1: 63.3% — Product catalog with DOCTOR BABOR line
- #2: 59.2% — Contains Doctor Babor Collagen-Peptide Booster Cream, Skinovage Eye Serum, relevant products
- #3–5: 55–56% — Blog content

**The emergent mechanism (not designed in):**
The graph is acting as a cross-lingual bridge through product names. Product names like "Doctor Babor Collagen-Peptide Booster Cream" and "HSR Lifting Anti-Wrinkle Cream" are language-invariant — they appear identically in both the English ontology nodes and the German corpus chunks. So:

English query → English ontology node labels match → graph traversal populates expanded query with product names → those product names appear verbatim in German chunks → embedding of expanded query lands near German documents → 63% match

Neither system was designed for cross-lingual retrieval. The ontology accidentally solves it by using product names as language-invariant anchors.

Write the addendum now. Be precise about the numbers. Call out that this was emergent, not engineered. End with one sentence on what this implies for multilingual RAG design.`;

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
console.log('\n=== GEMINI ADDENDUM ===\n');
console.log(text);
