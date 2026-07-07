#!/usr/bin/env node
/**
 * run-dv-pipeline.mjs — THE Daivik Vani pipeline entrypoint.
 *
 * For any slug it either generates a new article or completes/repairs the
 * existing one, idempotently. Every step's done-ness comes from ACTUAL
 * artifacts (scripts/lib/pipeline-status.mjs). Done steps are skipped;
 * dirty-but-fixable state is self-healed deterministically BEFORE any paid LLM
 * step; only genuinely-missing steps run. The FINAL step publishes to the
 * frontend (static HTML + manifest + listing + dv-state + sitemap).
 *
 *   node scripts/run-dv-pipeline.mjs --slug X                  # seed → publish, skip done
 *   node scripts/run-dv-pipeline.mjs --slug X --until verify   # stop before publish
 *   node scripts/run-dv-pipeline.mjs --slug X --from sections  # force re-run from a step
 *   node scripts/run-dv-pipeline.mjs --slug X --force          # force re-run everything
 *   node scripts/run-dv-pipeline.mjs --all --limit 50          # sweep articles needing work
 *   node scripts/run-dv-pipeline.mjs --slug X --dry-run        # decision table, zero writes
 *
 * From-scratch article = exactly 2 LLM calls (bundle, sections). A complete
 * article, or one restored from its published artifact, costs 0.
 */

import { openDb } from './lib/db.mjs';
import {
  PIPELINE_STEPS, STEP_NAMES, loadContext, reconcileFlags, writeStatusColumns,
  readSeeds, listArtifactSlugs,
} from './lib/pipeline-status.mjs';
import { STEP_RUN } from './lib/pipeline-steps.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? (args[i + 1] ?? d) : d; };
const SLUG = flag('slug', null);
const ALL = args.includes('--all');
const UNTIL = flag('until', 'publish');
const FROM = flag('from', null);
const FORCE = args.includes('--force');
const LIMIT = parseInt(flag('limit', '0'), 10) || null;
const DRY_RUN = args.includes('--dry-run');

if (!SLUG && !ALL) {
  console.error('Usage: --slug <slug> | --all [--limit N] [--until <step>] [--from <step> | --force] [--dry-run]');
  process.exit(1);
}

const untilIdx = STEP_NAMES.indexOf(UNTIL);
if (untilIdx < 0) { console.error(`Unknown --until step "${UNTIL}". Valid: ${STEP_NAMES.join(', ')}`); process.exit(1); }
const fromIdx = FORCE ? 0 : (FROM ? STEP_NAMES.indexOf(FROM) : -1);
if (FROM && fromIdx < 0) { console.error(`Unknown --from step "${FROM}". Valid: ${STEP_NAMES.join(', ')}`); process.exit(1); }
const plan = PIPELINE_STEPS.slice(0, untilIdx + 1);

const db = openDb();

function resolveSlugs() {
  if (SLUG) return [SLUG];
  // Union of seeds ∪ DB rows ∪ on-disk artifacts, so a deleted DB is fully
  // recoverable and new seed topics get picked up. Over-selection is free:
  // done slugs skip every step.
  const set = new Set();
  for (const s of readSeeds()) set.add(s.slug);
  for (const r of db.prepare(`SELECT slug FROM articles`).all()) set.add(r.slug);
  for (const s of listArtifactSlugs()) set.add(s);
  let slugs = [...set].sort();
  if (LIMIT) slugs = slugs.slice(0, LIMIT);
  return slugs;
}

// An explicit single-slug run is an operator retry request: reset exhausted LLM
// retry budgets so it can proceed. Queue sweeps (--all) stay strict.
function resetRetries(slug) {
  if (!SLUG || DRY_RUN) return;
  db.prepare(`UPDATE articles SET retry_bundle = 0, retry_sections = 0 WHERE slug = ? AND (retry_bundle >= 3 OR retry_sections >= 3)`).run(slug);
}

const slugs = resolveSlugs();
console.log(`Pipeline ${plan.map(s => s.name).join(' → ')} for ${slugs.length} slug(s)${DRY_RUN ? ' [dry-run]' : ''}${fromIdx >= 0 ? ` [forcing from ${STEP_NAMES[fromIdx]}]` : ''}`);

let ok = 0, failed = 0;
for (const slug of slugs) {
  console.log(`\n========== ${slug} ==========`);
  let ctx = loadContext(db, slug);

  if (!DRY_RUN) {
    const changes = reconcileFlags(ctx, db, msg => console.log(`  ⟲ ${msg}`));
    if (changes.length) ctx.reload();
  }

  // Decision pass (also the --dry-run output).
  const decisions = plan.map((step, i) => {
    const forced = fromIdx >= 0 && i >= fromIdx;
    const v = step.isDone(ctx);
    return {
      step: step.name,
      decision: v.done && !forced ? 'skip' : 'run',
      llm: !!step.llm,
      hasRepair: !!step.repair,
      forced,
      reason: v.done ? (v.superseded ? 'superseded' : 'artifact present') : (v.reason || ''),
    };
  });

  if (DRY_RUN) {
    console.log(`  ${'step'.padEnd(10)} ${'decision'.padEnd(9)} ${'llm'.padEnd(4)} reason`);
    for (const d of decisions) {
      console.log(`  ${d.step.padEnd(10)} ${(d.forced && d.decision === 'run' ? 'run!' : d.decision).padEnd(9)} ${(d.decision === 'run' && d.llm ? 'LLM' : '-').padEnd(4)} ${d.reason}${d.decision === 'run' && d.hasRepair ? ' (repair tried first)' : ''}`);
    }
    console.log(`  LLM calls planned: ${decisions.filter(d => d.decision === 'run' && d.llm).length}`);
    ok++;
    continue;
  }

  resetRetries(slug);

  let slugOk = true, failure = null;
  for (let i = 0; i < plan.length; i++) {
    const step = plan[i];
    const forced = fromIdx >= 0 && i >= fromIdx;
    let v = step.isDone(ctx);

    if (v.done && !forced) {
      console.log(`✓ skip ${step.name}${v.superseded ? ' (superseded)' : ''}`);
      continue;
    }

    // Deterministic self-heal before running (and before any LLM spend).
    if (step.repair) {
      let healed = false;
      try { healed = step.repair(ctx, db, msg => console.log(`  ⟲ ${msg}`)); } catch (e) { console.warn(`  repair error: ${e.message}`); }
      if (healed) {
        ctx.reload();
        v = step.isDone(ctx);
        if (v.done && !forced) {
          console.log(`⟲ healed ${step.name}`);
          continue;
        }
      }
    }

    console.log(`\n━━━ ${step.name}${step.llm ? ' [LLM]' : ''} ━━━`);
    try {
      await STEP_RUN[step.name](ctx, db);
    } catch (e) {
      const msg = `${step.name} failed: ${e.message}`;
      console.error(`  ✗ ${msg}`);
      slugOk = false;
      failure = { step: step.name, message: msg };
      ctx.reload();
      continue;   // per-step failure is non-fatal; try the next step
    }
    ctx.reload();
    v = step.isDone(ctx);
    if (!v.done) {
      const msg = `artifact gate not met after ${step.name}: ${v.reason || 'unknown'}`;
      console.error(`  ✗ ${msg}`);
      slugOk = false;
      failure = { step: step.name, message: msg };
    } else {
      console.log(`  ✓ ${step.name}`);
    }
  }

  const status = writeStatusColumns(ctx.reload(), db);
  console.log(`  status_step = ${status.step}${status.llm_calls_needed.length ? ` (LLM still needed: ${status.llm_calls_needed.join(', ')})` : ''}`);

  if (slugOk) { ok++; console.log(`✅ ${slug}: reached ${UNTIL}`); }
  else { failed++; console.log(`✗ ${slug}: stopped at ${failure?.step} — ${failure?.message}`); }
}

console.log(`\nDone. ok=${ok} failed=${failed}`);
db.close();
process.exit(failed && !ALL ? 1 : 0);
