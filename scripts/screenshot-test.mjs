#!/usr/bin/env node
/**
 * screenshot-test.mjs — visual smoke test for the published site.
 *
 * Boots serve.mjs, asserts the three key pages respond and contain their
 * anchor content, and captures full-page screenshots for eyeballing.
 *
 *   node scripts/screenshot-test.mjs [--out <dir>]
 *
 * Requires playwright (not a project dependency — install ad hoc):
 *   npm install --no-save playwright
 * Uses the system Chromium when PLAYWRIGHT_BROWSERS_PATH is set (CI/sandbox)
 * or the default playwright browser locally.
 *
 * Exit code 0 = every page rendered and every assertion held.
 */

import { spawn } from 'child_process';
import { mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = 3456;
const BASE = `http://localhost:${PORT}`;

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const OUT_DIR = outIdx >= 0 ? args[outIdx + 1] : join(ROOT, 'screenshots');
mkdirSync(OUT_DIR, { recursive: true });

// Pages to test: [route, screenshot name, assertions on page content]
const manifest = JSON.parse(readFileSync(join(ROOT, 'data', 'articles.json'), 'utf8'));
if (!manifest.length) { console.error('✗ data/articles.json is empty — publish something first'); process.exit(1); }
const first = manifest[0];

const CASES = [
  { route: '/', name: 'landing', expects: ['Daivik Vani', 'href="/articles/"'] },
  { route: '/articles/', name: 'listing', expects: ['Articles', first.title] },
  { route: `/articles/${first.slug}.html`, name: `article-${first.slug}`, expects: [first.title, 'application/ld+json', '<h2>'] },
];

async function main() {
  const { chromium } = await import('playwright').catch(() => {
    console.error('✗ playwright not installed. Run: npm install --no-save playwright');
    process.exit(1);
  });

  const server = spawn('node', [join(ROOT, 'serve.mjs')], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));

  let failed = 0;
  // CHROMIUM_PATH lets a sandbox/CI point at a system chromium when the
  // playwright-managed browser build isn't present.
  const executablePath = process.env.CHROMIUM_PATH || undefined;
  const browser = await chromium.launch({ executablePath });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    for (const c of CASES) {
      const res = await page.goto(BASE + c.route, { waitUntil: 'load', timeout: 15000 });
      const status = res?.status() ?? 0;
      const html = await page.content();
      const misses = c.expects.filter(e => !html.includes(e));
      const shot = join(OUT_DIR, `${c.name}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      if (status !== 200 || misses.length) {
        failed++;
        console.error(`✗ ${c.route} status=${status}${misses.length ? ` missing: ${misses.join(' | ')}` : ''} → ${shot}`);
      } else {
        console.log(`✓ ${c.route} (200, ${c.expects.length} assertions) → ${shot}`);
      }
    }
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(failed ? `\n${failed} page(s) FAILED` : '\nAll pages rendered ✓');
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
