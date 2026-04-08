# PLAN: Fix Entity Explosion

**Problem:** 15 documents → 1,200 entities. The graph becomes unusable — canvas chokes, relationships are noise, and the ontology captures mentions rather than concepts. The extraction prompt asks Gemini to "extract comprehensively" but gives no guidance on **granularity** — every named thing becomes a node.

**Secondary problem:** 120+ unique relationship types with inconsistent casing and near-duplicates (`HINDERS` / `hinders`, `contributes_to` / `CONTRIBUTES_TO`, `enables` / `ENHANCES`). This makes traversal unreliable and bloats the graph further.

**Root cause:** The abstraction layers (`domain_objects`, `interaction_patterns`, `concerns_themes`) control *what kind* of entities to extract but not *at what level of abstraction*. There is no entity budget, no consolidation instruction, and no canonical relationship vocabulary.

---

## Fix 1: Extraction granularity — prompt-level (high impact, low effort)

**File:** `src/lib/gemini.ts` → `buildExtractionPrompt()`

Add a granularity instruction block to all three abstraction layers AND the default path. The instruction tells Gemini to extract at the **concept level**, not the **mention level**.

**What to add (before the JSON schema in the prompt):**

```
GRANULARITY RULES:
- Extract at the CONCEPT level, not the MENTION level. If a document 
  mentions Slack, Teams, and Email as communication channels, create ONE 
  entity "Communication Stack" with the tools listed in the description — 
  not three separate entities.
- Each entity should represent a meaningful unit of organisational 
  knowledge that someone would want to navigate to, ask about, or track 
  over time. If it's just an example of something, it belongs in a 
  description, not as its own node.
- TARGET: aim for 15–40 entities per document. A 2000-word interview 
  transcript should yield ~20 entities. A 10-page strategy doc should 
  yield ~30–40. If you're producing more, you're too granular.
- Prefer FEWER entities with RICHER descriptions over many thin entities.
- When in doubt, ask: "Would someone search for this entity by name?" 
  If no, it's a detail that belongs in a parent entity's description.
```

**Estimated impact:** 50-70% reduction in entity count per document.

### Substeps
- [ ] Add granularity block to `buildExtractionPrompt()` — all 4 paths (domain_objects, interaction_patterns, concerns_themes, default)
- [ ] Test with one document that previously produced many entities
- [ ] Verify entity quality — fewer but richer descriptions

---

## Fix 2: Canonical relationship types — prompt + code (medium impact, medium effort)

**Files:** `src/lib/gemini.ts` → `buildExtractionPrompt()` + `assembleGraph()`

### 2a. Define a canonical relationship vocabulary

Instead of allowing freeform relationship types, provide Gemini with a curated set. The set should be small enough to be consistent but flexible enough to cover organisational ontology.

**Canonical set (17 types):**

| Relationship | Use for |
|---|---|
| `enables` | X makes Y possible |
| `depends_on` | X needs Y but Y is not sufficient on its own |
| `requires` | X cannot function without Y (hard prerequisite) |
| `part_of` | X is contained in Y |
| `type_of` | X is a specialisation of Y |
| `implements` | X is a concrete realisation of Y (method→practice, concept→feature) |
| `informs` | X provides input/context to Y |
| `challenges` | X creates tension with Y |
| `addresses` | X responds to or mitigates Y |
| `produces` | X generates Y as output |
| `uses` | X employs Y as a tool/method |
| `guides` | X shapes or directs Y |
| `contrasts_with` | X is in opposition to Y |
| `evolves_into` | X transforms into Y over time |
| `exemplifies` | X is a concrete instance of Y |
| `supports` | X reinforces or strengthens Y |
| `threatens` | X puts Y at risk |

**What to add to the extraction prompt:**

```
RELATIONSHIP TYPES — use ONLY from this list:
enables, depends_on, requires, part_of, type_of, implements, informs, 
challenges, addresses, produces, uses, guides, contrasts_with, 
evolves_into, exemplifies, supports, threatens

Choose the closest match. Use lowercase only. If none fit, use 
"relates_to" as a last resort, but this should be rare (<10% of edges).

The "description" field on the relationship is where nuance goes — 
the type is for traversal, the description is for understanding.
```

**Language rule:**

```
LANGUAGE: Entity labels and descriptions may be in German or English — 
preserve the original language of the source material. 
Relationship TYPES must always be English (from the list above). 
Relationship DESCRIPTIONS can be in the source language.
```

### 2b. Normalise on save (code)

In `assembleGraph()`, add a normalisation step that lowercases relationship types and maps known synonyms to canonical forms. This catches any Gemini drift.

```typescript
const REL_SYNONYMS: Record<string, string> = {
  // → challenges
  'hinders': 'challenges',
  'blocks': 'challenges',
  'inhibits': 'challenges',
  'threatens': 'threatens',
  // → enables
  'drives': 'enables',
  'facilitates': 'enables',
  'fosters': 'enables',
  // → depends_on
  'is_required_for': 'depends_on',
  'prerequisite_for': 'depends_on',
  // → requires
  'requires': 'requires',
  // → type_of
  'is_a_form_of': 'type_of',
  'is_a_type_of': 'type_of',
  'is_a': 'type_of',
  // → implements
  'is_an_implementation_of': 'implements',
  'is_a_method_for': 'implements',
  'is_a_practice_for': 'implements',
  // → supports
  'contributes_to': 'supports',
  'enhances': 'supports',
  'strengthens': 'supports',
  // → part_of
  'is_a_part_of': 'part_of',
  'is_a_component_of': 'part_of',
  'includes': 'part_of',  // reversed — flagged in description
  // → produces
  'creates': 'produces',
  'generates': 'produces',
  'is_an_output_of': 'produces',
  // → informs
  'influences': 'informs',
  'feeds_into': 'informs',
  // → guides
  'governs': 'guides',
  'shapes': 'guides',
  // → addresses
  'mitigates': 'addresses',
  'addressed_by': 'addresses',
  'mitigated_by': 'addresses',
  // → uses
  'utilizes': 'uses',
  'leverages': 'uses',
  // → exemplifies
  'demonstrated_by': 'exemplifies',
  'illustrated_by': 'exemplifies',
  // → contrasts_with
  'is_opposed_to': 'contrasts_with',
  'is_distinct_from': 'contrasts_with',
  // German verbs that might leak through
  'ermöglicht': 'enables',
  'erfordert': 'requires',
  'unterstützt': 'supports',
  'bedroht': 'threatens',
  'verwendet': 'uses',
  'erzeugt': 'produces',
};

function normaliseRelType(raw: string): string {
  const lower = raw.toLowerCase().replace(/\s+/g, '_');
  return REL_SYNONYMS[lower] ?? lower;
}
```

### 2c. Also apply to integration prompt

**File:** `src/lib/gemini.ts` → `buildIntegrationPrompt()`

Line 746 currently says: `type: short verb phrase (e.g. "enables", "depends_on", "challenges", "informs")`

Replace with the same canonical list to keep integration-generated relationships consistent.

### Substeps
- [ ] Define canonical relationship set as a const in `gemini.ts`
- [ ] Add relationship vocabulary instruction to extraction prompt
- [ ] Add `normaliseRelType()` to `assembleGraph()`
- [ ] Apply same vocabulary to integration prompt
- [ ] Apply same normalisation to integration output assembly
- [ ] Test: re-extract a document, verify relationship types are from canonical set

---

## Fix 3: Entity budget enforcement — code-level (medium impact, low effort)

**File:** `src/lib/gemini.ts` → `buildExtractionPrompt()`

Make the entity target dynamic based on document length:

```typescript
function estimateEntityBudget(textLength: number): { min: number; max: number } {
  const words = Math.ceil(textLength / 5); // rough word count
  if (words < 1000) return { min: 8, max: 20 };
  if (words < 3000) return { min: 15, max: 35 };
  if (words < 8000) return { min: 20, max: 50 };
  return { min: 25, max: 60 };
}
```

Add to prompt: `"TARGET: extract between ${budget.min} and ${budget.max} entities for this document length. Quality over quantity."`

### Substeps
- [ ] Add `estimateEntityBudget()` function
- [ ] Inject budget into extraction prompt dynamically
- [ ] Test with short and long documents

---

## Fix 4: Retroactive consolidation — integration pass upgrade (lower priority)

**File:** `src/lib/gemini.ts` → `buildIntegrationPrompt()`

The integration pass currently merges exact/near duplicates. Add a **consolidation phase** between merge and cross-doc relationships:

```
### Phase 1.5: Entity Consolidation
Identify clusters of fine-grained entities that should be consolidated 
into a single higher-level concept. For example, if you see "Slack", 
"Microsoft Teams", and "Email" as separate entities, propose 
consolidating them into "Communication Tools" with the originals 
mentioned in the description.

Rules:
- Only consolidate when the individual entities add no independent 
  navigational value
- The consolidated entity inherits the most specific hub assignment
- Original labels must be preserved in the description
```

This catches entity explosion that slipped through Fix 1 (e.g., when extracting without the updated prompts, or legacy data).

### Substeps
- [ ] Add consolidation phase to integration prompt
- [ ] Update `IntegrationOutput` type to include consolidation groups
- [ ] Implement `executeConsolidation()` in `supabase.ts` — create parent, re-point rels, delete children
- [ ] Wire into the integration API route
- [ ] Test with an existing over-extracted project

---

## Implementation order

1. **Fix 1 (granularity prompt)** — do first, biggest bang for effort
2. **Fix 2a+2b (relationship normalisation)** — do second, also prompt + small code
3. **Fix 3 (entity budget)** — do third, refines Fix 1
4. **Fix 2c (integration prompt)** — do alongside Fix 2a
5. **Fix 4 (retroactive consolidation)** — do last, only if Fix 1+3 don't sufficiently solve the problem

**Total effort estimate:** Fixes 1-3 = one focused session. Fix 4 = separate session.

---

## Success criteria

- A 15-document corpus that previously produced ~1,200 entities should produce **200–400** entities
- Relationship types should be from a set of 17 canonical types + `relates_to` fallback (<10% of edges)
- Graph should be navigable in the canvas without compact mode for corpora under 10 documents
- No loss of information — details that were previously nodes should now live in descriptions
