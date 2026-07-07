import { GoogleGenAI } from '@google/genai';
import { getModel, nextVertexProject, vertexLocation, vertexProjectAccounts, vertexProjects } from '../config/index.mjs';
import { gcloudAuthClient } from './gcloud-auth.mjs';

export function createVertexJsonModel({
  system,
  modelKey,
  temperature = 0.3,
  responseSchema,
  maxOutputTokens,
  thinkingBudget,
}) {
  return {
    model: getModel(modelKey),
    location: vertexLocation,
    config: {
      temperature,
      responseMimeType: 'application/json',
      ...(system ? { systemInstruction: system } : {}),
      ...(responseSchema ? { responseSchema } : {}),
      ...(maxOutputTokens ? { maxOutputTokens } : {}),
      ...(thinkingBudget != null ? { thinkingConfig: { thinkingBudget } } : {}),
    },
  };
}

export async function generateJson(model, prompt) {
  await new Promise(r => setTimeout(r, 1000)); // 1s gap between Vertex calls
  // If the round-robin lands on a project whose gcloud account has an expired
  // session, token minting fails non-interactively. Rotate to the next project
  // (each retry advances the round-robin) instead of failing the whole step;
  // only throw if every configured project's account is logged out.
  const attempts = Math.max(vertexProjects.length, 1);
  let res;
  let lastMintError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const ai = makeVertexAI(model.location);
    try {
      res = await ai.models.generateContent({
        model: model.model,
        contents: prompt,
        config: model.config,
      });
      lastMintError = null;
      break;
    } catch (err) {
      if (!String(err?.message || err).includes('Could not mint an access token')) throw err;
      lastMintError = err;
    }
  }
  if (lastMintError) throw lastMintError;
  const finishReason = res?.candidates?.[0]?.finishReason;
  if (finishReason === 'MAX_TOKENS') {
    throw new Error('vertex response truncated (MAX_TOKENS) — raise maxOutputTokens');
  }
  const text = extractText(res).trim().replace(/^```json\s*/i, '').replace(/```$/, '');
  try {
    return JSON.parse(text);
  } catch (e) {
    const pos = Number(String(e.message).match(/position (\d+)/)?.[1] ?? -1);
    const around = pos >= 0 ? text.slice(Math.max(0, pos - 120), pos + 120) : text.slice(0, 240);
    throw new Error(`vertex returned invalid JSON (finishReason=${finishReason ?? 'unknown'}): ${e.message}\n…${around}…`);
  }
}

function extractText(res) {
  if (typeof res?.text === 'string') return res.text;
  if (typeof res?.text === 'function') return res.text();
  return res?.candidates?.[0]?.content?.parts
    ?.map(part => part.text || '')
    .join('') || '';
}

function makeVertexAI(location = vertexLocation) {
  const savedGoogleKey = process.env.GOOGLE_API_KEY;
  const savedGeminiKey = process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.GEMINI_API_KEY;
  // Round-robin to the next project, then authenticate as THAT project's owner
  // account (cross-project IAM isn't granted, so ambient ADC would 403 on any
  // project it doesn't own). Falls back to ambient ADC when no account mapped.
  const project = nextVertexProject();
  const account = vertexProjectAccounts[project] || null;
  const ai = new GoogleGenAI({
    vertexai: true,
    project,
    location,
    apiVersion: process.env.VERTEX_API_VERSION || 'v1',
    ...(account ? { googleAuthOptions: { authClient: gcloudAuthClient(account) } } : {}),
  });
  if (savedGoogleKey !== undefined) process.env.GOOGLE_API_KEY = savedGoogleKey;
  if (savedGeminiKey !== undefined) process.env.GEMINI_API_KEY = savedGeminiKey;
  return ai;
}
