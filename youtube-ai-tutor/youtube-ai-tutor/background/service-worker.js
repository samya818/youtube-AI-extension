/**
 * @file Service Worker — API calls, key storage, IndexedDB, messaging.
 */

importScripts('../lib/utils.js', '../lib/db.js');

const SALT = 'ytaitutor-salt-2026';
const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash';
const TRANSCRIPT_CACHE_TTL_MS = 60 * 60 * 1000;
const TRANSCRIPT_FULL_MAX_CHARS = 30000;
const TRANSCRIPT_DEFAULT_BEFORE_SEC = 60;
const TRANSCRIPT_DEFAULT_AFTER_SEC = 30;
const TRANSCRIPT_EXCERPT_BEFORE_SEC = 120;
const TRANSCRIPT_EXCERPT_AFTER_SEC = 60;

/** @type {Record<string, { beforeSec: number, afterSec: number, preferFull: boolean }>} */
const TRANSCRIPT_PRIORITY_PRESETS = {
  economical: { beforeSec: 30, afterSec: 15, preferFull: false },
  standard: { beforeSec: TRANSCRIPT_DEFAULT_BEFORE_SEC, afterSec: TRANSCRIPT_DEFAULT_AFTER_SEC, preferFull: false },
  complete: { beforeSec: TRANSCRIPT_EXCERPT_BEFORE_SEC, afterSec: TRANSCRIPT_EXCERPT_AFTER_SEC, preferFull: true }
};

/** @type {Record<string, string>} Maps retired model IDs to current equivalents. */
const DEPRECATED_GEMINI_MODELS = {
  'gemini-1.5-flash': 'gemini-2.5-flash',
  'gemini-1.5-pro': 'gemini-2.5-pro',
  'gemini-1.5-flash-001': 'gemini-2.5-flash',
  'gemini-1.5-pro-001': 'gemini-2.5-pro',
  'gemini-2.0-flash': 'gemini-2.5-flash',
  'gemini-2.0-flash-001': 'gemini-2.5-flash',
  'gemini-2.0-flash-lite': 'gemini-2.5-flash-lite',
  'gemini-2.0-flash-lite-001': 'gemini-2.5-flash-lite'
};

/**
 * Returns a supported Gemini model ID, migrating deprecated names.
 * @param {string|null|undefined} model
 * @returns {string}
 */
function resolveGeminiModel(model) {
  if (!model) {
    return GEMINI_DEFAULT_MODEL;
  }
  return DEPRECATED_GEMINI_MODELS[model] || model;
}

const API_PROVIDERS = {
  gemini: {
    label: 'Gemini (Google)',
    defaultModel: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-flash-image', 'gemini-2.5-pro', 'gemini-2.5-flash-lite', 'gemini-3.5-flash']
  },
  openai: {
    label: 'OpenAI',
    defaultModel: 'gpt-4o',
    models: ['gpt-4o', 'gpt-4o-mini']
  },
  anthropic: {
    label: 'Anthropic',
    defaultModel: 'claude-3-5-sonnet-20241022',
    models: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229']
  },
  mistral: {
    label: 'Mistral',
    defaultModel: 'mistral-large-latest',
    models: ['mistral-large-latest']
  }
};

function getProviderDefaultModel(provider) {
  return API_PROVIDERS[provider]?.defaultModel || GEMINI_DEFAULT_MODEL;
}

function detectProviderFromKey(key) {
  if (!key || typeof key !== 'string') {
    return null;
  }

  if (key.startsWith('AIza') && key.length === 39) {
    return 'gemini';
  }
  if (key.startsWith('sk-ant-')) {
    return 'anthropic';
  }
  if (key.startsWith('sk-') && !key.startsWith('sk-ant-')) {
    return 'openai';
  }
  return null;
}

async function migrateLegacyApiKeyStorage() {
  const stored = await chrome.storage.local.get(['apiKey', 'provider', 'geminiModel', 'apiKeys', 'activeProvider']);
  if (!stored.apiKey) {
    return;
  }

  const legacyProvider = stored.provider || 'gemini';
  const legacyModel = resolveGeminiModel(stored.geminiModel || GEMINI_DEFAULT_MODEL);
  const migrated = stored.apiKeys || {};

  if (!migrated.gemini) {
    migrated.gemini = {
      key: stored.apiKey,
      model: legacyModel,
      active: legacyProvider === 'gemini'
    };
  }

  await chrome.storage.local.set({
    apiKeys: migrated,
    activeProvider: stored.activeProvider || legacyProvider
  });
  await chrome.storage.local.remove(['apiKey', 'geminiModel']);
  console.log('[YTAITutor] Migrated legacy apiKey to apiKeys.gemini');
}

async function getStoredApiKeys() {
  await migrateLegacyApiKeyStorage();
  const stored = await chrome.storage.local.get(['apiKeys', 'activeProvider']);
  return {
    apiKeys: stored.apiKeys || {},
    activeProvider: stored.activeProvider || 'gemini'
  };
}

async function storeApiKeyForProvider(provider, key, model) {
  if (!provider) {
    provider = detectProviderFromKey(key) || 'gemini';
  }
  if (!API_PROVIDERS[provider]) {
    provider = 'mistral';
  }
  const resolvedModel = model || getProviderDefaultModel(provider);
  const stored = await getStoredApiKeys();
  const newApiKeys = { ...stored.apiKeys };

  Object.keys(newApiKeys).forEach((p) => {
    if (newApiKeys[p]) {
      newApiKeys[p] = { ...newApiKeys[p], active: p === provider };
    }
  });

  newApiKeys[provider] = {
    key: obfuscateKey(key),
    model: resolvedModel,
    active: true
  };

  await chrome.storage.local.set({
    apiKeys: newApiKeys,
    activeProvider: provider
  });

  return { apiKeys: newApiKeys, activeProvider: provider };
}

async function saveProviderSettings(provider, model) {
  if (!API_PROVIDERS[provider]) {
    provider = 'gemini';
  }
  const stored = await getStoredApiKeys();
  const newApiKeys = { ...stored.apiKeys };

  if (newApiKeys[provider]) {
    newApiKeys[provider] = {
      ...newApiKeys[provider],
      model: model || newApiKeys[provider].model || getProviderDefaultModel(provider),
      active: true
    };
  } else {
    newApiKeys[provider] = {
      key: null,
      model: model || getProviderDefaultModel(provider),
      active: true
    };
  }

  Object.keys(newApiKeys).forEach((p) => {
    if (newApiKeys[p]) {
      newApiKeys[p].active = p === provider;
    }
  });

  await chrome.storage.local.set({
    apiKeys: newApiKeys,
    activeProvider: provider
  });

  return { apiKeys: newApiKeys, activeProvider: provider };
}

async function setActiveProvider(provider) {
  const stored = await getStoredApiKeys();
  const newApiKeys = { ...stored.apiKeys };

  Object.keys(newApiKeys).forEach((p) => {
    if (newApiKeys[p]) {
      newApiKeys[p] = { ...newApiKeys[p], active: p === provider };
    }
  });

  await chrome.storage.local.set({
    apiKeys: newApiKeys,
    activeProvider: provider
  });

  return { apiKeys: newApiKeys, activeProvider: provider };
}

let dbReady = false;

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
    console.error('[YTAITutor] sidePanel setup failed:', err);
  });
});

async function ensureDbReady() {
  if (dbReady) {
    return true;
  }
  try {
    await notebookDB.init();
    dbReady = true;
    return true;
  } catch (err) {
    console.error('[YTAITutor] IndexedDB init failed:', err);
    return false;
  }
}

ensureDbReady();

function buildNotebookEntryFromChat(entryData) {
  return {
    id: entryData.id || generateUUID(),
    notebookId: entryData.notebookId,
    type: entryData.type || 'chat',
    createdAt: entryData.createdAt || new Date().toISOString(),
    question: entryData.question || null,
    answer: entryData.answer || null,
    explanationLevel: entryData.explanationLevel || null,
    overlay: entryData.overlay || null,
    noteText: entryData.noteText || null,
    videoId: entryData.videoId || null,
    videoTitle: entryData.videoTitle || null,
    videoUrl: entryData.videoUrl || null,
    timestamp: entryData.timestamp ?? 0,
    humanTime: entryData.humanTime || formatTime(entryData.timestamp || 0),
    imageId: entryData.imageId || null,
    imageDataUrl: entryData.imageDataUrl || null,
    transcriptExcerpt: entryData.transcriptExcerpt || null
  };
}

async function resolveNotebookEntryImages(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  const resolved = [];
  for (const entry of entries) {
    let imageDataUrl = entry.imageDataUrl || null;
    if (!imageDataUrl && entry.imageId) {
      imageDataUrl = await notebookDB.getImage(entry.imageId);
    }
    resolved.push({ ...entry, imageDataUrl });
  }
  return resolved;
}

function buildNotebookMarkdown(notebook, entries) {
  const lines = [`# ${notebook.title || 'Notebook'}`];
  if (notebook.description) {
    lines.push('', notebook.description);
  }
  lines.push('');

  entries.forEach((entry, index) => {
    lines.push(`## Entrée ${index + 1} — ${entry.videoTitle || 'Vidéo'}`);
    if (entry.type === 'note') {
      lines.push(`**Note**\n${entry.noteText || ''}`);
    } else {
      lines.push(`**Question :** ${entry.question || ''}`);
      lines.push(`**Réponse :** ${entry.answer || ''}`);
    }
    if (entry.imageDataUrl) {
      lines.push(`![Frame](${entry.imageDataUrl})`);
    }
    lines.push('');
  });

  return lines.join('\n').trim();
}

function buildNotebookJson(notebook, entries) {
  return JSON.stringify({ notebook, entries }, null, 2);
}

function escapePdfText(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildSimplePdfDataUrl(text) {
  const lines = String(text || '').split('\n');
  
  // Set initial text matrix (50, 750), text leading (15 TL) and then shift down for each line
  const contentLines = ['BT', '/F1 12 Tf', '15 TL', '50 750 Td'];
  lines.forEach((line) => {
    contentLines.push(`(${escapePdfText(line)}) Tj`, 'T*');
  });
  contentLines.push('ET');
  
  const contentStream = contentLines.join('\n');
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj',
    `4 0 obj << /Length ${contentStream.length} >> stream\n${contentStream}\nendstream endobj`,
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> endobj'
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((obj) => {
    offsets.push(pdf.length);
    pdf += obj + '\n';
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  offsets.forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  // Encode safely as base64
  let binary = "";
  for (let i = 0; i < pdf.length; i++) {
    binary += String.fromCharCode(pdf.charCodeAt(i) & 0xff);
  }
  const base64 = btoa(binary);

  return `data:application/pdf;base64,${base64}`;
}

/**
 * Obfuscates an API key for local storage.
 * @param {string} key
 * @returns {string}
 */
function obfuscateKey(key) {
  return btoa(key.split('').map((c, i) =>
    String.fromCharCode(c.charCodeAt(0) ^ SALT.charCodeAt(i % SALT.length))
  ).join(''));
}

/**
 * Deobfuscates a stored API key.
 * @param {string} obf
 * @returns {string}
 */
function deobfuscateKey(obf) {
  const key = atob(obf);
  return key.split('').map((c, i) =>
    String.fromCharCode(c.charCodeAt(0) ^ SALT.charCodeAt(i % SALT.length))
  ).join('');
}

/**
 * Returns the chrome.storage.local key for a cached transcript.
 * @param {string} videoId
 * @returns {string}
 */
function getTranscriptCacheKey(videoId) {
  return `transcript_cache_${videoId}`;
}

/**
 * Reads cached transcript segments if still fresh (< 1 hour).
 * @param {string|null} videoId
 * @returns {Promise<Array<{start: number, duration: number, text: string}>|null>}
 */
async function getCachedTranscriptLines(videoId) {
  if (!videoId) {
    return null;
  }

  try {
    const key = getTranscriptCacheKey(videoId);
    const stored = await chrome.storage.local.get(key);
    const cache = stored[key];
    const segments = cache?.segments || cache?.lines;
    if (!segments?.length || !cache.fetchedAt) {
      return null;
    }
    if (Date.now() - cache.fetchedAt > TRANSCRIPT_CACHE_TTL_MS) {
      return null;
    }

    console.log(
      '[YTAITutor] Cache transcript utilisé :',
      segments.length,
      'segments,',
      cache.charCount || 0,
      'chars (source:',
      cache.source || 'unknown',
      ')'
    );
    return segments;
  } catch (err) {
    console.error('[YTAITutor] getCachedTranscriptLines:', err);
    return null;
  }
}

/**
 * Stores full transcript segments in chrome.storage.local.
 * @param {string} videoId
 * @param {Array<{start: number, duration: number, text: string}>} lines
 * @param {string} source
 * @returns {Promise<void>}
 */
async function setCachedTranscriptLines(videoId, lines, source) {
  if (!videoId || !lines?.length) {
    return;
  }

  try {
    const fullText = linesToFullText(lines);
    const key = getTranscriptCacheKey(videoId);
    await chrome.storage.local.set({
      [key]: {
        segments: lines,
        fetchedAt: Date.now(),
        source,
        segmentCount: lines.length,
        charCount: fullText.length
      }
    });
  } catch (err) {
    console.error('[YTAITutor] setCachedTranscriptLines:', err);
  }
}

/**
 * Joins transcript segments into a single normalized string.
 * @param {Array<{text: string}>} lines
 * @returns {string}
 */
function linesToFullText(lines) {
  return lines.map((line) => line.text).join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Builds the transcript text sent to Gemini (windowed excerpt or full when requested).
 * @param {Array<{start: number, duration: number, text: string}>} lines
 * @param {number} currentTime
 * @param {number} before
 * @param {number} after
 * @param {{ preferFull?: boolean }} [options]
 * @returns {{text: string, isFull: boolean, segmentCount: number, charCount: number}}
 */
function buildTranscriptForPrompt(lines, currentTime, before = TRANSCRIPT_DEFAULT_BEFORE_SEC, after = TRANSCRIPT_DEFAULT_AFTER_SEC, options = {}) {
  const fullText = linesToFullText(lines);
  const segmentCount = lines.length;
  const preferFull = options.preferFull === true;

  if (preferFull && fullText.length <= TRANSCRIPT_FULL_MAX_CHARS) {
    console.log('[YTAITutor] Prompt Gemini : transcript complet envoyé (' + fullText.length + ' chars)');
    return { text: fullText, isFull: true, segmentCount, charCount: fullText.length };
  }

  const windowText = getTranscriptWindow(lines, currentTime, before, after)
    || fullText.slice(0, TRANSCRIPT_FULL_MAX_CHARS);
  console.log(
    '[YTAITutor] Fenêtre appliquée :',
    before + 's avant,',
    after + 's après =',
    windowText.length,
    'chars'
  );
  console.log('[YTAITutor] Prompt Gemini : extrait de transcription envoyé (' + windowText.length + ' chars)');
  return { text: windowText.trim(), isFull: false, segmentCount, charCount: windowText.length };
}

/**
 * Returns both local and global transcript sections for the prompt.
 * @param {Array<{start: number, duration: number, text: string}>} lines
 * @param {number} currentTime
 * @param {number} before
 * @param {number} after
 * @param {{ preferFull?: boolean }} [options]
 * @returns {{ local: object, global: object, localText: string, globalText: string, localPreviewText: string, globalPreviewText: string, localCharCount: number, globalCharCount: number, localTokens: number, globalTokens: number }}
 */
function buildTranscriptSections(lines, currentTime, before = TRANSCRIPT_DEFAULT_BEFORE_SEC, after = TRANSCRIPT_DEFAULT_AFTER_SEC, options = {}) {
  const fullText = linesToFullText(lines);
  const segmentCount = lines.length;
  const local = buildTranscriptForPrompt(lines, currentTime, before, after, { preferFull: false });
  const global = {
    text: fullText,
    isFull: true,
    segmentCount,
    charCount: fullText.length
  };

  return {
    local,
    global,
    localText: local.text,
    globalText: global.text,
    localPreviewText: getTranscriptWindow(lines, currentTime, before, after) || local.text.slice(0, 500),
    globalPreviewText: fullText.slice(0, 500),
    localCharCount: local.charCount,
    globalCharCount: global.charCount,
    localTokens: estimateTranscriptTokens(local.charCount),
    globalTokens: estimateTranscriptTokens(global.charCount)
  };
}

/**
 * Estimates token count from character count (~4 chars per token).
 * @param {number} charCount
 * @returns {number}
 */
function estimateTranscriptTokens(charCount) {
  return Math.max(0, Math.ceil(charCount / 4));
}

const TRANSCRIPT_API_BASE = 'https://youtube-transcript.ai/transcript';
const TRANSCRIPT_API_TIMEOUT_MS = 15000;

/**
 * Converts a [m:ss] or [h:mm:ss] timestamp string to seconds.
 * @param {string} value
 * @returns {number}
 */
function parseApiTimestamp(value) {
  if (!value) {
    return 0;
  }
  const parts = value.split(':').map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return Number(value) || 0;
}

/**
 * Fetches complete transcript from youtube-transcript.ai API.
 * @param {string} videoId
 * @param {string} lang
 * @returns {Promise<Array<{start: number, duration: number, text: string}>|null>}
 */
async function fetchTranscriptFromAPI(videoId, lang = 'fr') {
  if (!videoId) {
    return null;
  }

  const url = `${TRANSCRIPT_API_BASE}/${encodeURIComponent(videoId)}.txt?lang=${encodeURIComponent(lang)}`;
  console.log('[YTAITutor] Fetching transcript from API:', url);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TRANSCRIPT_API_TIMEOUT_MS);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'text/plain, text/markdown, */*'
      }
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const reason = response.status === 429 ? 'rate limit' : response.statusText || 'error';
      console.warn('[YTAITutor] Transcript API failed:', response.status, '(' + reason + ')');
      return null;
    }

    const text = await response.text();
    if (!text || text.trim().length < 50) {
      console.warn('[YTAITutor] Transcript API returned empty or too short response');
      return null;
    }

    console.log('[YTAITutor] Transcript received:', text.length, 'chars');
    const segments = parseTranscriptAPIText(text);
    return segments.length ? segments : null;
  } catch (err) {
    if (err?.name === 'AbortError') {
      console.warn('[YTAITutor] Transcript API timeout after', TRANSCRIPT_API_TIMEOUT_MS, 'ms');
    } else {
      console.error('[YTAITutor] fetchTranscriptFromAPI:', err);
    }
    return null;
  }
}

/**
 * Parses the markdown text response from youtube-transcript.ai into segments.
 * @param {string} text
 * @returns {Array<{start: number, duration: number, text: string}>}
 */
function parseTranscriptAPIText(text) {
  const segments = [];
  const timestampPattern = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.*)/;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') && !line.includes('[')) {
      continue;
    }

    const match = line.match(timestampPattern);
    if (!match) {
      continue;
    }

    const start = parseApiTimestamp(match[1]);
    const segmentText = match[2].replace(/^#+\s*/, '').trim();
    if (segmentText) {
      segments.push({ start, duration: 0, text: segmentText });
    }
  }

  for (let i = 0; i < segments.length; i += 1) {
    if (i < segments.length - 1) {
      segments[i].duration = Math.max(0.5, segments[i + 1].start - segments[i].start);
    } else {
      segments[i].duration = 3;
    }
  }

  console.log('[YTAITutor] Parsed segments:', segments.length);
  return segments;
}

/**
 * Finds the transcript anchor closest to the captured moment.
 * This prevents the selected interval from drifting when the user narrows the context window.
 * @param {Array<{start: number, text: string}>} lines
 * @param {number} currentTime
 * @returns {number}
 */
function resolveTranscriptWindowCenter(lines, currentTime) {
  if (!lines?.length || !Number.isFinite(currentTime)) {
    return Number(currentTime) || 0;
  }

  const validLines = lines.filter((line) => Number.isFinite(line?.start));
  if (!validLines.length) {
    return Number(currentTime) || 0;
  }

  const nearest = validLines.reduce((best, line) => {
    const bestDiff = Math.abs((best?.start ?? currentTime) - currentTime);
    const diff = Math.abs(line.start - currentTime);
    return diff < bestDiff ? line : best;
  }, validLines[0]);

  return Number(nearest?.start ?? currentTime) || 0;
}

/**
 * Returns transcript lines within a time window around currentTime.
 * @param {Array<{start: number, text: string}>} lines
 * @param {number} currentTime
 * @param {number} before
 * @param {number} after
 * @returns {string}
 */
function getTranscriptWindow(lines, currentTime, before = 60, after = 30) {
  if (!lines?.length) {
    return '';
  }

  const centerTime = resolveTranscriptWindowCenter(lines, currentTime);
  return lines
    .filter((line) => line.start >= centerTime - before && line.start <= centerTime + after)
    .map((line) => line.text)
    .join(' ')
    .trim();
}

/**
 * Simplified local fallback when the external API is unavailable.
 * @param {number|null} tabId
 * @param {string|null} videoId
 * @returns {Promise<Array<{start: number, duration: number, text: string}>|null>}
 */
async function fetchTranscriptLocalFallback(tabId, videoId) {
  console.log('[YTAITutor] Fallback to local methods...');
  let lines = null;

  if (tabId) {
    try {
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: async () => {
          try {
            const playerResponse = window.ytInitialPlayerResponse
              || window.ytInitialData?.playerResponse
              || null;
            const tracks = playerResponse?.captions?.captionTracks || [];
            if (!tracks.length) {
              return null;
            }

            const lang = (document.documentElement.lang || navigator.language || 'fr').slice(0, 2);
            const track = tracks.find((t) => t.kind !== 'asr' && t.languageCode?.startsWith(lang))
              || tracks.find((t) => t.languageCode?.startsWith(lang))
              || tracks.find((t) => t.kind === 'asr')
              || tracks[0];

            if (!track?.baseUrl) {
              return null;
            }

            const normalized = track.baseUrl.startsWith('http')
              ? track.baseUrl
              : `https://www.youtube.com${track.baseUrl.startsWith('/') ? '' : '/'}${track.baseUrl}`;
            const urlObj = new URL(normalized);
            urlObj.searchParams.set('fmt', 'json3');

            const resp = await fetch(urlObj.toString(), {
              credentials: 'include',
              headers: {
                'Accept-Language': document.documentElement.lang || 'fr',
                Referer: window.location.href
              }
            });

            if (!resp.ok) {
              return null;
            }

            const payload = await resp.text();
            const data = JSON.parse(payload);
            const events = data?.events || [];
            return events
              .filter((event) => event.segs)
              .map((event) => ({
                start: (event.tStartMs || 0) / 1000,
                duration: (event.dDurationMs || 0) / 1000,
                text: (event.segs || []).map((seg) => seg.utf8 || '').join('').replace(/\n/g, ' ').trim()
              }))
              .filter((line) => line.text);
          } catch {
            return null;
          }
        }
      });
      lines = injection?.result?.length ? injection.result : null;
    } catch (err) {
      console.error('[YTAITutor] Local fallback MAIN world:', err);
    }
  }

  if (!lines?.length && tabId && videoId) {
    try {
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: async (vid) => {
          try {
            const apiKeyMatch = document.documentElement.innerHTML.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
            const apiKey = apiKeyMatch ? apiKeyMatch[1] : null;
            const visitorData = window.ytcfg?.get?.('VISITOR_DATA')
              || window.ytcfg?.data_?.VISITOR_DATA
              || '';
            const params = btoa(String.fromCharCode(10, vid.length) + vid);
            return { apiKey, visitorData, params };
          } catch {
            return null;
          }
        },
        args: [videoId]
      });

      const { apiKey, visitorData, params } = injection?.result || {};
      if (apiKey) {
        const context = {
          client: {
            clientName: 'ANDROID',
            clientVersion: '20.10.38',
            hl: 'fr',
            gl: 'FR',
            platform: 'MOBILE'
          }
        };
        if (visitorData) {
          context.client.visitorData = visitorData;
        }

        const resp = await fetch(
          `https://www.youtube.com/youtubei/v1/get_transcript?key=${apiKey}&prettyPrint=false`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-YouTube-Client-Name': '3',
              'X-YouTube-Client-Version': '20.10.38',
              'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip'
            },
            body: JSON.stringify({ context, params, externalChannelId: '' })
          }
        );

        if (resp.ok) {
          const data = await resp.json();
          const renderers = [];
          const walk = (node, depth) => {
            if (!node || depth > 25) {
              return;
            }
            if (node.transcriptSegmentRenderer) {
              renderers.push(node.transcriptSegmentRenderer);
            }
            if (Array.isArray(node)) {
              node.forEach((item) => walk(item, depth + 1));
              return;
            }
            if (typeof node === 'object') {
              Object.values(node).forEach((value) => walk(value, depth + 1));
            }
          };
          walk(data, 0);

          if (renderers.length) {
            lines = renderers.map((renderer) => {
              const startMs = parseInt(renderer.startMs || renderer.startTimeMs || 0, 10);
              const endMs = parseInt(renderer.endMs || renderer.endTimeMs || 0, 10);
              const text = (renderer.snippet?.runs || [])
                .map((run) => run.text)
                .join('')
                || renderer.snippet?.simpleText
                || renderer.cue?.simpleText
                || renderer.text?.simpleText
                || '';
              return {
                start: startMs / 1000,
                duration: Math.max(0, (endMs - startMs) / 1000),
                text: text.replace(/\n/g, ' ').trim()
              };
            }).filter((line) => line.text);
          }
        }
      }
    } catch (err) {
      console.error('[YTAITutor] Local fallback Innertube:', err);
    }
  }

  if (lines?.length) {
    const charCount = linesToFullText(lines).length;
    console.log('[YTAITutor] Local fallback:', lines.length, 'segments found (' + charCount + ' chars)');
    if (charCount < 200) {
      console.warn('[YTAITutor] Warning: transcription incomplete, using image-only context');
    }
    return lines;
  }

  console.warn('[YTAITutor] Local fallback: no segments found');
  return null;
}

/**
 * Gets cached transcript or fetches from API (with local fallback).
 * @param {string|null} videoId
 * @param {number|null} tabId
 * @param {string} lang
 * @param {{ forceRefresh?: boolean }} [options]
 * @returns {Promise<Array<{start: number, duration: number, text: string}>|null>}
 */
async function getCachedOrFetchTranscript(videoId, tabId, lang = 'fr', options = {}) {
  console.log('[YTAITutor] Récupération transcription pour', videoId || 'video inconnue');

  if (!videoId && !tabId) {
    console.warn('[YTAITutor] getCachedOrFetchTranscript : pas de videoId ni tabId');
    return null;
  }

  if (videoId && !options.forceRefresh) {
    const cached = await getCachedTranscriptLines(videoId);
    if (cached?.length) {
      return cached;
    }
  }

  let lines = null;
  let source = null;

  if (videoId) {
    lines = await fetchTranscriptFromAPI(videoId, lang);
    if (lines?.length) {
      source = 'youtube-transcript.ai';
    }
  }

  if (!lines?.length) {
    lines = await fetchTranscriptLocalFallback(tabId, videoId);
    if (lines?.length) {
      source = 'local-fallback';
    }
  }

  if (lines?.length && videoId) {
    const charCount = linesToFullText(lines).length;
    console.log('[YTAITutor] Transcription complète :', lines.length, 'segments,', charCount, 'chars');
    await setCachedTranscriptLines(videoId, lines, source || 'unknown');
    return lines;
  }

  console.warn('[YTAITutor] Aucune transcription disponible pour', videoId || 'cette vidéo');
  return null;
}

/**
 * Resolves transcript text for capture preview and Gemini context.
 * @param {number|null} tabId
 * @param {string|null} videoId
 * @param {number} currentTime
 * @param {number} before
 * @param {number} after
 * @param {string} [lang]
 * @param {{ forceRefresh?: boolean, preferFull?: boolean }} [options]
 * @returns {Promise<{text: string, isFull: boolean, segmentCount: number, charCount: number, previewText: string}>}
 */
async function resolveTranscriptForCapture(tabId, videoId, currentTime, before = TRANSCRIPT_DEFAULT_BEFORE_SEC, after = TRANSCRIPT_DEFAULT_AFTER_SEC, lang = 'fr', options = {}) {
  console.log('[YTAITutor] resolveTranscriptForCapture :', {
    videoId,
    tabId,
    currentTime,
    before,
    after,
    lang
  });

  if (!videoId && !tabId) {
    console.warn('[YTAITutor] resolveTranscriptForCapture : pas de videoId ni tabId');
    return { text: '', isFull: false, segmentCount: 0, charCount: 0, previewText: '' };
  }

  const tab = tabId ? { id: tabId } : await findYouTubeVideoTab(videoId);
  const resolvedTabId = tab?.id || tabId || null;

  const lines = await getCachedOrFetchTranscript(videoId, resolvedTabId, lang, options);
  if (!lines?.length) {
    console.warn('[YTAITutor] Fenêtre transcript : (vide — aucune source)');
    return { text: '', isFull: false, segmentCount: 0, charCount: 0, previewText: '' };
  }

  const fullCharCount = linesToFullText(lines).length;
  console.log('[YTAITutor] Transcription récupérée :', lines.length, 'segments,', fullCharCount, 'chars');

  const prompt = buildTranscriptForPrompt(lines, currentTime, before, after, {
    preferFull: options.preferFull === true
  });
  const previewText = getTranscriptWindow(lines, currentTime, before, after)
    || lines.slice(0, 8).map((line) => line.text).join(' ').trim();

  if (previewText) {
    const preview = previewText.slice(0, 120);
    console.log(
      '[YTAITutor] Fenêtre appliquée :',
      before + 's avant,',
      after + 's après =',
      previewText.length,
      'chars'
    );
    console.log('[YTAITutor] Fenêtre transcript :', `"${preview}${previewText.length > 120 ? '…' : ''}"`);
  }

  return {
    ...prompt,
    previewText: previewText.trim()
  };
}

/**
 * Builds the system prompt for the tutor.
 * @param {string} level
 * @param {string[]} [frameLabels] Ordered image labels sent to Gemini
 * @returns {string}
 */
function buildSystemPrompt(level = 'Licence', frameLabels = null) {
  const levels = {
    ELI5: "Explique comme si j'avais 5 ans. Utilise des analogies simples.",
    'Lycée': 'Explique comme pour un élève de lycée. Pas trop technique.',
    Licence: 'Explique avec le niveau universitaire de licence.',
    Expert: 'Explique avec le niveau expert. Sois concis et technique.'
  };

  const defaultFrameLines = [
    'T-X (contexte AVANT le moment de la question)',
    'T0 (le moment EXACT de la question) — peut être annotée manuellement',
    'T+X (contexte APRÈS le moment de la question)'
  ];
  const labels = frameLabels?.length ? frameLabels : defaultFrameLines;
  const frameBlock = labels.map((label, index) => `${index + 1}. ${label}`).join('\n');

  return `Tu es un tuteur pédagogique expert pour des vidéos YouTube.

Règle de langue (prioritaire) : réponds dans la même langue que la question de l'utilisateur.
- Question en français → réponse en français
- Question en anglais → réponse en anglais
- Question en espagnol, arabe, etc. → réponse dans cette langue
Ne change de langue que si l'utilisateur le demande explicitement (ex. « réponds en anglais », « answer in French », « en español por favor »).

Tu reçois ${labels.length} image(s) dans l'ordre chronologique suivant :
${frameBlock}

Tu reçois aussi un bloc « Contexte vidéo » contenant :
- Les métadonnées vidéo (titre, lien YouTube, timestamp)
- Un extrait ou la transcription complète (section --- DEBUT TRANSCRIPTION --- / --- FIN TRANSCRIPTION ---)

Analyse les images dans cet ordre pour comprendre la progression visuelle.
Concentre-toi sur T0 pour la question spécifique, mais utilise T-X et T+X pour le contexte temporel.
Quand T0 est annotée (flèches, cercles, texte), traite ces marques comme l'indication explicite de l'utilisateur.

Quand la section transcription est présente, tu DOIS t'en servir pour enrichir ta réponse (vocabulaire, contexte oral, explications du narrateur).

Si l'utilisateur demande si tu as la transcription ou le lien, réponds selon le bloc contexte. Sinon, réponds directement à sa question.

Si la transcription est absente, base-toi sur les images et le titre. ${levels[level] || levels.Licence}

Réponds de manière claire et structurée avec du Markdown : titres (##), listes à puces, gras pour les points clés, blocs de code si nécessaire.
Pour les formules mathématiques, utilise LaTeX avec $...$ (inline) ou $$...$$ (bloc).

Si pertinent, tu peux demander un overlay visuel en répondant au format JSON :
{
  "answer": "ton explication textuelle",
  "needs_overlay": false,
  "overlay_elements": []
}

Les coordonnées overlay sont en ratio (0-1) par rapport à la taille de la vidéo.`;
}

/**
 * Builds the video context block sent to Gemini alongside the image.
 * @param {object} params
 * @param {boolean} [params.transcriptIsFull]
 * @returns {string}
 */
function buildVideoContextBlock({ videoId, videoTitle, currentTime, transcriptWindow, transcriptSections = null, annotated, selectedFrame, transcriptIsFull = false }) {
  const lines = [
    '=== Contexte vidéo ===',
    `Titre : ${videoTitle || 'Inconnu'}`
  ];

  if (videoId) {
    const seconds = Math.max(0, Math.floor(currentTime || 0));
    lines.push(`Lien : https://www.youtube.com/watch?v=${videoId}&t=${seconds}s`);
    lines.push(`Moment capturé : ${formatTime(currentTime || 0)} (${seconds}s)`);
  } else {
    lines.push('Lien : non disponible');
  }

  if (annotated) {
    lines.push(
      '',
      'Image annotée : l\'utilisateur a dessiné sur la capture (flèches rouges, cercles verts, texte, éventuel crop).',
      'Interprète ces marques comme sa zone d\'attention ou l\'élément qu\'il questionne.'
    );
    if (selectedFrame) {
      lines.push(`Frame choisie : ${selectedFrame}`);
    }
  }

  const localText = transcriptSections?.localText?.trim() || transcriptWindow?.trim();
  const globalText = transcriptSections?.globalText?.trim();

  if (localText) {
    const prefix = transcriptIsFull ? '[CONTEXTE LOCAL — TRANSCRIPTION COMPLÈTE]' : '[CONTEXTE LOCAL]';
    lines.push(
      '',
      prefix,
      '--- DEBUT CONTEXTE LOCAL ---',
      localText,
      '--- FIN CONTEXTE LOCAL ---'
    );
  }

  if (globalText && globalText !== localText) {
    lines.push(
      '',
      '[TRANSCRIPTION GLOBALE DE LA VIDÉO]',
      '--- DEBUT TRANSCRIPTION GLOBALE ---',
      globalText,
      '--- FIN TRANSCRIPTION GLOBALE ---'
    );
  }

  if (!localText && !globalText) {
    lines.push(
      '',
      '--- DEBUT TRANSCRIPTION ---',
      '(non disponible — sous-titres absents ou non récupérés)',
      '--- FIN TRANSCRIPTION ---'
    );
  } else {
    lines.push('', 'Utilise ces blocs de transcription avec les images pour répondre.');
  }

  return lines.join('\n');
}

const GEMINI_MAX_IMAGE_PAYLOAD_BYTES = 4 * 1024 * 1024;

/**
 * Resolves a frame offset relative to T0 for chronological sorting.
 * @param {object} frame
 * @param {number} t0Time
 * @returns {number}
 */
function resolveFrameOffset(frame, t0Time) {
  if (frame.offset != null) {
    return frame.offset;
  }
  if (frame.label === 'T0' || /^T0\b/.test(frame.label || '')) {
    return 0;
  }
  return (frame.time ?? t0Time) - t0Time;
}

/**
 * Compares two frames for chronological order (T-X, T0, T+X).
 * @param {object} a
 * @param {object} b
 * @param {number} t0Time
 * @returns {number}
 */
function compareFrameOrder(a, b, t0Time) {
  const offsetA = resolveFrameOffset(a, t0Time);
  const offsetB = resolveFrameOffset(b, t0Time);
  if (offsetA !== offsetB) {
    return offsetA - offsetB;
  }
  return (a.time ?? t0Time) - (b.time ?? t0Time);
}

/**
 * Builds ordered Gemini frame payloads from capture metadata and optional T0 data URL.
 * @param {object} captureMeta
 * @param {string|null} imageDataUrl
 * @returns {Promise<Array<{label: string, data: string, time: number, offset: number}>>}
 */
async function buildGeminiFrameImages(captureMeta, imageDataUrl) {
  await ensureDbReady();
  const t0Time = captureMeta.currentTime ?? 0;
  const frameImages = [];

  if (captureMeta.frames?.length && dbReady) {
    for (const frame of captureMeta.frames) {
      const isT0 = frame.label === 'T0' || /^T0\b/.test(frame.label || '');
      let frameDataUrl = null;

      if (isT0) {
        frameDataUrl = imageDataUrl
          || (frame.imageId ? await notebookDB.getImage(frame.imageId) : null)
          || (captureMeta.imageId ? await notebookDB.getImage(captureMeta.imageId) : null);
      } else if (frame.imageId) {
        frameDataUrl = await notebookDB.getImage(frame.imageId);
      }

      if (!frameDataUrl) {
        if (!isT0) {
          console.warn(`[YTAITutor] Frame ${frame.label} manquante dans IndexedDB (imageId: ${frame.imageId})`);
        }
        continue;
      }

      const base64 = frameDataUrl.includes(',') ? frameDataUrl.split(',')[1] : frameDataUrl;
      const offset = resolveFrameOffset(frame, t0Time);
      const contextSide = offset < 0 ? 'avant' : 'après';
      const displayLabel = isT0
        ? `${frame.label} (moment exact)`
        : `${frame.label} (contexte ${contextSide})`;

      frameImages.push({
        label: displayLabel,
        data: base64,
        time: frame.time ?? t0Time,
        offset
      });
    }
  } else {
    let t0DataUrl = imageDataUrl;
    if (!t0DataUrl && dbReady && captureMeta.imageId) {
      t0DataUrl = await notebookDB.getImage(captureMeta.imageId);
    }
    if (t0DataUrl) {
      const base64 = t0DataUrl.includes(',') ? t0DataUrl.split(',')[1] : t0DataUrl;
      frameImages.push({
        label: 'T0 (moment exact)',
        data: base64,
        time: t0Time,
        offset: 0
      });
    }
  }

  frameImages.sort((a, b) => compareFrameOrder(a, b, t0Time));

  console.log('[YTAITutor] Ordre images Gemini:', frameImages.map((frame) => frame.label).join(' → '));

  const totalBytes = frameImages.reduce((sum, frame) => sum + frame.data.length, 0);
  if (totalBytes > GEMINI_MAX_IMAGE_PAYLOAD_BYTES && frameImages.length > 2) {
    const beforeFrames = frameImages.filter((frame) => resolveFrameOffset(frame, t0Time) < 0);
    const t0Frame = frameImages.find((frame) => resolveFrameOffset(frame, t0Time) === 0);
    const reduced = [
      ...(beforeFrames.length ? [beforeFrames[beforeFrames.length - 1]] : []),
      ...(t0Frame ? [t0Frame] : [])
    ];
    console.warn('[YTAITutor] Payload images trop lourd, envoi T-X + T0 uniquement');
    return reduced;
  }

  return frameImages;
}

/**
 * Processes LLM raw text response, attempting standard and fallback JSON parsing.
 * @param {string} text - Raw text from the LLM
 * @returns {{success: boolean, text: string, overlay: any[]|null, raw: string}}
 */
function processLLMTextResponse(text) {
  const parsed = extractJSON(text);
  if (parsed && parsed.answer) {
    return {
      success: true,
      text: parsed.answer,
      overlay: parsed.needs_overlay ? parsed.overlay_elements : null,
      raw: text
    };
  }

  // Fallback for truncated/malformed JSON
  const partial = extractAnswerFromPossiblyTruncatedJSON(text);
  if (partial && partial.answer) {
    return {
      success: true,
      text: partial.answer,
      overlay: null,
      raw: text
    };
  }

  return { success: true, text, raw: text };
}

/**
 * Calls the Gemini generateContent API.
 * @param {string} systemPrompt
 * @param {string|null} question
 * @param {Array<{label: string, data: string}>} frameImages
 * @param {string} videoContext
 * @param {string} apiKey
 * @param {string} model
 * @param {string} resolvedTranscript
 * @returns {Promise<{success: boolean, text?: string, overlay?: object[]|null, raw?: string, error?: string}>}
 */
async function callGemini(systemPrompt, question, frameImages, videoContext, apiKey, model = GEMINI_DEFAULT_MODEL, resolvedTranscript = '') {
  const resolvedModel = resolveGeminiModel(model);

  try {
    console.log('[YTAITutor] === ENVOI GEMINI ===');
    console.log('[YTAITutor] Images:', frameImages.length, '(T0 + contexte)');
    console.log('[YTAITutor] Transcript length:', resolvedTranscript.length, 'chars');
    console.log('[YTAITutor] Transcript preview:', `${resolvedTranscript.slice(0, 200)}${resolvedTranscript.length > 200 ? '...' : ''}`);
    console.log('[YTAITutor] Prompt system length:', systemPrompt.length);

    const parts = [{ text: systemPrompt }];

    for (const frame of frameImages) {
      parts.push({ text: `\n[Image: ${frame.label}]` });
      parts.push({
        inline_data: {
          mime_type: 'image/jpeg',
          data: frame.data
        }
      });
    }

    parts.push({ text: `\n\n${videoContext}` });

    if (question) {
      parts.push({ text: `\n\nQuestion (réponds dans la langue de cette question, sauf demande explicite contraire) :\n${question}` });
    }

    const payload = {
      contents: [{ parts }],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 8192
      }
    };

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${resolvedModel}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      return { success: false, error: errData.error?.message || `HTTP ${response.status}` };
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Pas de réponse';
    return processLLMTextResponse(text);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function normalizeBase64ImageUrl(base64) {
  if (!base64) {
    return '';
  }
  if (base64.startsWith('data:image/')) {
    return base64;
  }
  return `data:image/jpeg;base64,${base64}`;
}

function formatOpenAIMessageContent(systemPrompt, question, frameImages, videoContext) {
  const content = [];
  for (const frame of frameImages) {
    content.push({
      type: 'image_url',
      image_url: { url: normalizeBase64ImageUrl(frame.data) }
    });
  }
  content.push({
    type: 'text',
    text: `${systemPrompt}\n\n${videoContext}${question ? `\n\nQuestion: ${question}` : ''}`
  });
  return content;
}

function formatAnthropicMessageContent(systemPrompt, question, frameImages, videoContext) {
  const content = [];
  for (const frame of frameImages) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: frame.data
      }
    });
  }
  content.push({
    type: 'text',
    text: `${systemPrompt}\n\n${videoContext}${question ? `\n\nQuestion: ${question}` : ''}`
  });
  return content;
}

async function callOpenAI(systemPrompt, question, frameImages, videoContext, apiKey, model = API_PROVIDERS.openai.defaultModel) {
  try {
    const messages = [
      {
        role: 'user',
        content: formatOpenAIMessageContent(systemPrompt, question, frameImages, videoContext)
      }
    ];

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 16384,
        temperature: 0.4
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      return { success: false, error: errData.error?.message || `HTTP ${response.status}` };
    }

    const data = await response.json();
    const message = data.choices?.[0]?.message;
    const text = typeof message?.content === 'string'
      ? message.content
      : message?.content?.text || message?.content?.parts?.[0]?.text || '';

    const processed = processLLMTextResponse(text || 'Pas de réponse');
    processed.raw = JSON.stringify(data);
    return processed;
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function callAnthropic(systemPrompt, question, frameImages, videoContext, apiKey, model = API_PROVIDERS.anthropic.defaultModel) {
  try {
    const content = formatAnthropicMessageContent(systemPrompt, question, frameImages, videoContext);
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        messages: [{ role: 'user', content }]
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      return { success: false, error: errData.error?.message || `HTTP ${response.status}` };
    }

    const data = await response.json();
    const message = data?.messages?.[0];
    const text = typeof message?.content === 'string'
      ? message.content
      : message?.content?.text || '';

    const processed = processLLMTextResponse(text || 'Pas de réponse');
    processed.raw = JSON.stringify(data);
    return processed;
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function callMistral(systemPrompt, question, frameImages, videoContext, apiKey, model = API_PROVIDERS.mistral.defaultModel) {
  try {
    const messages = [
      {
        role: 'user',
        content: formatOpenAIMessageContent(systemPrompt, question, frameImages, videoContext)
      }
    ];

    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 8192,
        temperature: 0.4
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      return { success: false, error: errData.error?.message || `HTTP ${response.status}` };
    }

    const data = await response.json();
    const message = data.choices?.[0]?.message;
    const text = typeof message?.content === 'string'
      ? message.content
      : message?.content?.text || message?.content?.parts?.[0]?.text || '';

    const processed = processLLMTextResponse(text || 'Pas de réponse');
    processed.raw = JSON.stringify(data);
    return processed;
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function callLLM(provider, systemPrompt, question, frameImages, videoContext, apiKey, model, resolvedTranscript = '') {
  switch (provider) {
    case 'openai':
      return callOpenAI(systemPrompt, question, frameImages, videoContext, apiKey, model);
    case 'anthropic':
      return callAnthropic(systemPrompt, question, frameImages, videoContext, apiKey, model);
    case 'mistral':
      return callMistral(systemPrompt, question, frameImages, videoContext, apiKey, model);
    case 'gemini':
    default:
      return callGemini(systemPrompt, question, frameImages, videoContext, apiKey, model, resolvedTranscript);
  }
}

/**
 * Checks if a URL is a YouTube video page.
 * @param {string|null|undefined} url
 * @returns {boolean}
 */
function isYouTubeVideoUrl(url) {
  if (!url || !url.includes('youtube.com')) {
    return false;
  }
  return url.includes('/watch') || url.includes('/shorts/') || url.includes('/live/');
}

/**
 * Extracts a YouTube video ID from a tab URL.
 * @param {string|null|undefined} url
 * @returns {string|null}
 */
function getVideoIdFromUrl(url) {
  try {
    if (!url) {
      return null;
    }
    const parsed = new URL(url);
    const fromQuery = parsed.searchParams.get('v');
    if (fromQuery) {
      return fromQuery;
    }
    const shortsMatch = parsed.pathname.match(/\/shorts\/([^/?]+)/);
    if (shortsMatch) {
      return shortsMatch[1];
    }
    const liveMatch = parsed.pathname.match(/\/live\/([^/?]+)/);
    return liveMatch ? liveMatch[1] : null;
  } catch {
    return null;
  }
}

/**
 * Finds the best YouTube video tab to capture from.
 * @param {string|null} preferredVideoId
 * @returns {Promise<chrome.tabs.Tab|null>}
 */
async function findYouTubeVideoTab(preferredVideoId = null) {
  const youtubeTabs = await chrome.tabs.query({
    url: ['*://www.youtube.com/*', '*://youtube.com/*']
  });
  const videoTabs = youtubeTabs.filter((tab) => isYouTubeVideoUrl(tab.url));

  if (preferredVideoId) {
    const match = videoTabs.find((tab) => getVideoIdFromUrl(tab.url) === preferredVideoId);
    if (match) {
      return match;
    }
  }

  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (isYouTubeVideoUrl(activeTab?.url)) {
    return activeTab;
  }

  return videoTabs[0] || null;
}

/**
 * Captures the current video frame directly in a tab via scripting API.
 * @param {number} tabId
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 */
async function captureFrameInTab(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['lib/utils.js', 'content/capture.js']
    });
  } catch {
    /* capture.js may already be present */
  }

  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async () => {
      try {
        const video = document.querySelector('video');
        if (!video || !video.videoWidth) {
          return {
            success: false,
            error: 'Aucune vidéo détectée. Ouvrez une vidéo YouTube (/watch ou /shorts).'
          };
        }

        video.pause();

        let videoId = new URLSearchParams(window.location.search).get('v');
        if (!videoId) {
          const shortsMatch = window.location.pathname.match(/\/shorts\/([^/?]+)/);
          videoId = shortsMatch ? shortsMatch[1] : null;
        }

        const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string')
          || document.querySelector('h1.ytd-watch-flexy')
          || document.querySelector('h1.title')
          || document.querySelector('h2.ytd-shorts-title')
          || document.querySelector('#title h1');
        const videoTitle = titleEl?.textContent?.trim() || document.title.replace(' - YouTube', '') || 'Unknown';

        let dataUrl;
        if (typeof CaptureEngine !== 'undefined') {
          dataUrl = await CaptureEngine.capture(video);
        } else {
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          canvas.getContext('2d').drawImage(video, 0, 0);
          dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        }

        const transcriptPayload = window.__YTAITUTOR_TRANSCRIPT__ || null;

        return {
          success: true,
          data: {
            videoId,
            videoTitle,
            currentTime: video.currentTime,
            dataUrl,
            transcriptLang: transcriptPayload?.language || null,
            timestamp: Date.now()
          }
        };
      } catch (err) {
        return { success: false, error: err.message || 'Erreur capture' };
      }
    }
  });

  const result = injection?.result || { success: false, error: 'Capture impossible sur cet onglet.' };

  return result;
}

/**
 * Stores capture data and returns the full capture object for the popup.
 * @param {object} data
 * @param {number|null} tabId
 * @returns {Promise<object>}
 */
async function storeCaptureAndLoad(data, tabId = null) {
  const imageId = generateUUID();

  await ensureDbReady();
  if (dbReady) {
    await notebookDB.storeImage(imageId, data.dataUrl);
  }

  const resolvedTabId = tabId || (await findYouTubeVideoTab(data.videoId))?.id || null;

  const transcriptResult = await resolveTranscriptForCapture(
    resolvedTabId,
    data.videoId,
    data.currentTime,
    TRANSCRIPT_DEFAULT_BEFORE_SEC,
    TRANSCRIPT_DEFAULT_AFTER_SEC,
    data.transcriptLang || 'fr'
  );

  const lastCapture = {
    videoId: data.videoId,
    videoTitle: data.videoTitle,
    currentTime: data.currentTime,
    imageId,
    transcriptLang: data.transcriptLang,
    transcriptText: transcriptResult.previewText || transcriptResult.text,
    transcriptIsFull: transcriptResult.isFull,
    transcriptSegmentCount: transcriptResult.segmentCount,
    beforeSec: TRANSCRIPT_DEFAULT_BEFORE_SEC,
    afterSec: TRANSCRIPT_DEFAULT_AFTER_SEC,
    transcriptPriority: 'standard',
    transcriptPreferFull: false,
    timestamp: Date.now()
  };

  await chrome.storage.local.set({ lastCapture });

  return {
    ...lastCapture,
    dataUrl: data.dataUrl,
    imageId
  };
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  (async () => {
    try {
      switch (request.action) {
        case 'storeAnnotatedCapture': {
          const {
            videoId,
            videoTitle,
            currentTime,
            dataUrl,
            cropRegion,
            beforeSec,
            afterSec,
            transcriptLang,
            transcriptPreferFull,
            transcriptPriority,
            transcriptMode,
            frames,
            frameSendMode,
            selectedFrame,
            annotated
          } = request.data;

          await ensureDbReady();

          const frameRecords = [];
          if (dbReady && Array.isArray(frames)) {
            for (const frame of frames) {
              if (!frame.dataUrl) {
                continue;
              }
              const frameImageId = generateUUID();
              await notebookDB.storeImage(frameImageId, frame.dataUrl);
              frameRecords.push({
                label: frame.label,
                imageId: frameImageId,
                time: frame.time,
                offset: frame.offset ?? null
              });
            }
            frameRecords.sort((a, b) => compareFrameOrder(a, b, currentTime));
          }

          const t0Record = frameRecords.find((frame) => frame.label === 'T0' || /^T0\b/.test(frame.label || ''));
          const imageId = t0Record?.imageId || generateUUID();
          if (!t0Record && dbReady) {
            await notebookDB.storeImage(imageId, dataUrl);
          }

          const tab = await findYouTubeVideoTab(videoId);
          const transcriptResult = await resolveTranscriptForCapture(
            tab?.id || null,
            videoId,
            currentTime,
            beforeSec ?? TRANSCRIPT_DEFAULT_BEFORE_SEC,
            afterSec ?? TRANSCRIPT_DEFAULT_AFTER_SEC,
            transcriptLang || 'fr',
            { preferFull: transcriptPreferFull === true }
          );

          await chrome.storage.local.set({
            lastCapture: {
              videoId,
              videoTitle,
              currentTime,
              imageId,
              transcriptLang,
              transcriptText: transcriptResult.previewText || transcriptResult.text,
              transcriptIsFull: transcriptResult.isFull,
              transcriptSegmentCount: transcriptResult.segmentCount,
              beforeSec: beforeSec ?? TRANSCRIPT_DEFAULT_BEFORE_SEC,
              afterSec: afterSec ?? TRANSCRIPT_DEFAULT_AFTER_SEC,
              transcriptPriority: transcriptPriority || 'custom',
              transcriptPreferFull: transcriptPreferFull === true,
              transcriptMode: transcriptMode || 'local',
              cropRegion: cropRegion || null,
              frames: frameRecords,
              frameSendMode: frameSendMode || 'contextual',
              selectedFrame: selectedFrame || 'T0',
              annotated: annotated ?? true,
              timestamp: Date.now()
            }
          });

          sendResponse({ success: true, imageId });
          break;
        }

        case 'storeCapture': {
          const { videoId, videoTitle, currentTime, dataUrl, transcriptLang } = request.data;
          const imageId = generateUUID();

          await ensureDbReady();
          if (dbReady) {
            await notebookDB.storeImage(imageId, dataUrl);
          }

          const tab = await findYouTubeVideoTab(videoId);
          const transcriptResult = videoId
            ? await resolveTranscriptForCapture(
              tab?.id || null,
              videoId,
              currentTime,
              TRANSCRIPT_DEFAULT_BEFORE_SEC,
              TRANSCRIPT_DEFAULT_AFTER_SEC,
              transcriptLang || 'fr'
            )
            : { text: '', isFull: false, segmentCount: 0, previewText: '' };

          await chrome.storage.local.set({
            lastCapture: {
              videoId,
              videoTitle,
              currentTime,
              imageId,
              transcriptLang,
              transcriptText: transcriptResult.previewText || transcriptResult.text,
              transcriptIsFull: transcriptResult.isFull,
              transcriptSegmentCount: transcriptResult.segmentCount,
              beforeSec: TRANSCRIPT_DEFAULT_BEFORE_SEC,
              afterSec: TRANSCRIPT_DEFAULT_AFTER_SEC,
              transcriptPriority: 'standard',
              transcriptPreferFull: false,
              timestamp: Date.now()
            }
          });

          sendResponse({ success: true, imageId });
          break;
        }

        case 'getCapture': {
          await ensureDbReady();
          const { lastCapture } = await chrome.storage.local.get('lastCapture');
          if (!lastCapture) {
            sendResponse(null);
            break;
          }

          let imageDataUrl = null;
          if (dbReady && lastCapture.imageId) {
            imageDataUrl = await notebookDB.getImage(lastCapture.imageId);
          }

          sendResponse({ ...lastCapture, dataUrl: imageDataUrl });
          break;
        }

        case 'storeApiKey': {
          const key = request.key?.trim();
          if (!key) {
            sendResponse({ success: false, error: 'Clé API invalide' });
            break;
          }

          const provider = request.provider || detectProviderFromKey(key) || 'gemini';
          const model = request.model || getProviderDefaultModel(provider);
          const result = await storeApiKeyForProvider(provider, key, model);
          sendResponse({ success: true, provider: result.activeProvider, apiKeys: result.apiKeys });
          break;
        }

        case 'getApiKeys': {
          const stored = await getStoredApiKeys();
          const apiKeys = {};
          Object.entries(stored.apiKeys).forEach(([provider, entry]) => {
            apiKeys[provider] = {
              ...entry,
              key: entry?.key ? deobfuscateKey(entry.key) : null
            };
          });
          sendResponse({ apiKeys, activeProvider: stored.activeProvider });
          break;
        }

        case 'getApiKey': {
          const stored = await getStoredApiKeys();
          const provider = stored.activeProvider || 'gemini';
          const entry = stored.apiKeys[provider] || {};
          sendResponse(entry.key ? { key: deobfuscateKey(entry.key), provider } : null);
          break;
        }

        case 'testApiKey': {
          const provider = request.provider || detectProviderFromKey(request.key) || 'gemini';
          const key = request.key?.trim();
          if (!key) {
            sendResponse({ valid: false, error: 'Clé API manquante' });
            break;
          }
          const model = request.model || getProviderDefaultModel(provider);
          const result = await callLLM(
            provider,
            'Réponds uniquement "OK".',
            null,
            [],
            '=== Contexte vidéo ===\nTest de connexion API.',
            key,
            model
          );
          sendResponse({ valid: result.success, error: result.error });
          break;
        }

        case 'askGemini':
        case 'askLLM': {
          const {
            question,
            imageDataUrl,
            videoId,
            videoTitle,
            explanationLevel,
            currentTime,
            beforeSec,
            afterSec,
            transcriptPreferFull,
            transcriptMode,
            provider: requestProvider,
            model: requestModel
          } = request;

          const stored = await getStoredApiKeys();
          const provider = requestProvider || stored.activeProvider || 'gemini';
          const apiKeys = stored.apiKeys || {};
          const apiKeyEntry = apiKeys[provider] || {};
          const apiKey = apiKeyEntry.key ? deobfuscateKey(apiKeyEntry.key) : null;
          const model = requestModel || apiKeyEntry.model || getProviderDefaultModel(provider);
          const captureMeta = (await chrome.storage.local.get('lastCapture')).lastCapture || {};

          if (!apiKey) {
            sendResponse({ error: `Clé API non configurée pour ${provider}` });
            break;
          }

          if (provider !== stored.activeProvider) {
            await setActiveProvider(provider);
          }

          const resolvedVideoId = videoId || captureMeta.videoId || null;
          const captureMatchesVideo = captureMeta.videoId && captureMeta.videoId === resolvedVideoId;
          const resolvedVideoTitle = videoTitle || captureMeta.videoTitle || 'Inconnu';
          const resolvedCurrentTime = currentTime ?? captureMeta.currentTime ?? 0;

          const finalBeforeSec = beforeSec
            ?? (captureMatchesVideo ? captureMeta.beforeSec : null)
            ?? TRANSCRIPT_DEFAULT_BEFORE_SEC;
          const finalAfterSec = afterSec
            ?? (captureMatchesVideo ? captureMeta.afterSec : null)
            ?? TRANSCRIPT_DEFAULT_AFTER_SEC;
          const finalPreferFull = transcriptPreferFull
            ?? (captureMatchesVideo ? captureMeta.transcriptPreferFull : false)
            ?? false;
          const finalTranscriptMode = transcriptMode
            ?? (captureMatchesVideo ? captureMeta.transcriptMode : null)
            ?? 'local';

          console.log('[YTAITutor] askLLM fenêtre transcript :', {
            provider,
            videoId: resolvedVideoId,
            beforeSec: finalBeforeSec,
            afterSec: finalAfterSec,
            preferFull: finalPreferFull,
            transcriptMode: finalTranscriptMode,
            captureMatchesVideo
          });

          const tab = await findYouTubeVideoTab(resolvedVideoId);
          const transcriptLang = captureMeta.transcriptLang || 'fr';
          const lines = resolvedVideoId
            ? await getCachedOrFetchTranscript(resolvedVideoId, tab?.id || null, transcriptLang)
            : null;

          let transcriptResult = {
            text: '',
            isFull: false,
            segmentCount: 0,
            charCount: 0,
            previewText: ''
          };
          let transcriptSections = null;

          if (lines?.length) {
            const sections = buildTranscriptSections(lines, resolvedCurrentTime, finalBeforeSec, finalAfterSec, { preferFull: finalPreferFull });
            transcriptSections = {
              localText: sections.localText,
              globalText: sections.globalText
            };

            if (finalTranscriptMode === 'global') {
              transcriptResult = { ...sections.global, previewText: sections.globalPreviewText };
            } else if (finalTranscriptMode === 'global-local') {
              transcriptResult = {
                text: `${sections.localText}\n\n${sections.globalText}`.trim(),
                isFull: false,
                segmentCount: sections.local.segmentCount,
                charCount: sections.local.charCount + sections.global.charCount + 200,
                previewText: `${sections.localPreviewText}\n\n${sections.globalPreviewText}`
              };
            } else {
              transcriptResult = { ...sections.local, previewText: sections.localPreviewText };
            }
          } else if (captureMatchesVideo && captureMeta.transcriptText?.trim()) {
            transcriptResult = {
              text: captureMeta.transcriptText,
              isFull: captureMeta.transcriptIsFull ?? false,
              segmentCount: captureMeta.transcriptSegmentCount ?? 0,
              charCount: captureMeta.transcriptText.length,
              previewText: captureMeta.transcriptText
            };
          }

          const resolvedTranscript = transcriptResult.text || '';

          if (resolvedTranscript.trim()) {
            await chrome.storage.local.set({
              lastCapture: {
                ...captureMeta,
                videoId: resolvedVideoId,
                videoTitle: resolvedVideoTitle,
                currentTime: resolvedCurrentTime,
                beforeSec: finalBeforeSec,
                afterSec: finalAfterSec,
                transcriptPreferFull: finalPreferFull,
                transcriptMode: finalTranscriptMode,
                transcriptText: transcriptResult.previewText || resolvedTranscript,
                transcriptIsFull: transcriptResult.isFull,
                transcriptSegmentCount: transcriptResult.segmentCount
              }
            });
          }

          const videoContext = buildVideoContextBlock({
            videoId: resolvedVideoId,
            videoTitle: resolvedVideoTitle,
            currentTime: resolvedCurrentTime,
            transcriptWindow: resolvedTranscript,
            transcriptSections,
            transcriptIsFull: transcriptResult.isFull,
            annotated: captureMeta.annotated ?? false,
            selectedFrame: captureMeta.selectedFrame || null
          });

          const frameImages = await buildGeminiFrameImages(captureMeta, imageDataUrl);
          const systemPrompt = buildSystemPrompt(
            explanationLevel,
            frameImages.map((frame) => frame.label)
          );

          const result = await callLLM(
            provider,
            systemPrompt,
            question,
            frameImages,
            videoContext,
            apiKey,
            model,
            resolvedTranscript
          );

          if (result.success) {
            result.imageId = request.imageId || captureMeta.imageId || null;
            const moment = {
              id: generateUUID(),
              timestamp: resolvedCurrentTime,
              humanTime: formatTime(resolvedCurrentTime),
              createdAt: new Date().toISOString(),
              frames: {
                t0: {
                  imageId: request.imageId || null,
                  annotated: captureMeta.annotated ?? false,
                  cropRegion: captureMeta.cropRegion || null
                }
              },
              conversation: [
                { role: 'user', content: question, timestamp: new Date().toISOString() },
                { role: 'assistant', content: result.text, overlay: result.overlay || null, timestamp: new Date().toISOString() }
              ],
              bookmarked: false,
              tags: [],
              tokenCost: 'unknown',
              explanationLevel: explanationLevel || 'Licence'
            };

            if (dbReady && resolvedVideoId) {
              try {
                await notebookDB.saveNotebook(resolvedVideoId, resolvedVideoTitle, 'Unknown', moment);
              } catch (dbErr) {
                console.warn('[YTAITutor] Notebook save failed (non-critical):', dbErr);
              }
            }
          }

          sendResponse(result);
          break;
        }

        case 'getNotebook': {
          if (!dbReady) {
            sendResponse(null);
            break;
          }
          sendResponse(await notebookDB.getNotebook(request.videoId || request.notebookId));
          break;
        }

        case 'createNotebook': {
          await ensureDbReady();
          const { title, description, color } = request;
          const notebook = await notebookDB.createNotebook({ title, description, color });
          sendResponse({ notebook });
          break;
        }

        case 'updateNotebook': {
          await ensureDbReady();
          const { notebookId, title, description, color } = request;
          const success = await notebookDB.updateNotebook(notebookId, { title, description, color });
          sendResponse({ success });
          break;
        }

        case 'deleteNotebook': {
          await ensureDbReady();
          const { notebookId } = request;
          const success = await notebookDB.deleteNotebook(notebookId);
          sendResponse({ success });
          break;
        }

        case 'listNotebooks':
        case 'getAllNotebooks': {
          if (!dbReady) {
            sendResponse([]);
            break;
          }
          sendResponse(await notebookDB.getAllNotebooks());
          break;
        }

        case 'addEntryToNotebook': {
          await ensureDbReady();
          const { notebookId, entry } = request;
          const savedEntry = await notebookDB.addEntryToNotebook(notebookId, entry);
          sendResponse({ entryId: savedEntry.id, entry: savedEntry });
          break;
        }

        case 'updateNotebookEntry': {
          await ensureDbReady();
          const { entryId, updates } = request;
          const success = await notebookDB.updateNotebookEntry(entryId, updates);
          sendResponse({ success });
          break;
        }

        case 'deleteNotebookEntry': {
          await ensureDbReady();
          const { entryId } = request;
          const success = await notebookDB.deleteNotebookEntry(entryId);
          sendResponse({ success });
          break;
        }

        case 'getNotebookEntries': {
          await ensureDbReady();
          const { notebookId } = request;
          const entries = await notebookDB.getNotebookEntries(notebookId);
          const resolved = await resolveNotebookEntryImages(entries);
          sendResponse(resolved);
          break;
        }

        case 'exportNotebook': {
          await ensureDbReady();
          const { notebookId, format } = request;
          const notebook = await notebookDB.getNotebook(notebookId);
          if (!notebook) {
            sendResponse({ error: 'Notebook introuvable' });
            break;
          }
          const entries = await notebookDB.getNotebookEntries(notebookId);
          const resolvedEntries = await resolveNotebookEntryImages(entries);

          let dataUrl = '';
          let filename = `${notebook.title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;

          if (format === 'markdown') {
            const md = buildNotebookMarkdown(notebook, resolvedEntries);
            dataUrl = `data:text/markdown;charset=utf-8,${encodeURIComponent(md)}`;
            filename += '.md';
          } else if (format === 'json') {
            const json = buildNotebookJson(notebook, resolvedEntries);
            dataUrl = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
            filename += '.json';
          } else {
            // pdf or fallback
            const txt = buildNotebookMarkdown(notebook, resolvedEntries);
            dataUrl = buildSimplePdfDataUrl(txt);
            filename += '.pdf';
          }

          sendResponse({ dataUrl, filename });
          break;
        }

        case 'saveSettings': {
          const provider = request.provider || 'gemini';
          const model = request.model || getProviderDefaultModel(provider);
          const result = await saveProviderSettings(provider, model);
          sendResponse({ success: true, model: result.apiKeys[provider]?.model || model, provider: result.activeProvider });
          break;
        }

        case 'getSettings': {
          const stored = await getStoredApiKeys();
          const provider = stored.activeProvider || 'gemini';
          const model = stored.apiKeys?.[provider]?.model || getProviderDefaultModel(provider);
          sendResponse({
            model,
            provider
          });
          break;
        }

        case 'captureFromActiveTab': {
          const tab = await findYouTubeVideoTab();
          if (!tab?.id) {
            sendResponse({
              success: false,
              error: 'Ouvrez une vidéo YouTube (youtube.com/watch) dans un onglet, puis réessayez.'
            });
            break;
          }

          const captureResult = await captureFrameInTab(tab.id);
          if (!captureResult?.success || !captureResult.data) {
            sendResponse({
              success: false,
              error: captureResult?.error || 'Impossible de capturer la frame vidéo.'
            });
            break;
          }

          const capture = await storeCaptureAndLoad(captureResult.data, tab.id);
          sendResponse({ success: true, capture, tabId: tab.id });
          break;
        }

        case 'openSidePanel':
        case 'openPopup': {
          const tabId = _sender.tab?.id;
          if (tabId) {
            await chrome.sidePanel.open({ tabId });
          }
          sendResponse({ success: true });
          break;
        }

        case 'previewTranscriptWindow': {
          const {
            videoId,
            currentTime = 0,
            beforeSec = TRANSCRIPT_DEFAULT_BEFORE_SEC,
            afterSec = TRANSCRIPT_DEFAULT_AFTER_SEC,
            transcriptPreferFull = false,
            transcriptMode = 'local',
            transcriptLang = null
          } = request;

          if (!videoId) {
            sendResponse({ charCount: 0, estimatedTokens: 0, beforeSec, afterSec, isFull: false, previewText: '' });
            break;
          }

          const tab = await findYouTubeVideoTab(videoId);
          const { lastCapture } = await chrome.storage.local.get('lastCapture');
          const lang = transcriptLang
            || (lastCapture?.videoId === videoId ? (lastCapture.transcriptLang || 'fr') : 'fr');
          const lines = await getCachedOrFetchTranscript(videoId, tab?.id || null, lang);

          if (!lines?.length) {
            sendResponse({ charCount: 0, estimatedTokens: 0, beforeSec, afterSec, isFull: false, previewText: '' });
            break;
          }

          const sections = buildTranscriptSections(lines, currentTime, beforeSec, afterSec, {
            preferFull: transcriptPreferFull
          });
          const localResult = sections.local;
          const globalResult = sections.global;

          let result = localResult;
          let previewText = sections.localPreviewText;
          let estimatedTokens = sections.localTokens;
          let charCount = sections.localCharCount;
          let isFull = localResult.isFull;
          let segmentCount = localResult.segmentCount;

          if (transcriptMode === 'global') {
            result = globalResult;
            previewText = sections.globalPreviewText;
            estimatedTokens = sections.globalTokens;
            charCount = sections.globalCharCount;
            isFull = globalResult.isFull;
            segmentCount = globalResult.segmentCount;
          } else if (transcriptMode === 'global-local') {
            result = {
              text: `${sections.localText}\n\n${sections.globalText}`.trim(),
              isFull: false,
              segmentCount: localResult.segmentCount,
              charCount: sections.localCharCount + sections.globalCharCount + 200
            };
            previewText = `${sections.localPreviewText}\n\n${sections.globalPreviewText}`;
            estimatedTokens = sections.localTokens + sections.globalTokens + 400;
            charCount = result.charCount;
            isFull = false;
          }

          sendResponse({
            charCount,
            estimatedTokens,
            beforeSec,
            afterSec,
            isFull,
            segmentCount,
            previewText,
            localTokens: sections.localTokens,
            globalTokens: sections.globalTokens,
            transcriptMode
          });
          break;
        }

        case 'updateTranscriptContext': {
          const { lastCapture } = await chrome.storage.local.get('lastCapture');
          if (!lastCapture) {
            sendResponse({ success: false });
            break;
          }

          const preset = TRANSCRIPT_PRIORITY_PRESETS[request.transcriptPriority];
          const beforeSec = request.beforeSec ?? preset?.beforeSec ?? lastCapture.beforeSec ?? TRANSCRIPT_DEFAULT_BEFORE_SEC;
          const afterSec = request.afterSec ?? preset?.afterSec ?? lastCapture.afterSec ?? TRANSCRIPT_DEFAULT_AFTER_SEC;
          const transcriptPreferFull = request.transcriptPreferFull ?? preset?.preferFull ?? lastCapture.transcriptPreferFull ?? false;
          const transcriptMode = request.transcriptMode ?? lastCapture.transcriptMode ?? 'local';

          const tab = await findYouTubeVideoTab(lastCapture.videoId);
          const lines = lastCapture.videoId
            ? await getCachedOrFetchTranscript(lastCapture.videoId, tab?.id || null, lastCapture.transcriptLang || 'fr')
            : null;

          let transcriptText = lastCapture.transcriptText || '';
          let transcriptIsFull = lastCapture.transcriptIsFull ?? false;
          let transcriptSegmentCount = lastCapture.transcriptSegmentCount ?? 0;

          if (lines?.length) {
            const result = buildTranscriptForPrompt(
              lines,
              lastCapture.currentTime ?? 0,
              beforeSec,
              afterSec,
              { preferFull: transcriptPreferFull }
            );
            transcriptText = getTranscriptWindow(lines, lastCapture.currentTime ?? 0, beforeSec, afterSec)
              || result.text;
            transcriptIsFull = result.isFull;
            transcriptSegmentCount = result.segmentCount;
          }

          const updated = {
            ...lastCapture,
            beforeSec,
            afterSec,
            transcriptPriority: request.transcriptPriority || lastCapture.transcriptPriority || 'standard',
            transcriptPreferFull,
            transcriptMode,
            transcriptText,
            transcriptIsFull,
            transcriptSegmentCount
          };
          await chrome.storage.local.set({ lastCapture: updated });

          sendResponse({
            success: true,
            capture: updated,
            charCount: transcriptText.length,
            estimatedTokens: estimateTranscriptTokens(transcriptText.length)
          });
          break;
        }

        case 'refreshTranscript': {
          const { lastCapture } = await chrome.storage.local.get('lastCapture');
          if (!lastCapture) {
            sendResponse({ success: false, hasTranscript: false, error: 'Aucune capture en cours.' });
            break;
          }

          const tab = await findYouTubeVideoTab(lastCapture.videoId);
          const tabVideoId = tab?.url ? getVideoIdFromUrl(tab.url) : null;
          if (tabVideoId && lastCapture.videoId && tabVideoId !== lastCapture.videoId) {
            sendResponse({
              success: false,
              hasTranscript: false,
              error: 'La vidéo YouTube active ne correspond pas à la capture. Recapturez la frame.'
            });
            break;
          }

          if (lastCapture.videoId) {
            await chrome.storage.local.remove(getTranscriptCacheKey(lastCapture.videoId));
          }

          const beforeSec = lastCapture.beforeSec ?? TRANSCRIPT_DEFAULT_BEFORE_SEC;
          const afterSec = lastCapture.afterSec ?? TRANSCRIPT_DEFAULT_AFTER_SEC;
          const transcriptResult = await resolveTranscriptForCapture(
            tab?.id || null,
            lastCapture.videoId,
            lastCapture.currentTime,
            beforeSec,
            afterSec,
            lastCapture.transcriptLang || 'fr',
            {
              forceRefresh: true,
              preferFull: lastCapture.transcriptPreferFull === true
            }
          );

          const transcriptText = transcriptResult.previewText || transcriptResult.text || '';
          const updated = {
            ...lastCapture,
            transcriptText,
            transcriptIsFull: transcriptResult.isFull,
            transcriptSegmentCount: transcriptResult.segmentCount
          };
          await chrome.storage.local.set({ lastCapture: updated });

          sendResponse({
            success: true,
            hasTranscript: !!transcriptText.trim(),
            transcriptText,
            trackCount: transcriptResult.segmentCount || 0,
            transcriptIsFull: transcriptResult.isFull
          });
          break;
        }

        case 'openAnnotationOnTab': {
          const tab = await findYouTubeVideoTab();
          if (!tab?.id) {
            sendResponse({
              success: false,
              error: 'Ouvrez une vidéo YouTube dans un onglet, puis réessayez.'
            });
            break;
          }

          const scriptFiles = [
            'lib/utils.js',
            'content/capture.js',
            'content/overlay.js',
            'content/annotation-editor.js',
            'content/annotation-panel.js',
            'content/content.js'
          ];

          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: scriptFiles
            });
          } catch {
            /* scripts may already be present */
          }

          try {
            await chrome.tabs.sendMessage(tab.id, { action: 'openAnnotation' });
            sendResponse({ success: true, tabId: tab.id });
          } catch {
            sendResponse({
              success: false,
              error: 'Scripts non chargés. Appuyez sur F5 sur la page YouTube, puis réessayez.'
            });
          }
          break;
        }

        default:
          sendResponse({ error: `Action inconnue: ${request.action}` });
      }
    } catch (err) {
      console.error('[YTAITutor] Service Worker Error:', err);
      sendResponse({ error: err.message });
    }
  })();

  return true;
});
