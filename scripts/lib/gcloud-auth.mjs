/**
 * Per-account auth for Vertex AI.
 *
 * Each Vertex project must be called with ITS OWN Google account (the projects
 * live under different owners and cross-project IAM is not granted). ADC is a
 * single ambient identity, so instead we mint a short-lived access token per
 * account from the local gcloud credential store and hand the @google/genai
 * Vertex client a custom auth client that injects that token.
 *
 * Requirement: each account must have a live gcloud session, i.e. the user has
 * run `gcloud auth login <account>` at least once and it has not expired.
 * Token minting is non-interactive; if an account needs re-auth, the call
 * throws with a clear message instead of hanging on a browser prompt.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

// account -> { token, exp(ms) }. gcloud user tokens last ~1h; we cache 55m and
// refresh ahead of expiry so a long batch never serves a stale token.
const _cache = new Map();
const TTL_MS = 55 * 60 * 1000;

// account -> exp(ms) of a recent mint failure. A logged-out account fails on
// every mint until the user re-runs `gcloud auth login`, so remember the
// failure briefly rather than spawning gcloud (~1s) per request while callers
// fall back to other projects. Short TTL so a re-login is picked up quickly.
const _failCache = new Map();
const FAIL_TTL_MS = 5 * 60 * 1000;

async function mintToken(account) {
  const now = Date.now();
  const hit = _cache.get(account);
  if (hit && hit.exp > now) return hit.token;
  const failHit = _failCache.get(account);
  if (failHit && failHit.exp > now) throw failHit.error;

  const args = ['auth', 'print-access-token', '--format=value(token)'];
  if (account) args.push(`--account=${account}`);
  let stdout;
  try {
    ({ stdout } = await execFileP('gcloud', args, { maxBuffer: 4 * 1024 * 1024 }));
  } catch (err) {
    const detail = String(err?.stderr || err?.message || err).trim().split('\n')[0];
    const error = new Error(
      `Could not mint an access token for "${account || 'default'}". ` +
      `Run \`gcloud auth login ${account || ''}\` to (re-)authenticate it. (${detail})`,
    );
    _failCache.set(account, { error, exp: now + FAIL_TTL_MS });
    throw error;
  }
  _failCache.delete(account);
  const token = stdout.trim();
  if (!token) throw new Error(`Empty access token for "${account || 'default'}"`);
  _cache.set(account, { token, exp: now + TTL_MS });
  return token;
}

/**
 * Build a minimal auth client for `google-auth-library`'s GoogleAuth. The
 * Vertex client only calls getRequestHeaders(); getAccessToken is provided for
 * completeness. Returning a web `Headers` matches what GoogleAuth expects.
 */
export function gcloudAuthClient(account) {
  return {
    quotaProjectId: undefined,
    async getAccessToken() {
      return { token: await mintToken(account) };
    },
    async getRequestHeaders() {
      const token = await mintToken(account);
      return new Headers({ Authorization: `Bearer ${token}` });
    },
  };
}
