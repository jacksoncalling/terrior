/**
 * bike-components.de Scraper — Rennrad Category
 *
 * Scrapes road bike product pages from bike-components.de.
 * Uses JSON-LD Product schema as primary content source (clean, structured).
 * Falls back to body text extraction.
 *
 * robots.txt: no Disallow rules — full crawl permitted.
 *
 * Usage: node scripts/scrape-bc.mjs
 * Output: data/bc-raw/*.json
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUTPUT_DIR = join(__dirname, '..', 'data', 'bc-raw');
const DELAY_MS = 1800;

// --- Rennrad product URLs (page 1 of category, deduplicated by product ID) ---
const PRODUCT_URLS = [
  'https://www.bike-components.de/de/Scott/Foil-RC-30-28-Rennrad-p93835/?v=9536-ice-grey-progressive-grey',
  'https://www.bike-components.de/de/Scott/Foil-RC-20-28-Rennrad-p96222/?v=20392-black-chrome-brushed',
  'https://www.bike-components.de/de/Factor/OSTRO-V-A-M-2-0-Disc-Lionspeed-Limited-Red-Carbon-28-Rennrad-p219966/?v=54888-lionspeed',
  'https://www.bike-components.de/de/Specialized/Tarmac-SL8-Expert-Ultegra-Di2-Carbon-Rennrad-p96602/?v=23030-gloss-deep-lake-metallic-green-pearl-over-seafoam',
  'https://www.bike-components.de/de/Factor/MONZA-Force-PM-Carbon-Rennrad-28-p97165/?v=52559-solar-blue',
  'https://www.bike-components.de/de/Cannondale/SuperSix-Evo-3-Carbon-28-Rennrad-p229443/?v=58631-raw',
  'https://www.bike-components.de/de/Scott/Foil-RC-10-Carbon-28-Rennrad-p222849/?v=55418-carbon-black',
  'https://www.bike-components.de/de/Specialized/Tarmac-SL8-Comp-Di2-28-Carbon-Rennrad-p221824/?v=55008-satin-carbon-white',
  'https://www.bike-components.de/de/Specialized/Roubaix-SL8-Sport-Shimano-105-Carbon-Rennrad-p93342/?v=7540-metallic-obsidian-birch',
  'https://www.bike-components.de/de/Factor/MONZA-Ultegra-Carbon-28-Rennrad-p97166/?v=40300-solar-blue',
  'https://www.bike-components.de/de/Specialized/Tarmac-SL8-Pro-Force-AXS-28-Carbon-Rennrad-p246131/?v=61580-gloss-red-sky-chrome',
  'https://www.bike-components.de/de/Scott/Addict-RC-20-Carbon-28-Rennrad-p96221/?v=20388-carbon-black',
  'https://www.bike-components.de/de/Cannondale/CAAD14-3-28-Rennrad-p229436/?v=58640-chalk',
  'https://www.bike-components.de/de/Specialized/Roubaix-SL8-Comp-Di2-28-Carbon-Rennrad-p246106/?v=61545-gloss-glacial-metallic-white',
  'https://www.bike-components.de/de/Cervelo/S5-Force-AXS-Carbon-Rennrad-p223010/?v=55482-five-black',
  'https://www.bike-components.de/de/Wilier/Filante-SL-Carbon-Rennrad-p97158/?v=40205-silver-black',
  'https://www.bike-components.de/de/Factor/Raiden-Carbon-Trackbike-p97170/?v=40269-electric-blue',
  'https://www.bike-components.de/de/Cervelo/Caledonia-5-Rival-AXS-Carbon-Rennrad-p223011/?v=55483-emerald-cream',
  'https://www.bike-components.de/de/Cannondale/CAAD14-1-28-Rennrad-p229438/?v=58635-raw',
  'https://www.bike-components.de/de/Marin-Bikes/Nicasio-2-Gravelbike-p97090/?v=39358-red',
  'https://www.bike-components.de/de/Cervelo/Soloist-105-Di2-28-Carbon-Rennrad-p97074/?v=39318-azure',
  'https://www.bike-components.de/de/Scott/Addict-30-Carbon-28-Rennrad-p222859/?v=55416-cumulus-white',
];

// --- HTML helpers ---
function extractJsonLd(html) {
  const schemas = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try { schemas.push(JSON.parse(m[1].trim())); } catch {}
  }
  return schemas;
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

function extractMeta(html, name) {
  const re = new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i');
  const re2 = new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*name=["']${name}["']`, 'i');
  const m = html.match(re) || html.match(re2);
  return m ? m[1].trim() : '';
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, '\n\n## $2\n\n')
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n')
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1')
    .replace(/<td[^>]*>([\s\S]*?)<\/td>/gi, ' $1 |')
    .replace(/<tr[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&auml;/g, 'ä').replace(/&ouml;/g, 'ö').replace(/&uuml;/g, 'ü')
    .replace(/&Auml;/g, 'Ä').replace(/&Ouml;/g, 'Ö').replace(/&Uuml;/g, 'Ü')
    .replace(/&szlig;/g, 'ß').replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();
}

/**
 * Build a clean content string from JSON-LD Product schema + page text.
 * JSON-LD gives us structured specs; page text fills in description prose.
 */
function buildContent(html, schemas, title) {
  const parts = [];

  // --- JSON-LD Product schema ---
  const product = schemas.find(s => s['@type'] === 'Product' || s['@type']?.includes?.('Product'));
  if (product) {
    if (product.name) parts.push(`# ${product.name}`);
    if (product.brand?.name) parts.push(`Marke: ${product.brand.name}`);
    if (product.description) parts.push(`\n${product.description}`);

    // Price from offers
    const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
    if (offer?.price) parts.push(`Preis: ${offer.price} ${offer.priceCurrency || 'EUR'}`);

    // Additional properties (specs table)
    if (product.additionalProperty?.length) {
      parts.push('\n## Technische Daten');
      for (const prop of product.additionalProperty) {
        if (prop.name && prop.value) {
          parts.push(`${prop.name}: ${prop.value}`);
        }
      }
    }

    // Color/variant
    if (product.color) parts.push(`Farbe: ${product.color}`);
    if (product.material) parts.push(`Material: ${product.material}`);
  }

  // --- Fallback / supplement: extract body text for any prose not in JSON-LD ---
  // Focus on description-like sections by looking for long text blocks
  const bodyText = stripHtml(html);
  const usefulLines = bodyText
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 40 && l.length < 600) // skip nav/boilerplate (too short) and dumps (too long)
    .filter(l => !l.match(/^[\d€,. ]+$/)) // skip price-only lines
    .filter(l => !l.match(/^(In den Warenkorb|Warenkorb|Menge|Größe|Farbe:|Filter|Sortierung)/i))
    .slice(0, 30); // cap prose lines

  if (usefulLines.length > 0 && parts.length < 3) {
    // Only add body text if JSON-LD didn't give us much
    parts.push('\n## Beschreibung');
    parts.push(usefulLines.join('\n'));
  }

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// --- Fetch ---
async function fetchPage(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'TerriorResearchBot/1.0 (research project)',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'de-DE,de;q=0.9',
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// --- Main ---
async function main() {
  console.log('=== bike-components.de Rennrad Scraper ===\n');
  mkdirSync(OUTPUT_DIR, { recursive: true });

  let saved = 0, failed = 0;

  for (let i = 0; i < PRODUCT_URLS.length; i++) {
    const url = PRODUCT_URLS[i];
    const productId = url.match(/-p(\d+)\//)?.[1] || String(i);
    console.log(`[${i + 1}/${PRODUCT_URLS.length}] p${productId}`);
    console.log(`  ${url}`);

    try {
      const html = await fetchPage(url);
      const schemas = extractJsonLd(html);
      const title = extractTitle(html).replace(/\s*[\|\-–]\s*bike-components.*$/i, '').trim();
      const metaDesc = extractMeta(html, 'description');
      const content = buildContent(html, schemas, title);

      if (content.length < 100) {
        console.log(`  ⚠ Thin content (${content.length} chars), skipping`);
        failed++;
        await sleep(DELAY_MS);
        continue;
      }

      const filename = `rennrad_p${productId}.json`;
      const doc = {
        url,
        title: title || `Bike p${productId}`,
        metaDescription: metaDesc,
        section: 'rennrad',
        content,
        contentLength: content.length,
        scrapedAt: new Date().toISOString(),
      };

      writeFileSync(join(OUTPUT_DIR, filename), JSON.stringify(doc, null, 2), 'utf-8');
      console.log(`  ✓ ${filename} (${content.length} chars)`);
      saved++;
    } catch (err) {
      console.log(`  ✗ Failed: ${err.message}`);
      failed++;
    }

    await sleep(DELAY_MS);
  }

  console.log(`\n=== Done ===`);
  console.log(`Saved: ${saved} | Failed: ${failed}`);
  console.log(`Output: ${OUTPUT_DIR}`);
}

main().catch(console.error);
