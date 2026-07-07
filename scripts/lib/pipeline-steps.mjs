/**
 * pipeline-steps.mjs — the run() implementation for each step. Kept separate
 * from pipeline-status.mjs so the status/dashboard path stays free of the LLM
 * stack. The two LLM steps (bundle, sections) lazy-import the Vertex helper so
 * the entire deterministic pipeline runs with no credentials or @google/genai.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

import {
  ARTIFACT_DIR, PAGES_DIR, MANIFEST_PATH, LISTING_PATH, DV_STATE_PATH, SITEMAP_PATH,
  isPlaceholder, bundleSliceOk, sectionsValid, sectionValid,
  placeholderPaths, readSeeds, listArtifactSlugs, verifyContract,
} from './pipeline-status.mjs';
import {
  renderArticleBody, renderArticlePage, renderListingPage, manifestEntry,
  renderDvState, renderSitemap, countWords,
} from './render-article.mjs';

const RETRY_CAP = 3;

function nowSql() { return new Date().toISOString().replace('T', ' ').replace(/\..*/, ''); }
function ensureDir(p) { if (!existsSync(p)) mkdirSync(p, { recursive: true }); }

// ── seed ─────────────────────────────────────────────────────────────────────
async function runSeed(ctx, db) {
  const seed = readSeeds().find(s => s.slug === ctx.slug);
  if (!seed) throw new Error(`no seed topic and no artifact for "${ctx.slug}"`);
  db.prepare(`
    INSERT INTO articles (slug, topic, category, era, created_at, updated_at)
    VALUES (@slug, @topic, @category, @era, datetime('now'), datetime('now'))
    ON CONFLICT(slug) DO UPDATE SET
      topic = excluded.topic, category = excluded.category,
      era = COALESCE(NULLIF(articles.era, ''), excluded.era),
      updated_at = datetime('now')
  `).run({ slug: seed.slug, topic: seed.topic, category: seed.category, era: seed.era || 'evergreen' });
}

// ── LLM budget guard ─────────────────────────────────────────────────────────
function checkBudget(ctx, db, col) {
  const n = Number(ctx.row?.[col] || 0);
  if (n >= RETRY_CAP) throw new Error(`retry budget exhausted for ${col} (${n}/${RETRY_CAP})`);
  db.prepare(`UPDATE articles SET ${col} = COALESCE(${col},0) + 1, updated_at = datetime('now') WHERE slug = ?`).run(ctx.slug);
}

// ── bundle (LLM #1) ──────────────────────────────────────────────────────────
async function runBundle(ctx, db) {
  checkBudget(ctx, db, 'retry_bundle');
  const { createVertexJsonModel, generateJson } = await import('./vertex-json.mjs');
  const model = createVertexJsonModel({
    modelKey: 'bundle',
    temperature: 0.4,
    maxOutputTokens: 4096,
    thinkingBudget: 512,
    system: `You are the content editor for "Daivik Vani", a Vedic astrology publication. Write factual, warm, practical copy for an educated general audience. Never invent specifics you don't know and never emit placeholders like "TBD"/"unknown" — omit what you don't know. Output ONE JSON object only, no fences.`,
    responseSchema: {
      type: 'OBJECT',
      required: ['title', 'meta_description', 'tags', 'outline'],
      properties: {
        title: { type: 'STRING' },
        meta_description: { type: 'STRING' },
        tags: { type: 'ARRAY', items: { type: 'STRING' } },
        outline: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            required: ['id', 'heading', 'brief'],
            properties: {
              id: { type: 'STRING' },
              heading: { type: 'STRING' },
              brief: { type: 'STRING' },
              format: { type: 'STRING', enum: ['prose', 'list', 'faq'] },
            },
          },
        },
      },
    },
  });
  const prompt = `Topic: ${ctx.row.topic}
Category: ${ctx.row.category}
Site: Daivik Vani (Vedic astrology)

Produce the editorial bundle for one article on this topic:
- "title": 30-80 chars, specific and inviting.
- "meta_description": 90-180 chars, plain summary.
- "tags": 5-8 short lowercase tags.
- "outline": 5-7 sections, each {id (kebab-case), heading (>=8 chars), brief (>=30 chars, what the section covers), format}.`;
  const out = await generateJson(model, prompt);
  if (!bundleSliceOk(out, 'meta') || !bundleSliceOk(out, 'sections')) {
    throw new Error('bundle response failed slice contract (title/meta/tags or outline)');
  }
  if (placeholderPaths(out).length) throw new Error('bundle response contains placeholder/template tokens');
  db.prepare(`UPDATE articles SET bundle_data = ?, updated_at = datetime('now') WHERE slug = ?`)
    .run(JSON.stringify(out), ctx.slug);
}

// ── meta (deterministic; the run IS the backfill) ────────────────────────────
async function runMeta(ctx, db) {
  const b = ctx.json.bundle;
  if (!bundleSliceOk(b, 'meta')) throw new Error('bundle meta slice missing — cannot fill title/meta/tags');
  db.prepare(`
    UPDATE articles SET
      title = CASE WHEN COALESCE(TRIM(title),'')='' THEN @title ELSE title END,
      meta_description = CASE WHEN COALESCE(TRIM(meta_description),'')='' THEN @meta ELSE meta_description END,
      tags = CASE WHEN COALESCE(TRIM(tags),'') IN ('','[]') THEN @tags ELSE tags END,
      updated_at = datetime('now')
    WHERE slug = @slug
  `).run({ slug: ctx.slug, title: b.title.trim(), meta: b.meta_description.trim(), tags: JSON.stringify(b.tags) });
}

// ── sections (LLM #2) ────────────────────────────────────────────────────────
async function runSections(ctx, db) {
  checkBudget(ctx, db, 'retry_sections');
  const outline = ctx.json.bundle?.outline;
  if (!Array.isArray(outline) || !outline.length) throw new Error('no outline in bundle_data — run bundle first');
  const { createVertexJsonModel, generateJson } = await import('./vertex-json.mjs');
  const model = createVertexJsonModel({
    modelKey: 'sections',
    temperature: 0.6,
    maxOutputTokens: 20000,
    thinkingBudget: 1024,
    system: `You write clear, accurate Vedic-astrology explainers for "Daivik Vani". Plain text only — NO HTML, NO markdown. Never emit placeholders. Output ONE JSON object only, no fences.`,
    responseSchema: {
      type: 'OBJECT',
      required: ['sections'],
      properties: {
        sections: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            required: ['id', 'heading', 'paragraphs'],
            properties: {
              id: { type: 'STRING' },
              heading: { type: 'STRING' },
              paragraphs: { type: 'ARRAY', items: { type: 'STRING' } },
              list: {
                type: 'OBJECT',
                properties: {
                  intro: { type: 'STRING' },
                  items: { type: 'ARRAY', items: { type: 'STRING' } },
                },
              },
              faq: {
                type: 'ARRAY',
                items: { type: 'OBJECT', required: ['q', 'a'], properties: { q: { type: 'STRING' }, a: { type: 'STRING' } } },
              },
            },
          },
        },
      },
    },
  });
  const prompt = `Title: ${ctx.row.title}
Meta: ${ctx.row.meta_description}
Category: ${ctx.row.category}

Write the body for every outline section below. Each section: 2-4 paragraphs of 150-250 words total, plain text. Use the "list" field for a section whose format is "list" and "faq" for "faq". Keep section ids identical to the outline ids.

Outline:
${outline.map((o, i) => `${i + 1}. [${o.id}] ${o.heading} (${o.format || 'prose'}) — ${o.brief}`).join('\n')}`;
  const out = await generateJson(model, prompt);
  let sections = Array.isArray(out.sections) ? out.sections : [];
  // Deterministic id alignment: if counts match but ids drifted, align by index.
  if (sections.length === outline.length) {
    sections = sections.map((s, i) => ({ ...s, id: outline[i].id }));
  }
  const err = sectionsValid(sections, outline);
  if (err) throw new Error(`sections response invalid: ${err}`);
  db.prepare(`UPDATE articles SET sections_data = ?, updated_at = datetime('now') WHERE slug = ?`)
    .run(JSON.stringify(sections), ctx.slug);
}

// ── sanitize (deterministic normalization) ───────────────────────────────────
const PREAMBLE_RE = /^(here('| i)s|sure[,!]|certainly[,!]|below is|the following)\b.*$/i;

function cleanText(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/<[^>]*>/g, '')                     // strip stray HTML
    .replace(/\*\*|__|`/g, '')                    // strip markdown emphasis/code
    .replace(/\s+/g, ' ')
    .trim();
}

async function runSanitize(ctx, db) {
  const sections = ctx.json.sections;
  if (!Array.isArray(sections)) throw new Error('no sections_data to sanitize');
  const cleaned = sections.map(s => {
    const out = { ...s };
    out.heading = cleanText(s.heading);
    out.paragraphs = (Array.isArray(s.paragraphs) ? s.paragraphs : [])
      .map(cleanText).filter(p => p && !PREAMBLE_RE.test(p) && !isPlaceholder(p));
    if (s.list && Array.isArray(s.list.items)) {
      out.list = {
        intro: cleanText(s.list.intro || ''),
        items: s.list.items.map(cleanText).filter(i => i && !isPlaceholder(i)),
      };
      if (!out.list.items.length) delete out.list;
    }
    if (Array.isArray(s.faq)) {
      out.faq = s.faq.map(f => ({ q: cleanText(f.q), a: cleanText(f.a) })).filter(f => f.q && f.a);
      if (!out.faq.length) delete out.faq;
    }
    return out;
  });
  // If normalization gutted a section, record a failure (the sections gate will
  // then fail on the next pass → LLM re-run; no deadlock here).
  const failed = cleaned.map((s, i) => sectionValid(s) ? `${cleaned[i].id || i}: ${sectionValid(s)}` : null).filter(Boolean);
  db.prepare(`UPDATE articles SET sections_data = @s, sanitized = 1, sanitize_failures = @f, updated_at = datetime('now') WHERE slug = @slug`)
    .run({ slug: ctx.slug, s: JSON.stringify(cleaned), f: failed.length ? JSON.stringify(failed) : null });
  if (failed.length) throw new Error(`sanitize left ${failed.length} section(s) invalid`);
}

// ── assemble (deterministic render) ──────────────────────────────────────────
async function runAssemble(ctx, db) {
  const sections = ctx.json.sections;
  if (!Array.isArray(sections) || !sections.length) throw new Error('no sections_data to assemble');
  const html = renderArticleBody(sections);
  const wc = countWords(sections);
  db.prepare(`UPDATE articles SET html = ?, word_count = ?, updated_at = datetime('now') WHERE slug = ?`)
    .run(html, wc, ctx.slug);
}

// ── verify (deterministic contract) ──────────────────────────────────────────
async function runVerify(ctx, db) {
  const failures = verifyContract(ctx);
  if (failures.length) {
    db.prepare(`UPDATE articles SET db_complete = 0, db_complete_failures = ?, db_complete_at = NULL, updated_at = datetime('now') WHERE slug = ?`)
      .run(JSON.stringify(failures), ctx.slug);
    throw new Error(`verify failed: ${failures.join('; ')}`);
  }
  db.prepare(`UPDATE articles SET db_complete = 1, db_complete_failures = NULL, db_complete_at = datetime('now'), updated_at = datetime('now') WHERE slug = ?`)
    .run(ctx.slug);
}

// ── publish (deterministic; THE final step) ──────────────────────────────────
function buildArtifact(row, tags) {
  return {
    slug: row.slug, topic: row.topic, category: row.category, era: row.era,
    title: row.title, meta_description: row.meta_description, tags,
    bundle_data: row.bundle_data ? JSON.parse(row.bundle_data) : null,
    sections_data: row.sections_data ? JSON.parse(row.sections_data) : null,
    html: row.html, word_count: row.word_count || 0,
    sanitized: row.sanitized || 0,
    db_complete: row.db_complete || 0,
    db_complete_at: row.db_complete_at || null,
    publish_status: 'published',
    published_at: row.published_at || nowSql(),
    created_at: row.created_at || null,
  };
}

// Rebuild the shared files (listing, manifest, dv-state, sitemap) by scanning
// the durable artifacts on disk — never the DB — so publishing one slug never
// drops articles whose rows aren't in this DB.
function rebuildSharedFromDisk(baseUrl) {
  const entries = [];
  for (const slug of listArtifactSlugs()) {
    try {
      const art = JSON.parse(readFileSync(join(ARTIFACT_DIR, `${slug}.json`), 'utf8'));
      // Only index well-formed, published artifacts — never let one stray file
      // crash the shared rebuild.
      if ((art.publish_status || '') === 'published' && art.title && art.category && art.meta_description) {
        entries.push(manifestEntry(art, baseUrl));
      }
    } catch { /* skip unreadable artifact */ }
  }
  entries.sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
  writeFileSync(MANIFEST_PATH, JSON.stringify(entries, null, 2) + '\n');
  ensureDir(PAGES_DIR);
  writeFileSync(LISTING_PATH, renderListingPage(entries, baseUrl));
  ensureDir(dirname(DV_STATE_PATH));
  writeFileSync(DV_STATE_PATH, JSON.stringify(renderDvState(entries), null, 2) + '\n');
  writeFileSync(SITEMAP_PATH, renderSitemap(entries, baseUrl));
}

async function runPublish(ctx, db) {
  // Re-validate before writing anything (mirrors the reference stage step's
  // validateReady): the per-slug loop is non-fatal and continues past upstream
  // failures, so publish is the last guard against shipping a broken row.
  const row = ctx.row;
  if (!row) throw new Error('no row to publish');
  if (row.db_complete !== 1) throw new Error('db_complete gate not passed — refusing to publish');
  const failures = verifyContract(ctx);
  if (failures.length) throw new Error(`not publishable: ${failures.join('; ')}`);

  const { siteConfig } = await import('../config/index.mjs');
  const baseUrl = siteConfig.baseUrl;
  const tags = ctx.json.tags && Array.isArray(ctx.json.tags) ? ctx.json.tags : [];
  const publishedAt = row.published_at || nowSql();
  db.prepare(`UPDATE articles SET publish_status = 'published', published_at = COALESCE(published_at, ?), updated_at = datetime('now') WHERE slug = ?`)
    .run(publishedAt, ctx.slug);
  ctx.reload();

  const art = buildArtifact(ctx.row, tags);
  const url = `${baseUrl}/articles/${ctx.slug}.html`;

  // 1. durable per-slug artifact (key-sorted for stable diffs)
  ensureDir(ARTIFACT_DIR);
  writeFileSync(join(ARTIFACT_DIR, `${ctx.slug}.json`), JSON.stringify(sortKeys(art), null, 2) + '\n');

  // 2. per-slug article page
  ensureDir(PAGES_DIR);
  const pageRow = { ...ctx.row, tags };
  writeFileSync(join(PAGES_DIR, `${ctx.slug}.html`), renderArticlePage(pageRow, url));

  // 3. shared files rebuilt from disk (includes the slug just written)
  rebuildSharedFromDisk(baseUrl);
}

function sortKeys(obj) {
  if (Array.isArray(obj)) return obj.map(sortKeys);
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(Object.keys(obj).sort().map(k => [k, sortKeys(obj[k])]));
  }
  return obj;
}

export const STEP_RUN = {
  seed: runSeed,
  bundle: runBundle,
  meta: runMeta,
  sections: runSections,
  sanitize: runSanitize,
  assemble: runAssemble,
  verify: runVerify,
  publish: runPublish,
};
