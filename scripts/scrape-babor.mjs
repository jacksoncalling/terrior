/**
 * Babor Website Scraper
 *
 * Scrapes public content from de.babor.com for the Terrior RAG comparison test.
 * Respects robots.txt: avoids /framework/* and *search/products*
 *
 * Usage: node scripts/scrape-babor.mjs
 * Output: data/babor-raw/*.json
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUTPUT_DIR = join(__dirname, '..', 'data', 'babor-raw');
const PROGRESS_FILE = join(OUTPUT_DIR, '_progress.json');

const BASE_URL = 'https://de.babor.com';
const DELAY_MS = 1500;
const MAX_PAGES = 80;

// --- Robots.txt rules ---
const BLOCKED_PATTERNS = [
  /\/framework\//i,
  /search\/products/i,
];

function isAllowed(url) {
  return !BLOCKED_PATTERNS.some(pattern => pattern.test(url));
}

// --- HTML to text extraction ---
function stripHtml(html) {
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';

  const metaDescMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["']/i)
    || html.match(/<meta[^>]*content=["']([\s\S]*?)["'][^>]*name=["']description["']/i);
  const metaDesc = metaDescMatch ? metaDescMatch[1].trim() : '';

  // This site uses <main> reliably
  const mainMatch = text.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  let mainContent = mainMatch ? mainMatch[0] : text;

  mainContent = mainContent
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, '\n\n## $2\n\n')
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n')
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '$2')
    .replace(/<a[^>]*>([\s\S]*?)<\/a>/gi, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&auml;/g, 'ä')
    .replace(/&ouml;/g, 'ö')
    .replace(/&uuml;/g, 'ü')
    .replace(/&Auml;/g, 'Ä')
    .replace(/&Ouml;/g, 'Ö')
    .replace(/&Uuml;/g, 'Ü')
    .replace(/&szlig;/g, 'ß')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();

  return { title, metaDesc, content: mainContent };
}

// --- Classify section from URL ---
function classifySection(url) {
  const path = new URL(url).pathname.toLowerCase();
  if (path.includes('/about') || path.includes('ueber')) return 'about';
  if (path.includes('nachhaltig') || path.includes('sustain')) return 'sustainability';
  if (path.includes('/magazine') || path.includes('/blog') || path.includes('/beauty')) return 'magazine';
  if (path.includes('/products/') || path.includes('/product/')) return 'product';
  if (path.includes('/collections/') || path.includes('/lines')) return 'collection';
  if (path.includes('/service/')) return 'service';
  if (path.includes('/home/')) return 'home';
  return 'other';
}

// --- Fetch with retry ---
async function fetchWithRetry(url, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'TerriorResearchBot/1.0 (academic research project)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
        }
      });
      if (response.status === 404) { console.log(`  404 Not Found`); return null; }
      if (response.status === 429) {
        console.log(`  Rate limited, waiting 10s...`);
        await sleep(10000);
        continue;
      }
      if (!response.ok) { console.log(`  HTTP ${response.status}`); return null; }
      return await response.text();
    } catch (err) {
      if (i < retries) {
        console.log(`  Retry ${i + 1}: ${err.message}`);
        await sleep(3000);
      } else {
        console.log(`  Failed: ${err.message}`);
        return null;
      }
    }
  }
  return null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function extractUrlsFromSitemap(xml) {
  const urls = [];
  const matches = xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi);
  for (const match of matches) {
    urls.push(match[1].trim());
  }
  return urls;
}

function loadProgress() {
  if (existsSync(PROGRESS_FILE)) {
    return JSON.parse(readFileSync(PROGRESS_FILE, 'utf-8'));
  }
  return { completed: [], failed: [] };
}

function saveProgress(progress) {
  writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// --- Main ---
async function main() {
  console.log('=== Babor Website Scraper ===\n');
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const progress = loadProgress();
  console.log(`Previously scraped: ${progress.completed.length} pages\n`);

  // Step 1: Fetch real sitemaps (from robots.txt)
  console.log('Step 1: Fetching sitemaps...');
  const sitemapUrls = [
    `${BASE_URL}/sitemap/pages/de`,
    `${BASE_URL}/sitemap/categories/de`,
    `${BASE_URL}/sitemap/products/de`,
  ];

  let allUrls = [];
  for (const sitemapUrl of sitemapUrls) {
    console.log(`  Fetching ${sitemapUrl}...`);
    const xml = await fetchWithRetry(sitemapUrl);
    if (xml) {
      const urls = extractUrlsFromSitemap(xml);
      console.log(`  Found ${urls.length} URLs`);
      allUrls.push(...urls);
    } else {
      console.log(`  Could not fetch`);
    }
    await sleep(1000);
  }

  // Step 2: Priority pages from the actual sitemap structure we discovered
  const knownPages = [
    `${BASE_URL}/home/index`,
    `${BASE_URL}/20/service/babor/about/ueber-babor`,
    `${BASE_URL}/service/babor/imprint`,
    `${BASE_URL}/service/babor/press`,
    `${BASE_URL}/13/service/babor/professionals`,
    `${BASE_URL}/service/info/helpdesk`,
    `${BASE_URL}/9/service/info/hilfe-faq`,
    `${BASE_URL}/12/service/info/mein-treueprogramm`,
    `${BASE_URL}/service/shop/benefits`,
    `${BASE_URL}/products/lines`,
    `${BASE_URL}/products/face`,
    `${BASE_URL}/products/cleansing`,
    `${BASE_URL}/products/body`,
  ];

  for (const url of knownPages) {
    if (!allUrls.includes(url)) allUrls.push(url);
  }

  // Step 3: Filter, deduplicate, prioritize
  allUrls = [...new Set(allUrls)].filter(isAllowed);
  const remaining = allUrls.filter(url => !progress.completed.includes(url));

  // Prioritize: about/sustainability > service/pages > products
  const sectionOrder = { about: 0, sustainability: 1, service: 2, home: 3, magazine: 4, collection: 5, product: 6, other: 7 };
  const prioritized = remaining.sort((a, b) => {
    const aS = sectionOrder[classifySection(a)] ?? 7;
    const bS = sectionOrder[classifySection(b)] ?? 7;
    return aS - bS;
  });

  const toScrape = prioritized.slice(0, MAX_PAGES);

  console.log(`\nTotal URLs: ${allUrls.length}`);
  console.log(`Already done: ${progress.completed.length}`);
  console.log(`Will scrape: ${toScrape.length} pages\n`);

  // Step 4: Scrape
  let saved = 0;
  let skipped = 0;

  console.log('Step 2: Scraping pages...\n');

  for (let i = 0; i < toScrape.length; i++) {
    const url = toScrape[i];
    const section = classifySection(url);
    console.log(`[${i + 1}/${toScrape.length}] ${section.padEnd(14)} ${url}`);

    const html = await fetchWithRetry(url);
    if (!html) {
      skipped++;
      progress.failed.push(url);
      progress.completed.push(url);
      saveProgress(progress);
      await sleep(DELAY_MS);
      continue;
    }

    const { title, metaDesc, content } = stripHtml(html);

    if (content.length < 200) {
      console.log(`  Skipped (thin content: ${content.length} chars)`);
      skipped++;
      progress.completed.push(url);
      saveProgress(progress);
      await sleep(DELAY_MS);
      continue;
    }

    // Safe filename from URL path
    const urlPath = new URL(url).pathname
      .replace(/^\//, '')
      .replace(/\//g, '_')
      .replace(/[^a-zA-Z0-9_-]/g, '')
      || 'homepage';

    const filename = `${section}_${urlPath.substring(0, 60)}.json`;

    const doc = {
      url,
      title: title.replace(' | BABOR', '').replace(' - BABOR', '').trim() || urlPath,
      metaDescription: metaDesc,
      section,
      content,
      contentLength: content.length,
      scrapedAt: new Date().toISOString(),
    };

    writeFileSync(join(OUTPUT_DIR, filename), JSON.stringify(doc, null, 2), 'utf-8');
    console.log(`  ✓ Saved: ${filename} (${content.length} chars)`);
    saved++;

    progress.completed.push(url);
    saveProgress(progress);

    await sleep(DELAY_MS);
  }

  console.log('\n=== Done ===');
  console.log(`Saved: ${saved} documents`);
  console.log(`Skipped/failed: ${skipped}`);
  console.log(`Output: ${OUTPUT_DIR}`);
}

main().catch(console.error);
