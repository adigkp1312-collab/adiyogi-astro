/**
 * Daivik Vani config loader. Ported from Templeblogs scripts/config/index.mjs.
 *
 *   import { getModel, vertexProject, vertexLocation, siteConfig } from '../config/index.mjs'
 *   const model = getModel('bundle')   // 'gemini-2.5-flash'
 *
 * To swap a model: edit scripts/config/config.json. No fallbacks.
 */

import { readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const _cfg = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf8'))

export const config = _cfg
export const siteConfig = {
  name: _cfg.site?.name || 'Daivik Vani',
  baseUrl: (process.env.SITE_BASE_URL || _cfg.site?.base_url || 'http://localhost:3456').replace(/\/$/, ''),
}

const _vertexProjects = (() => {
  const envList = parseProjectList(process.env.VERTEX_PROJECTS)
  if (envList.length) return envList

  const envSingle = process.env.VERTEX_PROJECT
  if (envSingle) return [String(envSingle).trim()].filter(Boolean)

  // Prefer the multi-project pools so API calls round-robin across every
  // configured project. The single `project_id` is only a last-resort default
  // for configs that don't declare a pool — checking it first would collapse
  // the round-robin to one project even when `projects`/`project_ids` exist.
  const cfgProjects = Array.isArray(_cfg.vertex?.projects)
    ? _cfg.vertex.projects
        .map((project) => String(project?.project_id || project?.id || '').trim())
        .filter(Boolean)
    : []
  if (cfgProjects.length) return cfgProjects

  const cfgList = Array.isArray(_cfg.vertex?.project_ids)
    ? _cfg.vertex.project_ids.map(String).map((s) => s.trim()).filter(Boolean)
    : []
  if (cfgList.length) return cfgList

  const configuredDefault = _cfg.vertex?.project_id
  if (configuredDefault) return [String(configuredDefault).trim()].filter(Boolean)

  return []
})()

export const vertexProjects = _vertexProjects
export const vertexProject  = _vertexProjects[0] || null
export const vertexAvailableProjects = [
  ...new Set([
    ...(Array.isArray(_cfg.vertex?.projects)
      ? _cfg.vertex.projects.map((project) => String(project?.project_id || project?.id || '').trim())
      : []),
    ...(Array.isArray(_cfg.vertex?.project_ids)
      ? _cfg.vertex.project_ids.map((projectId) => String(projectId).trim())
      : []),
    ...(_cfg.vertex?.project_id ? [String(_cfg.vertex.project_id).trim()] : []),
  ].filter(Boolean)),
]
export const vertexProjectAccounts = Object.fromEntries(
  Array.isArray(_cfg.vertex?.projects)
    ? _cfg.vertex.projects
        .map((project) => [
          String(project?.project_id || project?.id || '').trim(),
          String(project?.account || '').trim(),
        ])
        .filter(([projectId]) => Boolean(projectId))
    : []
)
export const vertexLocation = process.env.VERTEX_LOCATION || _cfg.vertex.location

// Round-robin index persisted to a file so rotation survives one-process-per-run
// designs and batch runs. Best-effort under parallel workers (a lost update just
// repeats a project once); good enough for even load distribution.
const _rrFile = join(__dirname, '..', '..', 'data', '.vertex-rr-index')

function _readRRIndex() {
  try {
    const n = parseInt(readFileSync(_rrFile, 'utf8').trim(), 10)
    return Number.isFinite(n) && n >= 0 ? n : 0
  } catch {
    return 0
  }
}

function _writeRRIndex(n) {
  try { writeFileSync(_rrFile, String(n)) } catch { /* read-only fs: fall back to no rotation */ }
}

export function nextVertexProject() {
  if (!_vertexProjects.length) {
    throw new Error('No Vertex project configured')
  }
  const i = _readRRIndex()
  const project = _vertexProjects[i % _vertexProjects.length]
  _writeRRIndex((i + 1) % _vertexProjects.length)
  return project
}

/** Get the configured model id for a task type. */
export function getModel(type) {
  const m = _cfg.models?.dv?.[type]
  if (!m) throw new Error(`Model '${type}' not found in scripts/config/config.json`)
  return m
}

function parseProjectList(value) {
  if (!value) return []
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}
