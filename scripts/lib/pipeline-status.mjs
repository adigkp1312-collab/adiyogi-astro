/**
 * pipeline-status.mjs — the single source of truth for "how done is this
 * article". Ported from Templeblogs scripts/lib/pipeline-status.mjs.
 *
 * Every step's done-ness is judged from ACTUAL artifacts (columns, parsed JSON
 * blobs, published files on disk) — never from bookkeeping flags. Flags here
 * (`sanitized`, `db_complete`, `publish_status`) are caches of that truth and
 * are reconciled back to it. Dirty-but-fixable state is healed by deterministic
 * `repair` functions BEFORE any paid LLM step is considered.
 *
 * Cost contract: a from-scratch article is exactly 2 LLM calls (bundle,
 * sections); a complete article re-runs at 0; a row restored from its published
 * artifact re-runs at 0.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const ROOT = join(__dirname, '..', '..');
export const ARTIFACT_DIR = join(ROOT, 'data', 'articles');   // durable per-slug JSON
export const PAGES_DIR = join(ROOT, 'articles');               // published HTML pages
export const MANIFEST_PATH = join(ROOT, 'data', 'articles.json');
export const LISTING_PATH = join(PAGES_DIR, 'index.html');
export const DV_STATE_PATH = join(ROOT, 'scripts', 'dv-state.json');
export const SITEMAP_PATH = join(ROOT, 'sitemap.xml');
export const SEEDS_PATH = join(ROOT, 'seeds', 'topics.json');

export const MIN_WORD_COUNT = 600;

// ── Placeholder detection (ported verbatim) ──────────────────────────────────

export const PLACEHOLDERS = new Set([
  'unknown', 'n/a', 'na', 'tbd', 'tba', 'none',
  'not available', 'not known', 'unspecified', '-', '—',
]);

export function isPlaceholder(v) {
  if (v == null) return true;
  if (typeof v !== 'string') return false;
  return PLACEHOLDERS.has(v.trim().toLowerCase());
}

export function isEmpty(v) {
  return v == null || (typeof v === 'string' && v.trim() === '');
}

// Unfilled template tokens like {city}, {{title}}, <%x%>, [[slug]].
const TEMPLATE_TOKEN_RE = /\{[a-z_]{2,}\}|\{\{.+?\}\}|<%.+?%>|\[\[.+?\]\]/i;

export function hasTemplateToken(s) {
  return typeof s === 'string' && TEMPLATE_TOKEN_RE.test(s);
}

export function placeholderPaths(value, prefix = '', out = []) {
  if (typeof value === 'string') {
    if (PLACEHOLDERS.has(value.trim().toLowerCase())) out.push(prefix);
    else if (hasTemplateToken(value)) out.push(prefix);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => placeholderPaths(v, `${prefix}[${i}]`, out));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      placeholderPaths(v, prefix ? `${prefix}.${k}` : k, out);
    }
  }
  return out;
}

// Remove placeholder leaves: object leaves -> '', array entries dropped.
export function scrubPlaceholders(value, prefix = '', removed = []) {
  if (typeof value === 'string') {
    if (PLACEHOLDERS.has(value.trim().toLowerCase())) { removed.push(prefix); return { cleaned: '', removed }; }
    return { cleaned: value, removed };
  }
  if (Array.isArray(value)) {
    const cleaned = [];
    value.forEach((v, i) => {
      const r = scrubPlaceholders(v, `${prefix}[${i}]`, removed);
      const gutted = typeof v === 'string' && r.cleaned === '' && v !== '';
      if (!gutted) cleaned.push(r.cleaned);
    });
    return { cleaned, removed };
  }
  if (value && typeof value === 'object') {
    const cleaned = {};
    for (const [k, v] of Object.entries(value)) {
      cleaned[k] = scrubPlaceholders(v, prefix ? `${prefix}.${k}` : k, removed).cleaned;
    }
    return { cleaned, removed };
  }
  return { cleaned: value, removed };
}

export function sqliteToMs(s) {
  if (!s) return null;
  const ms = Date.parse(String(s).replace(' ', 'T') + 'Z');
  return Number.isFinite(ms) ? ms : null;
}

function parse(raw) {
  if (isEmpty(raw)) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// ── Content validity (shared by sections gate, sanitize, verify) ─────────────

function sectionText(s) {
  const parts = [
    ...(Array.isArray(s.paragraphs) ? s.paragraphs : []),
    s.list?.intro || '',
    ...(Array.isArray(s.list?.items) ? s.list.items : []),
    ...(Array.isArray(s.faq) ? s.faq.flatMap(f => [f.q || '', f.a || '']) : []),
  ];
  return parts.filter(p => typeof p === 'string').join(' ');
}

export function sectionValid(s) {
  if (!s || typeof s !== 'object') return 'not an object';
  if (isEmpty(s.heading) || isPlaceholder(s.heading) || s.heading.trim().length < 8) return 'heading missing/short';
  const paras = Array.isArray(s.paragraphs) ? s.paragraphs : [];
  if (paras.length < 1 || paras.length > 6) return 'paragraph count out of range';
  if (sectionText(s).replace(/<[^>]*>/g, '').length < 300) return 'section text under 300 chars';
  if (placeholderPaths(s).length) return 'placeholder/template token present';
  return null;
}

export function sectionsValid(sections, outline) {
  if (!Array.isArray(sections) || sections.length === 0) return 'sections_data missing/empty';
  const minCount = Array.isArray(outline) && outline.length ? outline.length : 5;
  if (sections.length < minCount) return `only ${sections.length} sections, need ${minCount}`;
  for (const s of sections) {
    const bad = sectionValid(s);
    if (bad) return `section "${s?.id || s?.heading || '?'}": ${bad}`;
  }
  return null;
}

// ── Bundle slice contracts ───────────────────────────────────────────────────

export function bundleSliceOk(bundle, key) {
  if (!bundle || typeof bundle !== 'object') return false;
  if (key === 'meta') {
    return !isEmpty(bundle.title) && bundle.title.trim().length >= 20 && bundle.title.trim().length <= 90
      && !isEmpty(bundle.meta_description) && bundle.meta_description.trim().length >= 80 && bundle.meta_description.trim().length <= 200
      && Array.isArray(bundle.tags) && bundle.tags.filter(t => !isEmpty(t) && !isPlaceholder(t)).length >= 3;
  }
  if (key === 'sections') {
    return Array.isArray(bundle.outline) && bundle.outline.length >= 5 && bundle.outline.length <= 8
      && bundle.outline.every(o => o && !isEmpty(o.id) && !isEmpty(o.heading) && o.heading.trim().length >= 8
        && !isEmpty(o.brief) && o.brief.trim().length >= 30)
      && placeholderPaths(bundle.outline).length === 0;
  }
  return false;
}

// ── Context loader ───────────────────────────────────────────────────────────

function mtimeMs(p) {
  try { return statSync(p).mtimeMs; } catch { return null; }
}

export function loadContext(db, slug) {
  const read = () => {
    const row = db.prepare(`SELECT * FROM articles WHERE slug = ?`).get(slug) || null;
    const artifactPath = join(ARTIFACT_DIR, `${slug}.json`);
    const pagePath = join(PAGES_DIR, `${slug}.html`);
    return {
      slug, row,
      json: {
        bundle: row ? parse(row.bundle_data) : null,
        sections: row ? parse(row.sections_data) : null,
        tags: row ? parse(row.tags) : null,
      },
      files: {
        artifact: existsSync(artifactPath),
        artifactPath,
        artifactMtimeMs: mtimeMs(artifactPath),
        page: existsSync(pagePath),
        pagePath,
        pageMtimeMs: mtimeMs(pagePath),
        listing: existsSync(LISTING_PATH),
        manifest: existsSync(MANIFEST_PATH),
        dvState: existsSync(DV_STATE_PATH),
        sitemap: existsSync(SITEMAP_PATH),
      },
    };
  };
  const ctx = read();
  ctx.reload = () => { Object.assign(ctx, read()); return ctx; };
  return ctx;
}

export function readArtifact(slug) {
  const p = join(ARTIFACT_DIR, `${slug}.json`);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

export function listArtifactSlugs() {
  if (!existsSync(ARTIFACT_DIR)) return [];
  return readdirSync(ARTIFACT_DIR).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''));
}

export function readSeeds() {
  try { return JSON.parse(readFileSync(SEEDS_PATH, 'utf8')); } catch { return []; }
}

// ── Per-step artifact predicates ─────────────────────────────────────────────

export function htmlSupersedes(c) {
  return !!c.row && !isEmpty(c.row.html) && (c.row.word_count || 0) > 0;
}

const BUNDLE_CONSUMERS = ['meta', 'sections'];

function bundleDone(c) {
  const needed = BUNDLE_CONSUMERS.filter(s => !P[s](c));
  if (needed.length === 0) return { done: true, superseded: !c.json.bundle };
  return { done: needed.every(s => bundleSliceOk(c.json.bundle, s)), superseded: false };
}

const P = {
  seed: c => !!c.row && !isEmpty(c.row.topic) && !isEmpty(c.row.category),
  meta: c => !!c.row && !isEmpty(c.row.title) && !isEmpty(c.row.meta_description)
    && Array.isArray(c.json.tags) && c.json.tags.filter(t => !isEmpty(t)).length >= 3,
  sections: c => (!!c.row && sectionsValid(c.json.sections, c.json.bundle?.outline) == null) || htmlSupersedes(c),
  sanitize: c => !!c.row && ((c.row.sanitized === 1 && c.row.sanitize_failures == null) || htmlSupersedes(c)),
  assemble: c => htmlSupersedes(c) && !hasTemplateToken(c.row.html),
  verify: c => !!c.row && c.row.db_complete === 1 && c.row.db_complete_at != null,
  publish: c => {
    if (!c.row || (c.row.publish_status || '') !== 'published') return false;
    if (!c.files.artifact || !c.files.page) return false;
    const stamp = sqliteToMs(c.row.db_complete_at);
    if (stamp != null) {
      const oldest = Math.min(c.files.artifactMtimeMs ?? Infinity, c.files.pageMtimeMs ?? Infinity);
      if (Number.isFinite(oldest) && oldest < stamp) return false;   // stale vs last verify
    }
    // Shared files: existence-only, so publishing slug B never marks slug A stale.
    return c.files.listing && c.files.manifest && c.files.dvState && c.files.sitemap;
  },
};

export { P };

// ── Deterministic repairs (self-healing; NO LLM, NO guessing) ────────────────

// Columns an artifact restore may write. status_* stay derived.
const RESTORE_COLUMNS = [
  'slug', 'topic', 'category', 'era', 'title', 'meta_description', 'tags',
  'bundle_data', 'sections_data', 'html', 'word_count', 'sanitized',
  'sanitize_failures', 'db_complete', 'db_complete_failures', 'db_complete_at',
  'publish_status', 'published_at', 'created_at',
];

// Restore the FULL row from the published artifact — the DB-disposability lever.
export function restoreRowFromArtifact(ctx, db, record) {
  const art = readArtifact(ctx.slug);
  if (!art || isEmpty(art.topic) || isEmpty(art.category)) return false;
  const vals = {};
  for (const col of RESTORE_COLUMNS) {
    let v = art[col];
    if (col === 'slug') v = ctx.slug;
    if (v != null && typeof v === 'object') v = JSON.stringify(v);
    vals[col] = v ?? null;
  }
  const cols = RESTORE_COLUMNS.join(', ');
  const params = RESTORE_COLUMNS.map(c => `@${c}`).join(', ');
  db.prepare(`INSERT OR REPLACE INTO articles (${cols}, updated_at) VALUES (${params}, datetime('now'))`).run(vals);
  record?.(`row restored from data/articles/${ctx.slug}.json`);
  return true;
}

// Restore one JSON blob column from the artifact if the artifact's copy is valid.
function restoreColumnFromArtifact(ctx, db, col, validator, record) {
  const art = readArtifact(ctx.slug);
  if (!art) return false;
  const artVal = art[col === 'bundle_data' ? 'bundle_data' : 'sections_data'];
  if (artVal == null) return false;
  const parsed = typeof artVal === 'string' ? parse(artVal) : artVal;
  if (!parsed || !validator(parsed)) return false;
  const current = JSON.stringify(parse(ctx.row?.[col]) ?? null);
  const next = JSON.stringify(parsed);
  if (current === next) return false;
  db.prepare(`UPDATE articles SET ${col} = ?, updated_at = datetime('now') WHERE slug = ?`).run(next, ctx.slug);
  record?.(`${col} restored from published artifact`);
  return true;
}

export function repairBundleFromArtifact(ctx, db, record) {
  return restoreColumnFromArtifact(ctx, db, 'bundle_data',
    b => bundleSliceOk(b, 'meta') && bundleSliceOk(b, 'sections'), record);
}

export function repairSectionsFromArtifact(ctx, db, record) {
  return restoreColumnFromArtifact(ctx, db, 'sections_data',
    s => sectionsValid(s, parse(ctx.row?.bundle_data)?.outline) == null, record);
}

export function scrubColumn(ctx, db, col, record) {
  const data = parse(ctx.row?.[col]);
  if (!data) return false;
  const { cleaned, removed } = scrubPlaceholders(data);
  if (!removed.length) return false;
  db.prepare(`UPDATE articles SET ${col} = ?, updated_at = datetime('now') WHERE slug = ?`)
    .run(JSON.stringify(cleaned), ctx.slug);
  record?.(`scrubbed ${removed.length} placeholder value(s) in ${col}`);
  return true;
}

// meta backfill: copy missing columns from a valid bundle slice.
export function repairMetaFromBundle(ctx, db, record) {
  const b = ctx.json.bundle;
  if (!bundleSliceOk(b, 'meta')) return false;
  const before = db.prepare(`SELECT title, meta_description, tags FROM articles WHERE slug = ?`).get(ctx.slug);
  db.prepare(`
    UPDATE articles SET
      title = CASE WHEN COALESCE(TRIM(title), '') = '' THEN @title ELSE title END,
      meta_description = CASE WHEN COALESCE(TRIM(meta_description), '') = '' THEN @meta ELSE meta_description END,
      tags = CASE WHEN COALESCE(TRIM(tags), '') IN ('', '[]') THEN @tags ELSE tags END,
      updated_at = datetime('now')
    WHERE slug = @slug
  `).run({ slug: ctx.slug, title: b.title.trim(), meta: b.meta_description.trim(), tags: JSON.stringify(b.tags) });
  const after = db.prepare(`SELECT title, meta_description, tags FROM articles WHERE slug = ?`).get(ctx.slug);
  const changed = JSON.stringify(before) !== JSON.stringify(after);
  if (changed) record?.('meta columns filled from bundle slice');
  return changed;
}

// ── Flag reconciliation ──────────────────────────────────────────────────────
// Flags are a cache of artifact truth. db_complete is cleared when the verify
// contract no longer holds (any clearing nulls db_complete_at so publish's
// staleness gate can't trust a stale stamp). `sanitized` is transformational —
// never auto-cleared (mirrors the reference NEVER_CLEAR policy).

export function verifyContract(c) {
  const failures = [];
  if (!c.row) return ['no row'];
  const title = c.row.title || '';
  const meta = c.row.meta_description || '';
  if (title.trim().length < 20 || title.trim().length > 90) failures.push('title length out of 20-90');
  if (meta.trim().length < 80 || meta.trim().length > 200) failures.push('meta_description length out of 80-200');
  if (!Array.isArray(c.json.tags) || c.json.tags.filter(t => !isEmpty(t)).length < 3) failures.push('fewer than 3 tags');
  if (isEmpty(c.row.category)) failures.push('category missing');
  const secErr = htmlSupersedes(c) ? null : sectionsValid(c.json.sections, c.json.bundle?.outline);
  if (secErr) failures.push(`sections: ${secErr}`);
  if (!(c.row.sanitized === 1 || htmlSupersedes(c))) failures.push('not sanitized');
  if (isEmpty(c.row.html)) failures.push('html empty');
  if ((c.row.word_count || 0) < MIN_WORD_COUNT) failures.push(`word_count under ${MIN_WORD_COUNT}`);
  if (hasTemplateToken(c.row.html)) failures.push('template token in html');
  for (const col of ['bundle', 'sections']) {
    const hits = placeholderPaths(c.json[col] || {});
    if (hits.length) failures.push(`placeholders in ${col}_data: ${hits.slice(0, 3).join(', ')}`);
  }
  return failures;
}

export function reconcileFlags(ctx, db, record = null) {
  const changes = [];
  if (ctx.row && ctx.row.db_complete === 1 && verifyContract(ctx).length > 0) {
    db.prepare(`UPDATE articles SET db_complete = 0, db_complete_at = NULL, updated_at = datetime('now') WHERE slug = ?`)
      .run(ctx.slug);
    changes.push({ column: 'db_complete', from: 1, to: 0, reason: 'verify contract no longer holds' });
    record?.('db_complete cleared: verify contract no longer holds');
    ctx.reload();
  }
  return changes;
}

// ── Status computation + persistence ─────────────────────────────────────────

export function evaluate(ctx) {
  return PIPELINE_STEPS.map(step => {
    const v = step.isDone(ctx);
    return { name: step.name, llm: !!step.llm, ...v };
  });
}

export function computeStatus(ctx) {
  const steps = evaluate(ctx);
  const frontier = steps.find(s => !s.done);
  const blockers = steps.filter(s => !s.done && s.reason).map(s => ({ step: s.name, reason: s.reason }));
  const llmNeeded = steps.filter(s => !s.done && s.llm && !s.superseded).map(s => s.name);
  return { step: frontier ? frontier.name : 'done', blockers, llm_calls_needed: llmNeeded };
}

export function writeStatusColumns(ctx, db) {
  const status = computeStatus(ctx);
  if (ctx.row) {
    db.prepare(`
      UPDATE articles SET
        status_step = @step, status_blockers = @blockers,
        status_llm_needed = @llm, status_checked_at = datetime('now')
      WHERE slug = @slug
    `).run({
      slug: ctx.slug,
      step: status.step,
      blockers: status.blockers.length ? JSON.stringify(status.blockers) : null,
      llm: status.llm_calls_needed.length ? JSON.stringify(status.llm_calls_needed) : null,
    });
  }
  return status;
}

// ── Step registry ────────────────────────────────────────────────────────────
// { name, llm, isDone(ctx) -> {done, reason, superseded}, repair?(ctx,db,record) -> healed,
//   run(ctx, db, record) -> throws on failure }  — run() implementations live in
// scripts/lib/pipeline-steps.mjs to keep this module dependency-light (the
// status CLI and dashboard read it without touching the LLM stack).

export const PIPELINE_STEPS = [
  {
    name: 'seed', llm: false,
    isDone: c => ({ done: !!P.seed(c), reason: P.seed(c) ? null : (c.row ? 'row missing topic/category' : 'no articles row'), superseded: false }),
    repair: (c, db, r) => restoreRowFromArtifact(c, db, r),
  },
  {
    name: 'bundle', llm: true,
    isDone: c => {
      const { done, superseded } = bundleDone(c);
      return { done, superseded, reason: done ? null : 'a needed bundle slice is missing or fails its contract' };
    },
    repair: (c, db, r) => repairBundleFromArtifact(c, db, r),
  },
  {
    name: 'meta', llm: false,
    isDone: c => ({ done: !!P.meta(c), reason: P.meta(c) ? null : 'title/meta_description/tags columns incomplete', superseded: false }),
    repair: (c, db, r) => repairMetaFromBundle(c, db, r),
  },
  {
    name: 'sections', llm: true,
    isDone: c => ({
      done: !!P.sections(c),
      superseded: P.sections(c) && htmlSupersedes(c) && sectionsValid(c.json.sections, c.json.bundle?.outline) != null,
      reason: P.sections(c) ? null : (sectionsValid(c.json.sections, c.json.bundle?.outline) || 'sections invalid'),
    }),
    repair: (c, db, r) => {
      const a = repairSectionsFromArtifact(c, db, r);
      if (a) return true;
      return scrubColumn(c, db, 'sections_data', r);
    },
  },
  {
    name: 'sanitize', llm: false,
    isDone: c => ({
      done: !!P.sanitize(c),
      reason: P.sanitize(c) ? null : (c.row?.sanitize_failures ? `sanitize blocked: ${c.row.sanitize_failures}` : 'not sanitized'),
      superseded: P.sanitize(c) && c.row?.sanitized !== 1,
    }),
  },
  {
    name: 'assemble', llm: false,
    isDone: c => ({ done: !!P.assemble(c), reason: P.assemble(c) ? null : 'html empty, word_count 0, or template token present', superseded: false }),
  },
  {
    name: 'verify', llm: false,
    isDone: c => ({
      done: !!P.verify(c),
      reason: P.verify(c) ? null
        : (c.row?.db_complete_failures ? `incomplete: ${c.row.db_complete_failures}` : 'not verified since last change'),
      superseded: false,
    }),
    // Catch-all heal entry for rows whose earlier steps all skipped. Prefer
    // restoring pristine blobs from the durable artifact (keeps content whole);
    // fall back to placeholder-scrub when no clean artifact copy exists.
    repair: (c, db, r) => {
      let healed = false;
      if (repairBundleFromArtifact(c, db, r)) healed = true;
      if (repairSectionsFromArtifact(c, db, r)) healed = true;
      c.reload();
      for (const col of ['bundle_data', 'sections_data']) {
        if (scrubColumn(c, db, col, r)) healed = true;
      }
      c.reload();
      if (repairMetaFromBundle(c, db, r)) healed = true;
      return healed;
    },
  },
  {
    name: 'publish', llm: false,
    isDone: c => ({
      done: !!P.publish(c),
      reason: P.publish(c) ? null
        : ((c.row?.publish_status || '') !== 'published' ? 'not published'
          : !c.files.page ? 'article page missing'
          : !c.files.artifact ? 'durable artifact missing'
          : (!c.files.listing || !c.files.manifest || !c.files.dvState || !c.files.sitemap) ? 'shared publish file missing'
          : 'published files older than last verify'),
      superseded: false,
    }),
  },
];

export const STEP_NAMES = PIPELINE_STEPS.map(s => s.name);
