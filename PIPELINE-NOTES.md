# Daivik Vani — Pipeline Notes

Reusable notes for running, debugging, and re-authenticating the Daivik Vani
content pipeline. It is a sibling of the Templeblogs pipeline and shares the
same Vertex multi-account auth model. Machine of record: the **Mac Mini**
(`adityas-mac-mini`), alongside the Templeblogs repo.

---

## 1. Running the pipeline

One idempotent entrypoint. It skips steps that are already done (judged from
actual artifacts, not flags), heals what it can deterministically, and only
calls the LLM when a needed artifact is genuinely missing.

```bash
cd adiyogi-astro

# Full run for one slug (seed → publish). Publishes to /articles at the end.
node scripts/run-dv-pipeline.mjs --slug <slug>

# Stop earlier / force a re-run from a step / force everything
node scripts/run-dv-pipeline.mjs --slug <slug> --until verify
node scripts/run-dv-pipeline.mjs --slug <slug> --from sections
node scripts/run-dv-pipeline.mjs --slug <slug> --force

# Sweep every article that needs work (seeds ∪ DB rows ∪ published artifacts)
node scripts/run-dv-pipeline.mjs --all --limit 50

# See the decision table without spending anything
node scripts/run-dv-pipeline.mjs --slug <slug> --dry-run
```

Step order:

```
seed → bundle → meta → sections → sanitize → assemble → verify → publish
```

Only **bundle** and **sections** call the LLM. A from-scratch article costs
exactly 2 LLM calls; a complete article, or one restored from its published
artifact, costs 0.

Seed topics live in `seeds/topics.json` (`{slug, topic, category, era}`).

---

## 2. The self-healing model (why there is no separate fixer)

- **The database is disposable.** `data/dv.db` is gitignored working state. The
  durable truth is `data/articles/<slug>.json` — one committed artifact per
  published article. The `seed` step restores a full DB row from its artifact,
  so `rm data/dv.db && node scripts/run-dv-pipeline.mjs --all` rebuilds and
  republishes everything with **zero** LLM calls.
- **Every gate reads real artifacts**, never bookkeeping flags. A missing or
  broken artifact fails its step's gate; the same pipeline run repairs or
  regenerates only that piece.
- **Repairs run before any LLM spend**: restore a blob from its artifact, scrub
  placeholder tokens, backfill title/meta/tags from the bundle. Only when a
  repair can't satisfy the gate does an LLM step run.
- **`publish` re-validates before writing** (`db_complete=1` + full contract),
  so a partially-built row can never ship a broken page.

Status for a slug: the run prints `status_step` and any `LLM still needed`.
`data/articles.json` is the published manifest; `scripts/dv-state.json` feeds
the Templeblogs dashboard's "Daivik Vani" panel (point it there with
`DV_STATE_PATH=/path/to/adiyogi-astro/scripts/dv-state.json`).

---

## 3. Vertex AI auth — how it works

The two LLM steps call Vertex AI across **multiple GCP projects, each owned by a
different Google account** (cross-project IAM is not granted, so one ambient ADC
identity cannot serve all projects). This is the same stack as Templeblogs.

- `scripts/config/config.json` → `vertex.projects[]` maps each `project_id` to
  its owner `account`.
- `scripts/config/index.mjs` → `nextVertexProject()` round-robins across the
  pool; the index persists to `data/.vertex-rr-index` so rotation survives the
  one-process-per-run design.
- `scripts/lib/gcloud-auth.mjs` mints a short-lived access token per account via
  `gcloud auth print-access-token --account=<acct>` (cached 55 min; mint
  failures cached briefly so a logged-out account doesn't spawn gcloud on every
  request).
- `scripts/lib/vertex-json.mjs` → `generateJson()` **falls back automatically**:
  if the round-robin lands on a project whose account has an expired gcloud
  session, it rotates to the next and only throws if every account is logged out.

Requirement: each account in `vertex.projects[]` needs a live gcloud session on
the Mini (`gcloud auth login <account>` at least once, unexpired). These are the
**same sessions** Templeblogs uses — re-authenticating there fixes both.

Health check:

```bash
for a in adigkp1312@gmail.com aditya@adiyogiarts.com; do
  printf '%s: ' "$a"
  gcloud auth print-access-token --account="$a" >/dev/null 2>&1 \
    && echo OK || echo EXPIRED
done
```

For the headless re-login runbook (no-browser flow over SSH with a FIFO), see
Templeblogs `PIPELINE-NOTES.md` §3 — it is identical and the accounts are shared.

---

## 4. Publishing to the frontend

`publish` is the final step and writes only static files (no build system):

| File | Role |
|---|---|
| `data/articles/<slug>.json` | durable per-article artifact (source of truth) |
| `articles/<slug>.html` | the published article page |
| `articles/index.html` | the `/articles` listing, grouped by category |
| `data/articles.json` | manifest consumed by any listing/index surface |
| `scripts/dv-state.json` | Templeblogs dashboard panel feed |
| `sitemap.xml` | site + all articles |

The shared files are rebuilt by scanning `data/articles/*.json` on disk, so
publishing one slug never drops another. Serve locally with `node serve.mjs`
(port 3456); `/articles/` and `/articles/<slug>.html` render directly.

Set the canonical/OG base URL for production via `SITE_BASE_URL` (or
`site.base_url` in `config.json`); it defaults to `http://localhost:3456`.
