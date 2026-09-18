/**
 * @file Popup UI logic for independent notebooks, chat, settings.
 */

(function () {
  'use strict';

  let currentCapture = null;
  let isLoading = false;
  let activeNotebookId = null;
  let skipImageModelCheck = false;
  let userDefaultPreferences = {
    defaultFrameMode: 't0-only',
    defaultTranscriptContext: 'standard'
  };

  /**
   * In-memory chat log — mirrors what is shown in #chat-messages.
   * Each entry: { role: 'user'|'assistant'|'image', text: string, imageDataUrl?: string, label?: string }
   * 'image' entries are display-only reference photos, never sent to the AI model.
   */
  let chatLog = [];

  const KOFI_URL = 'https://ko-fi.com/samya818';

  /**
   * Image file from user's PC attached to be sent to the AI model with the next question.
   * Format: { dataUrl: string, name: string } | null
   */
  let attachedLlmImage = null;

  /** @type {Record<string, { beforeSec: number, afterSec: number, preferFull: boolean }>} */
  const TRANSCRIPT_PRIORITY_PRESETS = {
    economical: { beforeSec: 30, afterSec: 15, preferFull: false },
    standard: { beforeSec: 60, afterSec: 30, preferFull: false },
    complete: { beforeSec: 120, afterSec: 60, preferFull: true },
    global: { beforeSec: 60, afterSec: 30, preferFull: true },
    'global-local': { beforeSec: 60, afterSec: 30, preferFull: true }
  };

  /** Fallback model lists — used when no API key is stored or the live fetch fails. */
  const FALLBACK_MODELS = {
    gemini: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'],
    openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
    anthropic: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'],
    mistral: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest']
  };

  // Backward-compat alias (some code still references PROVIDER_MODELS)
  const PROVIDER_MODELS = FALLBACK_MODELS;

  /** Cache live model lists for 1 hour to avoid redundant API calls. */
  const MODEL_CACHE_TTL_MS = 60 * 60 * 1000;

  /**
   * Returns the live model list for a provider, fetched from the provider's API.
   * Results are cached in chrome.storage.local for MODEL_CACHE_TTL_MS.
   * Falls back to FALLBACK_MODELS on any error or when no key is available.
   * @param {string} provider
   * @param {string|null} apiKey
   * @returns {Promise<string[]>}
   */
  async function fetchModelsForProvider(provider, apiKey) {
    if (!apiKey) {
      return FALLBACK_MODELS[provider] || FALLBACK_MODELS.gemini;
    }

    // Return cached list if still fresh
    const cacheKey = `modelCache_${provider}`;
    try {
      const cached = await chrome.storage.local.get(cacheKey);
      const entry = cached[cacheKey];
      if (entry && (Date.now() - entry.ts) < MODEL_CACHE_TTL_MS && entry.models?.length) {
        return entry.models;
      }
    } catch (_) { /* ignore */ }

    let models = null;
    try {
      if (provider === 'gemini') {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
        );
        if (res.ok) {
          const data = await res.json();
          models = (data.models || [])
            .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
            .map((m) => m.name.replace('models/', ''))
            .filter(Boolean)
            .sort();
        }
      } else if (provider === 'openai') {
        const res = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` }
        });
        if (res.ok) {
          const data = await res.json();
          models = (data.data || [])
            .map((m) => m.id)
            .filter((id) => /^gpt-/.test(id))
            .sort()
            .reverse();
        }
      } else if (provider === 'mistral') {
        const res = await fetch('https://api.mistral.ai/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` }
        });
        if (res.ok) {
          const data = await res.json();
          models = (data.data || []).map((m) => m.id).sort().reverse();
        }
      }
      // Anthropic has no public list endpoint — always use fallback
    } catch (err) {
      console.warn(`[YTAITutor] Could not fetch models for ${provider}:`, err.message);
    }

    if (models && models.length) {
      try {
        await chrome.storage.local.set({ [cacheKey]: { models, ts: Date.now() } });
      } catch (_) { /* ignore */ }
      return models;
    }

    return FALLBACK_MODELS[provider] || FALLBACK_MODELS.gemini;
  }

  function isImageRequest(text) {
    if (!text) {
      return false;
    }
    const normalized = text.toLowerCase();
    const explicitImageWords = ['schéma', 'diagramme', 'figure', 'graphe', 'tableau'];
    const generationVerbs = ['crée', 'créer', 'génère', 'générer', 'dessine', 'dessiner', 'montre', 'construis', 'produis', 'fais', 'affiche', 'réalise', 'trace', 'représente'];
    const imageNouns = ['image', 'photo', 'illustration', 'dessin'];

    if (explicitImageWords.some((keyword) => normalized.includes(keyword))) {
      return true;
    }

    const hasImageNoun = imageNouns.some((keyword) => normalized.includes(keyword));
    const hasGenerationVerb = generationVerbs.some((keyword) => normalized.includes(keyword));

    return hasImageNoun && hasGenerationVerb;
  }

  function renderModelOptions(provider, selectedModel, modelList) {
    const modelSelect = document.getElementById('model-select');
    modelSelect.innerHTML = '';

    // Normalize: strip the "models/" prefix that the Gemini API returns
    const normalize = (m) => (m ? m.replace(/^models\//, '') : m);
    const normalizedSelected = normalize(selectedModel);

    let models = (modelList || FALLBACK_MODELS[provider] || FALLBACK_MODELS.gemini)
      .map(normalize)
      .filter(Boolean);

    // If the saved model is not in the list (e.g. custom/new model), add it at the top
    if (normalizedSelected && !models.includes(normalizedSelected)) {
      models = [normalizedSelected, ...models];
    }

    models.forEach((model) => {
      const option = document.createElement('option');
      option.value = model;
      option.textContent = model;
      if (model === normalizedSelected) {
        option.selected = true;
      }
      modelSelect.appendChild(option);
    });

    // Force-set the value in case no option was matched (fallback-safe)
    if (normalizedSelected) {
      modelSelect.value = normalizedSelected;
    }
  }


  function updateModelIndicator(provider, model, overrideNote = '') {
    const indicator = document.getElementById('model-indicator');
    if (!indicator) {
      return;
    }
    const providerLabel = provider === 'gemini' ? 'Gemini' : provider.charAt(0).toUpperCase() + provider.slice(1);
    indicator.textContent = `Modèle utilisé : ${providerLabel} · ${model}${overrideNote ? ` (${overrideNote})` : ''}`;
  }

  function renderSavedKeysList(apiKeys = {}, activeProvider = 'gemini') {
    const container = document.getElementById('saved-keys-list');
    container.innerHTML = '';

    Object.entries(apiKeys).forEach(([provider, entry]) => {
      const item = document.createElement('div');
      item.className = `saved-key-item${provider === activeProvider ? ' active' : ''}`;

      const label = document.createElement('span');
      label.textContent = `${provider} • ${entry.model || ''}`;

      const status = document.createElement('span');
      status.className = 'saved-key-status';
      status.textContent = entry.key ? (provider === activeProvider ? 'Actif' : 'Enregistré') : 'Non configuré';

      item.appendChild(label);
      item.appendChild(status);
      container.appendChild(item);
    });
  }

  function getTranscriptContextSettings() {
    const defaultPriority = userDefaultPreferences?.defaultTranscriptContext || 'standard';
    const preset = TRANSCRIPT_PRIORITY_PRESETS[defaultPriority] || TRANSCRIPT_PRIORITY_PRESETS.standard;
    const priority = currentCapture?.transcriptPriority || defaultPriority;
    const presetValues = TRANSCRIPT_PRIORITY_PRESETS[priority] || preset;
    const defaultMode = priority === 'global' ? 'global' : priority === 'global-local' ? 'global-local' : 'local';

    return {
      beforeSec: currentCapture?.beforeSec ?? presetValues.beforeSec,
      afterSec: currentCapture?.afterSec ?? presetValues.afterSec,
      preferFull: currentCapture?.transcriptPreferFull ?? presetValues.preferFull,
      priority,
      transcriptMode: currentCapture?.transcriptMode || defaultMode
    };
  }

  document.addEventListener('DOMContentLoaded', async () => {
    // 1. Attach tabs and all user event listeners IMMEDIATELY so the UI is never frozen
    setupTabs();
    setupEventListeners();
    setupCaptureStorageListener();

    // 2. Load async states concurrently and safely (never block each other or the UI)
    try {
      await Promise.allSettled([
        loadCapture().catch((err) => console.warn('[YTAITutor] loadCapture failed:', err)),
        loadSettings().catch((err) => console.warn('[YTAITutor] loadSettings failed:', err)),
        loadNotebooks().catch((err) => console.warn('[YTAITutor] loadNotebooks failed:', err)),
        loadChatSession().catch((err) => console.warn('[YTAITutor] loadChatSession failed:', err))
      ]);

      // Local-only usage counters (no network tracking)
      await bumpUsageOpenAndRender();

      // Check if new user needs the interactive onboarding guide
      checkAutoStartGuide();
    } catch (err) {
      console.error('[YTAITutor Popup] Init error:', err);
    }
  });

  async function bumpUsageOpenAndRender() {
    try {
      await sendMessage({ action: 'bumpUsageOpens' });
      const usage = await sendMessage({ action: 'getUsageStats' });
      if (!usage) return;

      const installsEl = document.getElementById('usage-installs');
      const opensEl = document.getElementById('usage-opens');
      if (installsEl) installsEl.textContent = usage.installs ?? 0;
      if (opensEl) opensEl.textContent = usage.opens ?? 0;
    } catch {
      // never break the UI
    }
  }

  function setupCaptureStorageListener() {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.lastCapture?.newValue) {
        return;
      }
      sendMessage({ action: 'getCapture' })
        .then((capture) => updateCapturePreview(capture))
        .catch(() => {});
    });
  }

  function setupTabs() {
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
        document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(`${tab.dataset.panel}-panel`).classList.add('active');

        if (tab.dataset.panel === 'notebooks') {
          loadNotebooks();
        } else if (tab.dataset.panel === 'active-notebook' && activeNotebookId) {
          loadActiveNotebook(activeNotebookId);
        }
      });
    });
  }

  function isYouTubeVideoUrl(url) {
    if (!url || !url.includes('youtube.com')) {
      return false;
    }
    return url.includes('/watch') || url.includes('/shorts/') || url.includes('/live/');
  }

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
      return shortsMatch ? shortsMatch[1] : null;
    } catch {
      return null;
    }
  }

  async function findYouTubeTab() {
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (isYouTubeVideoUrl(activeTab?.url)) {
      return activeTab;
    }
    const youtubeTabs = await chrome.tabs.query({
      url: ['*://www.youtube.com/*', '*://youtube.com/*']
    });
    return youtubeTabs.find((tab) => isYouTubeVideoUrl(tab.url)) || null;
  }

  async function captureViaContentScript(tabId) {
    const response = await chrome.tabs.sendMessage(tabId, { action: 'captureNow' });
    if (!response?.success || !response.capture) {
      throw new Error(response?.error || 'Impossible de capturer la frame vidéo.');
    }
    return response.capture;
  }

  async function captureFromYouTubeTab() {
    const response = await sendMessage({ action: 'captureFromActiveTab' });
    if (response?.success && response.capture) {
      return response.capture;
    }
    if (response?.error?.includes('captureFromActiveTab')) {
      const tab = await findYouTubeTab();
      if (!tab?.id) {
        throw new Error('Ouvrez une vidéo YouTube (youtube.com/watch), puis réessayez.');
      }
      return captureViaContentScript(tab.id);
    }
    throw new Error(response?.error || 'Impossible de capturer la frame vidéo.');
  }

  function updateTranscriptStatus() {}

  async function refreshTranscript() {
    const btn = document.getElementById('refresh-transcript-btn');
    try {
      btn.disabled = true;
      updateTranscriptStatus(null, true);

      if (!currentCapture?.videoId) {
        currentCapture = await captureFromYouTubeTab();
        updateCapturePreview(currentCapture);
      }

      const result = await sendMessage({ action: 'refreshTranscript' });
      if (result?.transcriptText) {
        currentCapture = {
          ...currentCapture,
          transcriptText: result.transcriptText,
          transcriptIsFull: result.transcriptIsFull,
          transcriptSegmentCount: result.trackCount
        };
      } else if (currentCapture) {
        currentCapture.transcriptText = result?.transcriptText || '';
      }
      updateTranscriptStatus(currentCapture, false);
    } catch (err) {
      updateTranscriptStatus(currentCapture, false);
      console.error('[YTAITutor Popup] refreshTranscript:', err);
    } finally {
      btn.disabled = false;
    }
  }

  async function openAnnotationPanel() {
    const btn = document.getElementById('annotate-btn');
    try {
      btn.disabled = true;
      btn.textContent = 'Opening...';

      const result = await sendMessage({ action: 'openAnnotationOnTab' });
      if (!result?.success) {
        throw new Error(result?.error || 'Unable to open the editor.');
      }
    } catch (err) {
      addMessage('assistant', err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Annotate (T-X / T0 / T+X)';
    }
  }

  function updateCapturePreview(capture) {
    const hint = document.getElementById('no-capture-hint');
    const preview = document.getElementById('capture-preview');

    if (!capture?.dataUrl) {
      hint.style.display = 'block';
      preview.style.display = 'none';
      preview.title = '';
      updateTranscriptStatus(capture, false);
      return;
    }

    currentCapture = capture;
    hint.style.display = 'none';
    preview.src = capture.dataUrl;
    preview.style.display = 'block';
    const contextFrames = capture.frames?.filter((frame) => frame.imageId)?.length || 0;
    const frameLabel = capture.frames?.length
      ? capture.frames.map((frame) => frame.label).join(' / ')
      : null;
    preview.title = capture.annotated
      ? `Capture annotée (${capture.selectedFrame || 'T0'}) — ${frameLabel || `${Math.max(1, contextFrames)} image(s)`} envoyées à l'IA`
      : 'Capture simple — utilisez Annoter ou ? pour ajouter des marques visuelles';
    updateTranscriptStatus(capture, false);
    checkVideoMismatch();
  }

  async function checkVideoMismatch() {
    const btn = document.getElementById('recapture-btn');
    if (!btn) {
      return;
    }
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const tabVideoId = getVideoIdFromUrl(activeTab?.url);
      const mismatch = tabVideoId && currentCapture?.videoId && tabVideoId !== currentCapture.videoId;
      btn.style.display = mismatch ? 'inline-block' : 'none';
    } catch {
      btn.style.display = 'none';
    }
  }

  async function ensureCapture() {
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const tabVideoId = getVideoIdFromUrl(activeTab?.url);

    if (tabVideoId && currentCapture?.videoId && currentCapture.videoId !== tabVideoId) {
      const capture = await captureFromYouTubeTab();
      updateCapturePreview(capture);
      return capture;
    }

    if (currentCapture?.dataUrl && (!tabVideoId || currentCapture.videoId === tabVideoId)) {
      return currentCapture;
    }

    if (currentCapture?.annotated && currentCapture?.imageId) {
      const retry = await sendMessage({ action: 'getCapture' });
      if (retry?.dataUrl && (!tabVideoId || retry.videoId === tabVideoId)) {
        updateCapturePreview(retry);
        return retry;
      }
    }

    const capture = await captureFromYouTubeTab();
    updateCapturePreview(capture);
    return capture;
  }

  async function loadCapture() {
    try {
      let response = await sendMessage({ action: 'getCapture' });
      const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const tabVideoId = getVideoIdFromUrl(activeTab?.url);

      if (response?.annotated && response?.imageId && !response?.dataUrl) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        response = await sendMessage({ action: 'getCapture' });
      }

      if (response?.annotated && response?.dataUrl) {
        updateCapturePreview(response);
        if (!response.transcriptText?.trim()) {
          refreshTranscript().catch(() => {});
        }
        return;
      }

      if (isYouTubeVideoUrl(activeTab?.url) && (!response?.dataUrl || (tabVideoId && response.videoId !== tabVideoId))) {
        try {
          const fresh = await captureFromYouTubeTab();
          updateCapturePreview(fresh);
          return;
        } catch (err) {
          console.warn('[YTAITutor Popup] Auto-capture:', err.message);
        }
      }

      updateCapturePreview(response);
      if (response?.dataUrl && !response?.transcriptText?.trim()) {
        refreshTranscript().catch(() => {});
      }
    } catch (err) {
      console.error('Erreur chargement capture:', err);
    }
  }

  async function loadSettings() {
    try {
      const [apiKeysResponse, settings] = await Promise.all([
        sendMessage({ action: 'getApiKeys' }),
        sendMessage({ action: 'getSettings' })
      ]);

      const provider = settings?.provider || apiKeysResponse?.activeProvider || 'gemini';
      const storedKey = apiKeysResponse?.apiKeys?.[provider]?.key;
      const model = settings?.model || apiKeysResponse?.apiKeys?.[provider]?.model || FALLBACK_MODELS[provider]?.[0] || FALLBACK_MODELS.gemini[0];

      document.getElementById('provider-selector').value = provider;
      document.getElementById('current-provider-label').textContent = provider;

      // Render with fallback immediately, then refresh with live list
      renderModelOptions(provider, model);
      updateModelIndicator(provider, model);
      renderSavedKeysList(apiKeysResponse?.apiKeys || {}, apiKeysResponse?.activeProvider || provider);

      const input = document.getElementById('api-key-input');
      if (storedKey) {
        input.value = '••••••••••••••••';
        input.dataset.stored = 'true';
      } else {
        input.value = '';
        input.dataset.stored = 'false';
      }

      // Async: fetch live model list and refresh the dropdown WITHOUT overwriting the user's current selection
      fetchModelsForProvider(provider, storedKey).then((liveModels) => {
        // Read the CURRENT selection (user may have changed it while the fetch was in flight)
        const currentSelection = document.getElementById('model-select').value || model;
        renderModelOptions(provider, currentSelection, liveModels);
      });

      // Load user default preferences
      const prefs = await chrome.storage.local.get('defaultPreferences');
      if (prefs?.defaultPreferences) {
        userDefaultPreferences = { ...userDefaultPreferences, ...prefs.defaultPreferences };
      }
      const frameModeSelect = document.getElementById('default-frame-mode-select');
      if (frameModeSelect) {
        frameModeSelect.value = userDefaultPreferences.defaultFrameMode || 't0-only';
      }
      const contextSelect = document.getElementById('default-transcript-context-select');
      if (contextSelect) {
        contextSelect.value = userDefaultPreferences.defaultTranscriptContext || 'standard';
      }
    } catch (err) {
      console.error('Erreur chargement settings:', err);
    }
  }

  // ── Interactive User Onboarding Guide (Spotlight & Try-It-Now) ──────────────

  let currentGuideStep = 0;
  let activeStepCleanup = null;

  const GUIDE_STEPS = [
    {
      panel: 'settings',
      targetSelector: '#api-key-input',
      icon: '🔑',
      title: 'Step 1: Enter Your Gemini API Key',
      desc: 'To enable AI tutoring and video analysis, enter your Google Gemini API key here.',
      actionPrompt: 'Try clicking this input field! If you do not have a key yet, click the link below to get one in 10 seconds:',
      box: '<a href="https://aistudio.google.com/app/apikey" target="_blank" class="guide-external-link">🔗 Click here to get a free Google AI Studio key</a>',
      tip: 'Gemini keys are completely free, generous, and stored only in your local browser.',
      autoAdvanceOn: 'focus',
      padding: 5
    },
    {
      panel: 'settings',
      targetSelector: '#save-key-btn',
      icon: '💾',
      title: 'Step 2: Save Your API Key',
      desc: 'After typing or pasting your key, click this button to validate and securely save it.',
      actionPrompt: 'Try clicking "Save Key" when your key is ready!',
      tip: 'Once saved, you never need to enter it again. Your key stays saved across sessions.',
      autoAdvanceOn: 'click',
      padding: 5
    },
    {
      panel: 'chat',
      targetSelector: '#recapture-btn',
      icon: '📸',
      title: 'Step 3: Capture Video Frame',
      desc: 'When watching a YouTube video, this button captures the exact video frame at the current timestamp along with the spoken transcript context.',
      actionPrompt: 'Try clicking "↻ Recapture" to snapshot the current video tab!',
      tip: 'The extension also captures automatically whenever you open it on a YouTube video page.',
      autoAdvanceOn: 'click',
      padding: 5
    },
    {
      panel: 'chat',
      targetSelector: '#annotate-btn',
      icon: '✏️',
      title: 'Step 4: Draw & Annotate the Frame',
      desc: 'Click Draw / Annotate to open the built-in canvas. Circle math formulas, highlight text, or draw arrows right on the frame.',
      actionPrompt: 'Try clicking "Draw / Annotate" to see the visual markup tools!',
      tip: 'Visual annotations help the AI tutor instantly pinpoint what you are referring to.',
      autoAdvanceOn: 'click',
      padding: 5
    },
    {
      panel: 'chat',
      targetSelector: '#attach-llm-image-btn',
      icon: '📎',
      title: 'Step 5: Attach PC Photos & Ask the AI',
      desc: 'Have a photo of your textbook, homework problem, or notes? Click this small 📎 paperclip button to attach it to your question.',
      actionPrompt: 'Try clicking the 📎 paperclip button to attach a photo from your PC!',
      tip: 'Type your question in the input bar and press Enter. The AI analyzes both the video frame and your attached photo!',
      autoAdvanceOn: 'click',
      padding: 6
    },
    {
      panel: 'chat',
      targetSelector: '.chat-action-bar',
      icon: '📌',
      title: 'Step 6: Revision Memos (0 Tokens)',
      desc: 'Understand the difference: 📎 paperclip sends images to the AI (uses tokens). But these 4 buttons save visual notes directly into the chat for your revision (costs 0 tokens) and export to PDF!',
      actionPrompt: 'Try clicking "📌 Épingler capture" or "🖼 Photo mémo" to insert a visual note!',
      tip: 'Use Revision Memos to build illustrated summary sheets for later review and export.',
      autoAdvanceOn: 'click',
      padding: 6
    },
    {
      panel: 'notebooks',
      targetSelector: '#create-notebook-btn',
      icon: '📓',
      title: 'Step 7: Notebooks & Resume Past Chats',
      desc: 'Organize notes by subject or course. Inside any saved notebook entry, click "💬 Continuer" to instantly restore that past discussion and keep learning!',
      actionPrompt: 'Try clicking "+ New Notebook" to create your first notebook!',
      tip: 'You are all set! You can replay this interactive guide anytime from the Settings tab.',
      autoAdvanceOn: 'click',
      padding: 6
    }
  ];

  function positionGuideForStep(index) {
    const step = GUIDE_STEPS[index];
    if (!step) return;

    const ring = document.getElementById('guide-highlight-ring');
    const tooltip = document.getElementById('guide-tooltip');
    const backdrop = document.getElementById('guide-backdrop');
    if (!ring || !tooltip || !backdrop) return;

    const targetEl = step.targetSelector ? document.querySelector(step.targetSelector) : null;
    if (targetEl) {
      targetEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

      setTimeout(() => {
        const rect = targetEl.getBoundingClientRect();
        const pad = step.padding ?? 6;

        ring.style.top = Math.max(0, rect.top - pad) + 'px';
        ring.style.left = Math.max(0, rect.left - pad) + 'px';
        ring.style.width = (rect.width + pad * 2) + 'px';
        ring.style.height = (rect.height + pad * 2) + 'px';
        ring.classList.remove('hidden');

        // Smart tooltip positioning
        const spaceBelow = window.innerHeight - (rect.bottom + pad);
        const spaceAbove = rect.top - pad;

        if (spaceBelow >= 200 || spaceBelow >= spaceAbove) {
          tooltip.style.top = Math.min(window.innerHeight - 240, rect.bottom + pad + 10) + 'px';
          tooltip.style.bottom = 'auto';
          tooltip.classList.add('arrow-top');
          tooltip.classList.remove('arrow-bottom');
        } else {
          tooltip.style.bottom = (window.innerHeight - rect.top + pad + 10) + 'px';
          tooltip.style.top = 'auto';
          tooltip.classList.add('arrow-bottom');
          tooltip.classList.remove('arrow-top');
        }
      }, 60);
    } else {
      ring.classList.add('hidden');
      tooltip.style.top = '60px';
      tooltip.style.bottom = 'auto';
      tooltip.classList.remove('arrow-top', 'arrow-bottom');
    }

    backdrop.classList.remove('hidden');
    tooltip.classList.remove('hidden');
  }

  function showGuideStep(index) {
    if (index < 0 || index >= GUIDE_STEPS.length) return;
    currentGuideStep = index;
    const step = GUIDE_STEPS[index];

    // Clean up previous interactive listener
    if (activeStepCleanup) {
      activeStepCleanup();
      activeStepCleanup = null;
    }

    // Switch to the relevant tab so the target element is mounted & visible
    if (step.panel) {
      const tabBtn = document.querySelector(`.tab[data-panel="${step.panel}"]`);
      if (tabBtn && !tabBtn.classList.contains('active')) {
        tabBtn.click();
      }
    }

    // Update step tag
    const indicator = document.getElementById('guide-step-indicator');
    if (indicator) {
      indicator.textContent = `Step ${index + 1} of ${GUIDE_STEPS.length}`;
    }

    // Render body content
    const body = document.getElementById('guide-body');
    if (body) {
      body.innerHTML = `
        <div class="guide-title-row">
          <span class="guide-icon">${step.icon}</span>
          <span class="guide-title">${step.title}</span>
        </div>
        <div class="guide-desc">${step.desc}</div>
        ${step.actionPrompt ? `
          <div class="guide-action-prompt">
            <span class="guide-prompt-arrow">👉</span>
            <div>${step.actionPrompt}</div>
          </div>` : ''}
        ${step.box ? `<div class="guide-box">${step.box}</div>` : ''}
        ${step.tip ? `<div class="guide-highlight-tip"><span>💡</span><div>${step.tip}</div></div>` : ''}
      `;
    }

    // Render pagination dots
    renderGuideDots(index);

    // Update navigation buttons
    const prevBtn = document.getElementById('guide-prev-btn');
    const nextBtn = document.getElementById('guide-next-btn');
    if (prevBtn) {
      prevBtn.style.visibility = index === 0 ? 'hidden' : 'visible';
    }
    if (nextBtn) {
      nextBtn.textContent = index === GUIDE_STEPS.length - 1 ? 'Got it! 🎉' : 'Next →';
    }

    // Position spotlight ring and tooltip card
    positionGuideForStep(index);

    // Auto-advance listener when the user tries clicking or focusing the highlighted element
    if (step.targetSelector && step.autoAdvanceOn) {
      const targetEl = document.querySelector(step.targetSelector);
      if (targetEl) {
        const handler = () => {
          if (currentGuideStep === index && currentGuideStep < GUIDE_STEPS.length - 1) {
            showToast('✓ Great job! Moving to next step...');
            setTimeout(() => {
              showGuideStep(index + 1);
            }, 600);
          }
        };
        targetEl.addEventListener(step.autoAdvanceOn, handler, { once: true });
        activeStepCleanup = () => targetEl.removeEventListener(step.autoAdvanceOn, handler);
      }
    }
  }

  function renderGuideDots(currentIndex) {
    const container = document.getElementById('guide-dots');
    if (!container) return;
    container.innerHTML = '';
    GUIDE_STEPS.forEach((_, idx) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = `guide-dot${idx === currentIndex ? ' active' : ''}`;
      dot.title = `Step ${idx + 1}: ${GUIDE_STEPS[idx].title}`;
      dot.addEventListener('click', () => showGuideStep(idx));
      container.appendChild(dot);
    });
  }

  function closeGuide(markAsSeen = true) {
    if (activeStepCleanup) {
      activeStepCleanup();
      activeStepCleanup = null;
    }
    document.getElementById('guide-backdrop')?.classList.add('hidden');
    document.getElementById('guide-highlight-ring')?.classList.add('hidden');
    document.getElementById('guide-tooltip')?.classList.add('hidden');

    if (markAsSeen) {
      chrome.storage.local.set({ hasSeenOnboardingGuide: true });
    }
  }

  async function checkAutoStartGuide() {
    try {
      const res = await chrome.storage.local.get('hasSeenOnboardingGuide');
      if (!res?.hasSeenOnboardingGuide) {
        setTimeout(() => {
          showGuideStep(0);
        }, 500);
      }
    } catch (err) {
      console.warn('[YTAITutor] Guide check error:', err);
    }
  }

  function setupEventListeners() {
    document.getElementById('default-frame-mode-select')?.addEventListener('change', async (e) => {
      userDefaultPreferences.defaultFrameMode = e.target.value;
      await chrome.storage.local.set({ defaultPreferences: userDefaultPreferences });
    });

    document.getElementById('default-transcript-context-select')?.addEventListener('change', async (e) => {
      userDefaultPreferences.defaultTranscriptContext = e.target.value;
      await chrome.storage.local.set({ defaultPreferences: userDefaultPreferences });
    });

    document.getElementById('send-btn').addEventListener('click', sendQuestion);
    document.getElementById('question-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        sendQuestion();
      }
    });

    // Attach a photo from user's PC to be analyzed by the AI model
    const llmFileInput = document.getElementById('llm-image-file-input');
    document.getElementById('attach-llm-image-btn')?.addEventListener('click', () => {
      llmFileInput?.click();
    });

    llmFileInput?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        showToast('Veuillez sélectionner un fichier image valide.');
        return;
      }
      const reader = new FileReader();
      reader.onload = (loadEvt) => {
        setAttachedLlmImage(loadEvt.target.result, file.name);
        showToast('Photo jointe pour l’IA ! Elle sera analysée avec votre question.');
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    });

    document.getElementById('remove-llm-image-btn')?.addEventListener('click', () => {
      clearAttachedLlmImage();
      showToast('Photo détachée (non transmise au modèle).');
    });

    document.getElementById('save-key-btn').addEventListener('click', saveApiKey);
    document.getElementById('provider-selector').addEventListener('change', async (e) => {
      const provider = e.target.value;
      document.getElementById('current-provider-label').textContent = provider;

      // Show a provisional fallback immediately while we load saved state
      const fallbackModel = FALLBACK_MODELS[provider]?.[0];
      renderModelOptions(provider, fallbackModel);
      updateModelIndicator(provider, fallbackModel);

      try {
        const apiKeysResponse = await sendMessage({ action: 'getApiKeys' });
        const storedKey = apiKeysResponse?.apiKeys?.[provider]?.key;

        // Use the previously saved model for this provider, fall back to default
        const savedModel = apiKeysResponse?.apiKeys?.[provider]?.model || fallbackModel;

        renderSavedKeysList(apiKeysResponse?.apiKeys || {}, apiKeysResponse?.activeProvider || provider);
        const input = document.getElementById('api-key-input');
        input.value = storedKey ? '••••••••••••••••' : '';
        input.dataset.stored = storedKey ? 'true' : 'false';

        // Save provider switch with its own saved model (not the previous provider's selection)
        await sendMessage({ action: 'saveSettings', provider, model: savedModel });

        // Render fallback list with saved model pre-selected, then refresh with live data
        renderModelOptions(provider, savedModel);
        updateModelIndicator(provider, savedModel);

        const liveModels = await fetchModelsForProvider(provider, storedKey);
        // Re-read in case user changed selection during the fetch
        const currentSel = document.getElementById('model-select').value || savedModel;
        renderModelOptions(provider, currentSel, liveModels);
        updateModelIndicator(provider, document.getElementById('model-select').value || currentSel);

        const refreshedKeys = await sendMessage({ action: 'getApiKeys' });
        renderSavedKeysList(refreshedKeys?.apiKeys || {}, provider);
      } catch (err) {
        console.error('Erreur changement provider:', err);
      }
    });


    document.getElementById('model-select').addEventListener('change', async (e) => {
      try {
        const provider = document.getElementById('provider-selector').value;
        const selectedModel = e.target.value;
        updateModelIndicator(provider, selectedModel);
        await sendMessage({
          action: 'saveSettings',
          model: selectedModel,
          provider
        });
        // Sync saved-keys list so the model label stays up to date
        const apiKeysResponse = await sendMessage({ action: 'getApiKeys' });
        renderSavedKeysList(apiKeysResponse?.apiKeys || {}, provider);
      } catch (err) {
        console.error('Erreur sauvegarde modèle:', err);
      }
    });

    document.getElementById('refresh-models-btn').addEventListener('click', async () => {
      const btn = document.getElementById('refresh-models-btn');
      const provider = document.getElementById('provider-selector').value;
      btn.disabled = true;
      btn.textContent = '…';
      try {
        // Bust the cache for this provider
        await chrome.storage.local.remove(`modelCache_${provider}`);
        const apiKeysResponse = await sendMessage({ action: 'getApiKeys' });
        const storedKey = apiKeysResponse?.apiKeys?.[provider]?.key;
        const currentModel = document.getElementById('model-select').value;
        const liveModels = await fetchModelsForProvider(provider, storedKey);
        renderModelOptions(provider, currentModel, liveModels);
        btn.textContent = '✓';
        setTimeout(() => { btn.textContent = '↻ Refresh'; }, 1500);
      } catch (err) {
        console.error('Erreur refresh models:', err);
        btn.textContent = '↻ Refresh';
      } finally {
        btn.disabled = false;
      }
    });


    document.getElementById('annotate-btn').addEventListener('click', openAnnotationPanel);
    document.getElementById('refresh-transcript-btn').addEventListener('click', refreshTranscript);

    document.getElementById('recapture-btn').addEventListener('click', async () => {
      const btn = document.getElementById('recapture-btn');
      try {
        btn.disabled = true;
        btn.textContent = 'Recapturing...';
        const capture = await captureFromYouTubeTab();
        updateCapturePreview(capture);
      } catch (err) {
        addMessage('assistant', err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = '↻ Recapture';
      }
    });

    // ── Chat export & revision image helpers ────────────────────────────────

    /** Read all visible chat messages from memory (or DOM fallback). */
    function collectChatMessages() {
      if (chatLog && chatLog.length > 0) {
        return chatLog.map((item) => ({
          role: item.role,
          text: item.text || '',
          imageDataUrl: item.imageDataUrl || null
        }));
      }

      const msgs = [];
      document.querySelectorAll('#chat-messages .message').forEach((el) => {
        if (el.classList.contains('reference-image')) {
          const cap = el.querySelector('.reference-image-caption')?.innerText.trim() || 'Visual Reference';
          const img = el.querySelector('.reference-image-img');
          msgs.push({ role: 'image', text: cap, imageDataUrl: img?.src || null });
        } else {
          const role = el.classList.contains('user') ? 'user' : 'assistant';
          const bodyEl = el.querySelector('.message-body');
          const text = bodyEl ? bodyEl.innerText.trim() : el.innerText.trim();
          const img = el.querySelector('.message-attached-img');
          if (text || img?.src) {
            msgs.push({ role, text, imageDataUrl: img?.src || null });
          }
        }
      });
      return msgs;
    }

    function openExternalUrl(url) {
      if (!url) return;
      chrome.tabs.create({ url });
    }

    function showExportSupportBanner() {
      const banner = document.getElementById('export-support-banner');
      if (!banner) return;
      banner.classList.remove('hidden');
      banner.removeAttribute('hidden');
    }

    function hideExportSupportBanner() {
      const banner = document.getElementById('export-support-banner');
      if (!banner) return;
      banner.classList.add('hidden');
      banner.setAttribute('hidden', '');
    }

    function setupSupportLinks() {
      hideExportSupportBanner();

      document.getElementById('export-support-dismiss')?.addEventListener('click', () => {
        hideExportSupportBanner();
      });

      document.getElementById('export-support-kofi-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        openExternalUrl(KOFI_URL);
      });

      document.getElementById('settings-kofi-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        openExternalUrl(KOFI_URL);
      });

      document.getElementById('settings-panel')?.addEventListener('click', (e) => {
        const link = e.target.closest('a.settings-external-link, a[href^="mailto:"]');
        if (!link?.href) return;
        if (link.href.startsWith('mailto:')) return;
        e.preventDefault();
        openExternalUrl(link.href);
      });
    }

    setupSupportLinks();

    /** Download current chat as a .md file. */
    function exportChatAsMarkdown() {
      const msgs = collectChatMessages();
      if (!msgs.length) { return; }

      const lines = [];
      const now = new Date().toLocaleString();
      lines.push(`# ClarifyTube - Study Notes`);
      lines.push(`_Exported on ${now}_`);
      lines.push('');

      msgs.forEach((msg) => {
        if (msg.role === 'image') {
          lines.push(`### 📷 Visual Reference (Revision)`);
          if (msg.text) lines.push(`_${msg.text}_`);
          if (msg.imageDataUrl) {
            lines.push('');
            lines.push(`![Reference Image](${msg.imageDataUrl})`);
          }
          lines.push('');
          lines.push('---');
          lines.push('');
        } else {
          if (msg.role === 'user') {
            lines.push(`## 🧑 You`);
          } else {
            lines.push(`## 🤖 ClarifyTube`);
          }
          lines.push('');
          if (msg.text) lines.push(msg.text);
          if (msg.imageDataUrl) {
            lines.push('');
            lines.push(`![Attached Frame](${msg.imageDataUrl})`);
          }
          lines.push('');
          lines.push('---');
          lines.push('');
        }
      });

      const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chat-export-${Date.now()}.md`;
      a.click();
      URL.revokeObjectURL(url);
      showExportSupportBanner();
      showToast('Chat exported!');
    }

    /** Open a print-friendly page with the current chat (→ Save as PDF). */
    async function exportChatAsPrint() {
      const msgs = collectChatMessages();
      if (!msgs.length) { return; }

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => [null]);
      const videoTitle = tab?.title?.replace(' - YouTube', '').trim() || currentCapture?.videoTitle || '';

      await chrome.storage.local.set({
        temp_print_chat: {
          messages: msgs,
          videoTitle,
          exportedAt: Date.now()
        }
      });

      chrome.tabs.create({ url: chrome.runtime.getURL('popup/pdf-print-chat.html') });
      showExportSupportBanner();
      showToast('Print view opened — save as PDF from your browser.');
    }

    document.getElementById('export-chat-md-btn')?.addEventListener('click', () => {
      exportChatAsMarkdown();
    });

    document.getElementById('export-chat-pdf-btn')?.addEventListener('click', async () => {
      try {
        await exportChatAsPrint();
      } catch (err) {
        console.error('Erreur export chat:', err);
      }
    });

    // Pin current screenshot into chat as a visual reference (not sent to AI)
    document.getElementById('pin-screenshot-btn')?.addEventListener('click', async () => {
      try {
        let capture = currentCapture;
        if (!capture?.dataUrl) {
          capture = await captureFromYouTubeTab();
          updateCapturePreview(capture);
        }
        if (!capture?.dataUrl) {
          showToast('Aucune capture vidéo disponible pour l’instant.');
          return;
        }
        const label = capture.annotated ? 'Screenshot annoté (T0)' : `Capture vidéo (T0 @ ${formatTime(capture.currentTime || 0)})`;
        addImageReferenceToChat(capture.dataUrl, label);
        showToast('Capture épinglée au chat (référence révision) !');
      } catch (err) {
        showToast('Erreur capture: ' + err.message);
      }
    });

    // Import a local image file from hard drive into chat as a visual reference (not sent to AI)
    const fileInput = document.getElementById('chat-photo-file-input');
    document.getElementById('attach-photo-btn')?.addEventListener('click', () => {
      fileInput?.click();
    });

    fileInput?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        showToast('Veuillez sélectionner un fichier image valide.');
        return;
      }
      const reader = new FileReader();
      reader.onload = (loadEvt) => {
        const dataUrl = loadEvt.target.result;
        addImageReferenceToChat(dataUrl, `Photo locale : ${file.name}`);
        showToast('Photo ajoutée au chat (référence révision) !');
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    });

    // Start a fresh chat
    document.getElementById('new-chat-btn')?.addEventListener('click', () => {
      if (chatLog.length > 0 && !confirm('Commencer un nouveau chat et effacer la session en cours ?')) {
        return;
      }
      clearChatSession();
    });

    // Resume notebook chat session
    document.getElementById('resume-notebook-chat-btn')?.addEventListener('click', () => {
      if (activeNotebookId) {
        resumeChatFromNotebook(activeNotebookId);
      }
    });



    document.getElementById('notebook-search').addEventListener('input', debounce(async (e) => {
      try {
        const query = e.target.value.trim().toLowerCase();
        const all = await sendMessage({ action: 'listNotebooks' });
        if (!query) {
          renderNotebooksList(all);
          return;
        }
        const filtered = all.filter((nb) =>
          (nb.title || '').toLowerCase().includes(query) ||
          (nb.description || '').toLowerCase().includes(query)
        );
        renderNotebooksList(filtered);
      } catch (err) {
        console.error('Erreur recherche:', err);
      }
    }, 300));

    // Floating note button
    document.getElementById('quick-note-btn').addEventListener('click', () => {
      openAddNoteModal(null, null); // Global capture note
    });

    // Create Notebook button
    document.getElementById('create-notebook-btn').addEventListener('click', () => {
      openCreateNotebookModal();
    });

    // Back to notebooks list
    document.getElementById('back-to-notebooks-btn').addEventListener('click', () => {
      document.querySelector('.tab[data-panel="notebooks"]').click();
    });

    // Export notebook
    document.getElementById('export-notebook-btn').addEventListener('click', async () => {
      if (!activeNotebookId) {
        return;
      }
      const format = document.getElementById('export-format').value;
      if (format === 'html') {
        const notebook = await sendMessage({ action: 'getNotebook', notebookId: activeNotebookId });
        const entries = await sendMessage({ action: 'getNotebookEntries', notebookId: activeNotebookId });
        const renderScriptResponse = await fetch(chrome.runtime.getURL('lib/message-render.js'));
        const renderScript = await renderScriptResponse.text();
        
        let html = `
          <html>
          <head>
            <title>${notebook.title}</title>
            <style>
              @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fira+Code:wght@400;500&display=swap');
              body {
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                color: #1e293b;
                line-height: 1.6;
                margin: 40px auto;
                padding: 0 20px;
                background-color: #f8fafc;
                max-width: 800px;
              }
              .container {
                background: #ffffff;
                border: 1px solid #e2e8f0;
                border-radius: 16px;
                padding: 40px;
                box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
              }
              .header {
                border-bottom: 2px solid #f1f5f9;
                padding-bottom: 20px;
                margin-bottom: 30px;
                display: flex;
                justify-content: space-between;
                align-items: flex-end;
              }
              .header-title-area {
                max-width: 70%;
              }
              h1 {
                font-size: 28px;
                font-weight: 700;
                color: #0f172a;
                margin: 0 0 6px 0;
                letter-spacing: -0.025em;
              }
              .desc {
                font-size: 15px;
                color: #64748b;
                margin: 0;
              }
              .meta-info {
                font-size: 13px;
                color: #94a3b8;
                text-align: right;
              }
              .entry-card {
                background: #f8fafc;
                border: 1px solid #e2e8f0;
                border-radius: 12px;
                padding: 24px;
                margin-bottom: 24px;
              }
              .entry-card-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 1px solid #e2e8f0;
                padding-bottom: 12px;
                margin-bottom: 16px;
              }
              .entry-card-title {
                font-size: 14px;
                font-weight: 600;
                color: #475569;
                max-width: 75%;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
              }
              .entry-badges {
                display: flex;
                gap: 6px;
                align-items: center;
              }
              .badge-index {
                background-color: #3b82f6;
                color: #ffffff;
                font-size: 11px;
                font-weight: 600;
                padding: 2px 8px;
                border-radius: 9999px;
              }
              .badge-time {
                background-color: #e2e8f0;
                color: #334155;
                font-size: 11px;
                font-weight: 500;
                padding: 2px 6px;
                border-radius: 4px;
              }
              .note-box {
                background-color: #fffbeb;
                border-left: 4px solid #d97706;
                padding: 14px;
                border-radius: 6px;
                color: #78350f;
                font-size: 14px;
                white-space: pre-wrap;
              }
              .chat-q {
                background-color: #eff6ff;
                border-left: 4px solid #3b82f6;
                padding: 12px;
                border-radius: 6px;
                font-weight: 600;
                color: #1e3a8a;
                font-size: 14px;
                margin-bottom: 12px;
              }
              .chat-a {
                padding: 0 10px;
                color: #334155;
                font-size: 14px;
                line-height: 1.65;
              }
              .rich-content .md-h1, .rich-content .md-h2, .rich-content .md-h3 {
                color: #0f172a;
                font-weight: 700;
                margin: 0.9em 0 0.4em 0;
              }
              .rich-content .md-h1 { font-size: 16px; }
              .rich-content .md-h2 { font-size: 15px; }
              .rich-content .md-h3 { font-size: 14px; color: #334155; }
              .rich-content .md-list { margin: 0.4em 0 0.8em 0; padding-left: 1.4em; }
              .rich-content .md-quote {
                margin: 0.65em 0;
                padding: 8px 10px;
                border-left: 3px solid #93c5fd;
                background: #eff6ff;
                border-radius: 0 8px 8px 0;
              }
              .rich-content .inline-code {
                background: #f1f5f9;
                padding: 2px 6px;
                border-radius: 4px;
                font-family: 'Fira Code', Consolas, monospace;
                border: 1px solid #e2e8f0;
              }
              .rich-content .code-block {
                background: #f8fafc;
                padding: 10px 12px;
                border-radius: 8px;
                font-family: 'Fira Code', Consolas, monospace;
                font-size: 12px;
                overflow-x: auto;
                border: 1px solid #e2e8f0;
              }
              .chat-a p {
                margin: 0 0 10px 0;
              }
              .chat-a p:last-child {
                margin-bottom: 0;
              }
              .img-container {
                margin-top: 18px;
                text-align: center;
              }
              .img-container img {
                max-width: 100%;
                max-height: 450px;
                border-radius: 8px;
                border: 1px solid #cbd5e1;
                box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <div class="header-title-area">
                  <h1>${notebook.title}</h1>
                  <div class="desc">${notebook.description || 'Personal Study Notebook'}</div>
                </div>
                <div class="meta-info">
                  Generated on ${new Date().toLocaleDateString('en-US')}<br>
                  ${entries.length} ${entries.length > 1 ? 'entries' : 'entry'}
                </div>
              </div>
              <div class="entries-list">
        `;

        entries.forEach((entry, idx) => {
          html += `<div class="entry-card">`;
          html += `
            <div class="entry-card-header">
              <div class="entry-card-title">${entry.videoTitle || 'YouTube Video'}</div>
              <div class="entry-badges">
                <span class="badge-index">#${idx + 1}</span>
                <span class="badge-time">${entry.humanTime || '0:00'}</span>
              </div>
            </div>
          `;
          
          if (entry.type === 'note') {
            html += `<div class="note-box">${entry.noteText}</div>`;
          } else {
            html += `
              <div class="chat-q">Question: ${entry.question}</div>
              <div class="chat-a" id="ans-${idx}"></div>
            `;
          }

          if (entry.imageDataUrl) {
            html += `<div class="img-container"><img src="${entry.imageDataUrl}" alt="Visual Frame" /></div>`;
          }
          
          html += `</div>`;
        });

        html += `
              </div>
            </div>
            <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
            <script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"><\/script>
            <script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"><\/script>
            <script>${renderScript.replace(/<\/script/gi, '<\\/script')}<\/script>
            <script>
              const entriesData = ${JSON.stringify(entries.map(e => e.type !== 'note' ? e.answer : ''))};
              entriesData.forEach((ans, idx) => {
                if (ans) {
                  const el = document.getElementById('ans-' + idx);
                  if (el) {
                    renderMessageContent(el, 'Answer: ' + ans);
                  }
                }
              });
            </script>
          </body>
          </html>
        `;

        const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
        const filename = `${notebook.title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.html`;
        chrome.downloads.download({
          url: dataUrl,
          filename: filename,
          saveAs: true
        });
        showToast('HTML export started!');
        return;
      }

      if (format === 'pdf') {
        // Retrieve and temporarily store data, then open pdf-print.html tab to handle high quality printing safely
        const notebook = await sendMessage({ action: 'getNotebook', notebookId: activeNotebookId });
        const entries = await sendMessage({ action: 'getNotebookEntries', notebookId: activeNotebookId });
        
        await chrome.storage.local.set({
          temp_print_notebook: { notebook, entries }
        });
        
        chrome.tabs.create({
          url: chrome.runtime.getURL('popup/pdf-print.html'),
          active: true
        });
        
        showToast('Preparing PDF...');
        return;
      }

      const res = await sendMessage({ action: 'exportNotebook', notebookId: activeNotebookId, format });
      if (res.error) {
        showToast('Export error: ' + res.error);
        return;
      }
      chrome.downloads.download({
        url: res.dataUrl,
        filename: res.filename,
        saveAs: true
      });
      showToast('Export started!');
    });

    // Inline edit active notebook title
    document.getElementById('active-notebook-title').addEventListener('change', async (e) => {
      if (!activeNotebookId) {
        return;
      }
      const title = e.target.value.trim();
      if (title) {
        await sendMessage({ action: 'updateNotebook', notebookId: activeNotebookId, title });
        showToast('Title updated');
      }
    });

    // ── Interactive User Guide listeners ──
    document.getElementById('restart-guide-btn')?.addEventListener('click', () => {
      showGuideStep(0);
    });

    document.getElementById('guide-close-btn')?.addEventListener('click', () => {
      closeGuide(true);
    });

    document.getElementById('guide-skip-btn')?.addEventListener('click', () => {
      closeGuide(true);
    });

    document.getElementById('guide-prev-btn')?.addEventListener('click', () => {
      if (currentGuideStep > 0) {
        showGuideStep(currentGuideStep - 1);
      }
    });

    document.getElementById('guide-next-btn')?.addEventListener('click', () => {
      if (currentGuideStep < GUIDE_STEPS.length - 1) {
        showGuideStep(currentGuideStep + 1);
      } else {
        closeGuide(true);
      }
    });

    // Delegate external links inside guide body to open safely in new tab
    document.getElementById('guide-body')?.addEventListener('click', (e) => {
      const link = e.target.closest('a');
      if (link && link.href) {
        e.preventDefault();
        chrome.tabs.create({ url: link.href });
      }
    });

    // Re-position tooltip and spotlight on window resize
    window.addEventListener('resize', () => {
      const tooltip = document.getElementById('guide-tooltip');
      if (tooltip && !tooltip.classList.contains('hidden')) {
        positionGuideForStep(currentGuideStep);
      }
    });

    // ESC key closes guide modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const tooltip = document.getElementById('guide-tooltip');
        if (tooltip && !tooltip.classList.contains('hidden')) {
          closeGuide(true);
        }
      }
    });
  }

  async function saveApiKey() {
    const input = document.getElementById('api-key-input');
    const key = input.dataset.stored === 'true' ? null : input.value.trim();
    if (!key) {
      return;
    }

    const provider = document.getElementById('provider-selector').value;
    const model = document.getElementById('model-select').value;
    const status = document.getElementById('key-status');

    try {
      await sendMessage({ action: 'storeApiKey', key, provider, model });
      await sendMessage({ action: 'saveSettings', model, provider });

      const testResult = await sendMessage({ action: 'testApiKey', key, provider, model });
      status.style.display = 'block';

      if (testResult.valid) {
        status.className = 'status ok';
        status.textContent = '✓ API key is valid and working';
        input.dataset.stored = 'true';
        input.value = '••••••••••••••••';
        const apiKeysResponse = await sendMessage({ action: 'getApiKeys' });
        renderSavedKeysList(apiKeysResponse?.apiKeys || {}, apiKeysResponse?.activeProvider || provider);
      } else {
        status.className = 'status err';
        status.textContent = '✗ Error: ' + (testResult.error || 'Invalid key');
      }
    } catch (err) {
      status.style.display = 'block';
      status.className = 'status err';
      status.textContent = '✗ Error: ' + err.message;
    }
  }

  function setAttachedLlmImage(dataUrl, name) {
    attachedLlmImage = { dataUrl, name };
    const badge = document.getElementById('llm-image-preview-badge');
    const nameSpan = document.getElementById('llm-image-name');
    const attachBtn = document.getElementById('attach-llm-image-btn');
    if (badge && nameSpan) {
      nameSpan.textContent = name;
      badge.style.display = 'flex';
    }
    if (attachBtn) {
      attachBtn.classList.add('has-file');
    }
  }

  function clearAttachedLlmImage() {
    attachedLlmImage = null;
    const badge = document.getElementById('llm-image-preview-badge');
    const attachBtn = document.getElementById('attach-llm-image-btn');
    const fileInput = document.getElementById('llm-image-file-input');
    if (badge) badge.style.display = 'none';
    if (attachBtn) attachBtn.classList.remove('has-file');
    if (fileInput) fileInput.value = '';
  }

  async function sendQuestion() {
    const input = document.getElementById('question-input');
    const question = input.value.trim();

    if (!question || isLoading) {
      return;
    }

    isLoading = true;
    const btn = document.getElementById('send-btn');
    btn.disabled = true;
    btn.textContent = '...';

    // Capture attached image for LLM if present
    const pendingLlmImage = attachedLlmImage;
    clearAttachedLlmImage();

    try {
      currentCapture = await ensureCapture();
    } catch (err) {
      addMessage('assistant', err.message);
      isLoading = false;
      btn.disabled = false;
      btn.textContent = 'Envoyer';
      return;
    }

    // Display user message in chat, including the attached image if one was provided
    addMessage('user', question, null, pendingLlmImage ? pendingLlmImage.dataUrl : null);
    input.value = '';

    try {
      let provider = document.getElementById('provider-selector').value;
      let model = document.getElementById('model-select').value;
      const level = document.getElementById('explanation-level').value;
      const questionText = question;
      const isImageReq = isImageRequest(questionText);

      if (isImageReq && !skipImageModelCheck) {
        if (provider !== 'gemini' || model !== 'gemini-2.5-flash-image') {
          isLoading = false;
          btn.disabled = false;
          btn.textContent = 'Send';
          addSwitchModelPrompt(questionText);
          return;
        }
      }

      skipImageModelCheck = false;

      if (!currentCapture.transcriptText?.trim()) {
        updateTranscriptStatus(currentCapture, true);
      }

      try {
        const refreshed = await sendMessage({ action: 'refreshTranscript' });
        if (refreshed?.transcriptText?.trim()) {
          currentCapture = {
            ...currentCapture,
            transcriptText: refreshed.transcriptText,
            transcriptIsFull: refreshed.transcriptIsFull,
            transcriptSegmentCount: refreshed.trackCount
          };
          updateTranscriptStatus(currentCapture, false);
        } else if (!currentCapture.transcriptText?.trim()) {
          updateTranscriptStatus(currentCapture, false);
        }
      } catch {
        updateTranscriptStatus(currentCapture, false);
      }

      const effectiveFrameMode = currentCapture?.frameSendMode || userDefaultPreferences?.defaultFrameMode || 't0-only';
      const sendImage = effectiveFrameMode !== 'none';

      const ctx = getTranscriptContextSettings();
      const response = await sendMessage({
        action: 'askLLM',
        provider,
        model,
        question,
        imageDataUrl: sendImage ? currentCapture.dataUrl : null,
        userImageDataUrl: pendingLlmImage ? pendingLlmImage.dataUrl : null,
        videoId: currentCapture.videoId,
        videoTitle: currentCapture.videoTitle,
        currentTime: currentCapture.currentTime,
        imageId: currentCapture.imageId,
        explanationLevel: level,
        beforeSec: ctx.beforeSec,
        afterSec: ctx.afterSec,
        transcriptPreferFull: ctx.preferFull,
        transcriptMode: ctx.transcriptMode
      });

      if (response.error) {
        addMessage('assistant', 'Error: ' + response.error);
      } else {
        addMessage('assistant', response.text, {
          question,
          answer: response.text,
          explanationLevel: level,
          videoId: currentCapture.videoId,
          videoTitle: currentCapture.videoTitle,
          timestamp: currentCapture.currentTime,
          imageId: response.imageId || currentCapture.imageId
        });
      }
    } catch (err) {
      addMessage('assistant', 'Network error: ' + err.message);
    } finally {
      isLoading = false;
      btn.disabled = false;
      btn.textContent = 'Send';
    }
  }

  function renderImageReferenceInDOM(dataUrl, caption = 'Visual Reference (Revision)') {
    const container = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = 'message reference-image';

    const header = document.createElement('div');
    header.className = 'message-label';

    const titleSpan = document.createElement('span');
    titleSpan.textContent = '📷 Référence Visuelle (Mémo révision · 0 token)';
    header.appendChild(titleSpan);

    const delBtn = document.createElement('button');
    delBtn.className = 'reference-image-del-btn';
    delBtn.title = 'Remove this image from chat';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', () => {
      div.remove();
      const idx = chatLog.findIndex((m) => m.role === 'image' && m.imageDataUrl === dataUrl);
      if (idx !== -1) {
        chatLog.splice(idx, 1);
        saveChatSession();
      }
    });
    header.appendChild(delBtn);
    div.appendChild(header);

    if (caption) {
      const cap = document.createElement('div');
      cap.className = 'reference-image-caption';
      cap.textContent = caption;
      div.appendChild(cap);
    }

    const img = document.createElement('img');
    img.className = 'reference-image-img';
    img.src = dataUrl;
    img.alt = caption || 'Visual Reference';
    img.title = 'Click to open in new tab';
    img.addEventListener('click', () => {
      const w = window.open('');
      if (w) {
        w.document.write(`<body style="margin:0; background:#0f172a; display:flex; justify-content:center; align-items:center; min-height:100vh;"><img src="${dataUrl}" style="max-width:98%; max-height:98vh; object-fit:contain; border-radius:8px;" /></body>`);
      }
    });
    div.appendChild(img);

    container.appendChild(div);
    const chatScroll = document.querySelector('.chat-scroll');
    if (chatScroll) {
      chatScroll.scrollTop = chatScroll.scrollHeight;
    }
    return div;
  }

  function addImageReferenceToChat(dataUrl, caption = 'Visual Reference (Revision)') {
    renderImageReferenceInDOM(dataUrl, caption);
    chatLog.push({
      role: 'image',
      text: caption,
      imageDataUrl: dataUrl
    });
    saveChatSession();
  }

  function renderMessageInDOM(role, text, entryData = null, attachedImageDataUrl = null) {
    const container = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = `message ${role}`;

    const label = document.createElement('div');
    label.className = 'message-label';
    label.textContent = role === 'user' ? 'You' : 'ClarifyTube';
    div.appendChild(label);

    const content = document.createElement('div');
    content.className = 'message-body';
    const safeText = text != null ? String(text) : '';
    if (typeof renderMessageContent === 'function') {
      renderMessageContent(content, safeText);
    } else {
      content.textContent = safeText;
    }
    div.appendChild(content);

    const imgUrl = attachedImageDataUrl || entryData?.imageDataUrl;
    if (imgUrl) {
      if (role === 'user' && attachedImageDataUrl) {
        const tag = document.createElement('div');
        tag.className = 'message-img-tag';
        tag.textContent = '🤖 Photo jointe transmise à l’IA';
        div.appendChild(tag);
      }
      const img = document.createElement('img');
      img.className = 'message-attached-img';
      img.src = imgUrl;
      img.alt = 'Attached Frame';
      img.title = 'Click to open';
      img.addEventListener('click', () => {
        const w = window.open('');
        if (w) {
          w.document.write(`<body style="margin:0; background:#0f172a; display:flex; justify-content:center; align-items:center; min-height:100vh;"><img src="${imgUrl}" style="max-width:98%; max-height:98vh; object-fit:contain; border-radius:8px;" /></body>`);
        }
      });
      div.appendChild(img);
    }

    // Copy button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'message-copy-btn';
    copyBtn.title = 'Copy message';
    copyBtn.textContent = '⎘';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(safeText).then(() => {
        copyBtn.textContent = '✓';
        copyBtn.classList.add('message-copy-btn--copied');
        setTimeout(() => {
          copyBtn.textContent = '⎘';
          copyBtn.classList.remove('message-copy-btn--copied');
        }, 1500);
      }).catch(() => {
        copyBtn.textContent = '✗';
        setTimeout(() => { copyBtn.textContent = '⎘'; }, 1500);
      });
    });
    div.appendChild(copyBtn);

    if (role === 'assistant' && entryData) {
      const actions = document.createElement('div');
      actions.className = 'message-actions';

      const addBtn = document.createElement('button');
      addBtn.textContent = '📌 Add to notebook';
      addBtn.addEventListener('click', () => {
        openAddToNotebookModal(entryData);
      });

      const noteBtn = document.createElement('button');
      noteBtn.textContent = '📝 Add a note';
      noteBtn.addEventListener('click', () => {
        openAddNoteModal(entryData);
      });

      actions.appendChild(addBtn);
      actions.appendChild(noteBtn);
      div.appendChild(actions);
    }

    container.appendChild(div);
    const chatScroll = document.querySelector('.chat-scroll');
    if (chatScroll) {
      chatScroll.scrollTop = chatScroll.scrollHeight;
    }
    return div;
  }

  function addMessage(role, text, entryData = null, attachedImageDataUrl = null) {
    const finalImg = attachedImageDataUrl || entryData?.imageDataUrl || null;
    renderMessageInDOM(role, text, entryData, finalImg);
    chatLog.push({
      role,
      text: text != null ? String(text) : '',
      imageDataUrl: finalImg,
      entryData
    });
    saveChatSession();
  }

  async function saveChatSession() {
    try {
      await chrome.storage.local.set({
        activeChatSession: chatLog,
        activeChatMeta: {
          videoId: currentCapture?.videoId || null,
          videoTitle: currentCapture?.videoTitle || null,
          currentTime: currentCapture?.currentTime || 0
        }
      });
    } catch (err) {
      console.warn('[YTAITutor] Error saving active chat session:', err);
    }
  }

  async function loadChatSession() {
    try {
      const stored = await chrome.storage.local.get(['activeChatSession', 'activeChatMeta']);
      if (Array.isArray(stored.activeChatSession) && stored.activeChatSession.length > 0) {
        chatLog = [];
        const container = document.getElementById('chat-messages');
        if (container) container.innerHTML = '';

        for (const item of stored.activeChatSession) {
          if (!item) continue;
          if (item.role === 'image') {
            if (item.imageDataUrl) {
              renderImageReferenceInDOM(item.imageDataUrl, item.text || 'Visual Reference');
              chatLog.push(item);
            }
          } else {
            renderMessageInDOM(item.role || 'assistant', item.text || '', item.entryData || null, item.imageDataUrl || null);
            chatLog.push(item);
          }
        }

        if (stored.activeChatMeta?.videoId && !currentCapture?.videoId) {
          currentCapture = {
            ...(currentCapture || {}),
            ...stored.activeChatMeta
          };
        }
      }
    } catch (err) {
      console.warn('[YTAITutor] Error restoring chat session:', err);
    }
  }

  async function clearChatSession() {
    chatLog = [];
    const container = document.getElementById('chat-messages');
    if (container) container.innerHTML = '';
    await chrome.storage.local.remove(['activeChatSession', 'activeChatMeta']);
    showToast('Nouveau chat démarré !');
  }

  async function resumeChatFromEntry(entry) {
    if (!entry) return;

    // Switch to Chat tab
    document.querySelector('.tab[data-panel="chat"]').click();

    // Set video/capture context
    if (entry.videoId) {
      currentCapture = {
        ...(currentCapture || {}),
        videoId: entry.videoId,
        videoTitle: entry.videoTitle,
        currentTime: entry.timestamp || 0,
        dataUrl: entry.imageDataUrl || currentCapture?.dataUrl || null,
        imageId: entry.imageId || null
      };
      updateCapturePreview(currentCapture);
    }

    if (entry.explanationLevel) {
      const levelSelect = document.getElementById('explanation-level');
      if (levelSelect) levelSelect.value = entry.explanationLevel;
    }

    // If entry has an image, render it as a reference image for revision
    if (entry.imageDataUrl) {
      renderImageReferenceInDOM(
        entry.imageDataUrl,
        `Capture @ ${entry.humanTime || formatTime(entry.timestamp)} — ${entry.videoTitle || 'Vidéo'}`
      );
      chatLog.push({
        role: 'image',
        text: `Capture @ ${entry.humanTime || formatTime(entry.timestamp)}`,
        imageDataUrl: entry.imageDataUrl
      });
    }

    // Render user question
    renderMessageInDOM('user', entry.question, null, null);
    chatLog.push({ role: 'user', text: entry.question });

    // Render assistant answer
    renderMessageInDOM('assistant', entry.answer, entry, null);
    chatLog.push({ role: 'assistant', text: entry.answer, entryData: entry });

    saveChatSession();

    // Focus input for next question
    const input = document.getElementById('question-input');
    if (input) {
      input.focus();
      input.placeholder = 'Poser une question de suivi sur ce point...';
    }

    showToast('Chat repris ! Vous pouvez poser une question de suivi.');
  }

  async function resumeChatFromNotebook(notebookId) {
    if (!notebookId) return;
    const entries = await sendMessage({ action: 'getNotebookEntries', notebookId });
    const chatEntries = (entries || []).filter((e) => e.type === 'chat');

    if (!chatEntries.length) {
      showToast('Aucun échange chat dans ce notebook à reprendre.');
      return;
    }

    // Switch to Chat tab
    document.querySelector('.tab[data-panel="chat"]').click();

    // Clear current chat
    chatLog = [];
    const container = document.getElementById('chat-messages');
    if (container) container.innerHTML = '';

    // Populate in chronological order
    for (const entry of chatEntries) {
      if (entry.imageDataUrl) {
        renderImageReferenceInDOM(
          entry.imageDataUrl,
          `Capture @ ${entry.humanTime || formatTime(entry.timestamp)} — ${entry.videoTitle || 'Vidéo'}`
        );
        chatLog.push({
          role: 'image',
          text: `Capture @ ${entry.humanTime || formatTime(entry.timestamp)}`,
          imageDataUrl: entry.imageDataUrl
        });
      }

      renderMessageInDOM('user', entry.question, null, null);
      chatLog.push({ role: 'user', text: entry.question });

      renderMessageInDOM('assistant', entry.answer, entry, null);
      chatLog.push({ role: 'assistant', text: entry.answer, entryData: entry });
    }

    const last = chatEntries[chatEntries.length - 1];
    if (last?.videoId) {
      currentCapture = {
        ...(currentCapture || {}),
        videoId: last.videoId,
        videoTitle: last.videoTitle,
        currentTime: last.timestamp || 0,
        dataUrl: last.imageDataUrl || null,
        imageId: last.imageId || null
      };
      updateCapturePreview(currentCapture);
    }

    saveChatSession();
    const input = document.getElementById('question-input');
    if (input) {
      input.focus();
      input.placeholder = 'Continuer la discussion sur ce notebook...';
    }
    showToast(`Session reprise (${chatEntries.length} échanges) !`);
  }

  function addSwitchModelPrompt(questionText) {
    const container = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = 'message assistant';

    const label = document.createElement('div');
    label.className = 'message-label';
    label.textContent = 'ClarifyTube';
    div.appendChild(label);

    const content = document.createElement('div');
    content.className = 'message-body rich-content message-content';
    content.innerHTML = `<p>Votre question semble concerner un schéma ou une figure. Le modèle <strong>gemini-2.5-flash-image</strong> est recommandé pour ces requêtes. Souhaitez-vous l'utiliser ?</p>`;

    const actions = document.createElement('div');
    actions.className = 'message-actions';
    actions.style.marginTop = '8px';
    actions.style.display = 'flex';
    actions.style.gap = '8px';

    const yesBtn = document.createElement('button');
    yesBtn.textContent = 'Oui, basculer';
    yesBtn.addEventListener('click', async () => {
      const providerSelector = document.getElementById('provider-selector');
      providerSelector.value = 'gemini';
      providerSelector.dispatchEvent(new Event('change'));

      setTimeout(() => {
        const modelSelect = document.getElementById('model-select');
        modelSelect.value = 'gemini-2.5-flash-image';
        modelSelect.dispatchEvent(new Event('change'));

        div.remove();

        document.getElementById('question-input').value = questionText;
        sendQuestion();
      }, 50);
    });

    const noBtn = document.createElement('button');
    noBtn.textContent = 'Non, continuer';
    noBtn.addEventListener('click', () => {
      div.remove();
      skipImageModelCheck = true;
      document.getElementById('question-input').value = questionText;
      sendQuestion();
    });

    actions.appendChild(yesBtn);
    actions.appendChild(noBtn);
    content.appendChild(actions);
    div.appendChild(content);
    container.appendChild(div);

    const chatScroll = document.querySelector('.chat-scroll');
    if (chatScroll) {
      chatScroll.scrollTop = chatScroll.scrollHeight;
    }
  }

  async function loadNotebooks() {
    try {
      const notebooks = await sendMessage({ action: 'listNotebooks' });
      renderNotebooksList(notebooks);
    } catch (err) {
      console.error('Erreur chargement notebooks:', err);
    }
  }

  async function renderNotebooksList(notebooks) {
    const container = document.getElementById('notebook-list');
    container.innerHTML = '';

    if (!notebooks || notebooks.length === 0) {
      container.innerHTML = '<div class="empty-state">No notebooks created yet.</div>';
      return;
    }

    for (const nb of notebooks) {
      const card = document.createElement('div');
      card.className = 'notebook-card';
      card.style.borderLeft = `4px solid ${nb.color || '#7c93ff'}`;

      const header = document.createElement('div');
      header.className = 'notebook-card-header';

      const title = document.createElement('div');
      title.className = 'notebook-card-title';
      title.textContent = nb.title;

      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = '🗑️';
      deleteBtn.style.background = 'none';
      deleteBtn.style.border = 'none';
      deleteBtn.style.cursor = 'pointer';
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(`Delete notebook "${nb.title}" and all its entries?`)) {
          await sendMessage({ action: 'deleteNotebook', notebookId: nb.id });
          loadNotebooks();
          showToast('Notebook deleted');
        }
      });

      header.appendChild(title);
      header.appendChild(deleteBtn);

      const desc = document.createElement('div');
      desc.className = 'notebook-card-meta';
      desc.textContent = nb.description || 'No description';

      const entries = await sendMessage({ action: 'getNotebookEntries', notebookId: nb.id });
      const stats = document.createElement('div');
      stats.className = 'notebook-card-meta';
      stats.style.marginTop = '6px';
      stats.textContent = `${entries.length} ${entries.length > 1 ? 'entries' : 'entry'} • Updated on ${new Date(nb.updatedAt || nb.createdAt).toLocaleDateString()}`;

      card.appendChild(header);
      card.appendChild(desc);
      card.appendChild(stats);

      card.addEventListener('click', () => {
        activeNotebookId = nb.id;
        document.querySelector('.tab[data-panel="active-notebook"]').click();
      });

      container.appendChild(card);
    }
  }

  async function loadActiveNotebook(notebookId) {
    const notebook = await sendMessage({ action: 'getNotebook', notebookId });
    if (!notebook) {
      return;
    }
    document.getElementById('active-notebook-title').value = notebook.title;
    const entries = await sendMessage({ action: 'getNotebookEntries', notebookId });
    renderActiveNotebookEntries(entries);
  }

  function formatTime(seconds) {
    const s = Math.floor(seconds || 0);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const mStr = String(m % 60).padStart(2, '0');
    const sStr = String(s % 60).padStart(2, '0');
    if (h > 0) {
      return `${h}:${mStr}:${sStr}`;
    }
    return `${m}:${sStr}`;
  }

  function renderActiveNotebookEntries(entries) {
    const container = document.getElementById('active-notebook-entries');
    container.innerHTML = '';

    if (!entries || entries.length === 0) {
      container.innerHTML = '<div class="empty-state">No entries in this notebook.</div>';
      return;
    }

    entries.forEach((entry) => {
      const card = document.createElement('div');
      card.className = 'timeline-card';
      if (entry.type === 'note') {
        card.classList.add('timeline-note');
      }

      const header = document.createElement('div');
      header.className = 'timeline-header';

      const videoLink = document.createElement('span');
      videoLink.style.cursor = 'pointer';
      videoLink.style.fontWeight = 'bold';
      videoLink.style.textDecoration = 'underline';
      videoLink.textContent = `${entry.videoTitle || 'Video'} @ ${entry.humanTime || formatTime(entry.timestamp)}`;
      videoLink.addEventListener('click', () => {
        if (entry.videoId) {
          chrome.tabs.create({
            url: `${entry.videoUrl || `https://www.youtube.com/watch?v=${entry.videoId}`}&t=${Math.floor(entry.timestamp)}s`
          });
        }
      });

      const actions = document.createElement('div');
      actions.className = 'notebook-card-actions';

      if (entry.type === 'chat') {
        const resumeBtn = document.createElement('button');
        resumeBtn.className = 'continue-chat-btn';
        resumeBtn.textContent = '💬 Continuer';
        resumeBtn.title = 'Reprendre ce chat dans la fenêtre de discussion';
        resumeBtn.addEventListener('click', () => {
          resumeChatFromEntry(entry);
        });
        actions.appendChild(resumeBtn);
      }

      if (entry.type === 'note') {
        const editBtn = document.createElement('button');
        editBtn.textContent = '✏️';
        editBtn.addEventListener('click', () => {
          openEditNoteModal(entry);
        });
        actions.appendChild(editBtn);
      }

      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = '🗑️';
      deleteBtn.addEventListener('click', async () => {
        if (confirm('Delete this entry?')) {
          await sendMessage({ action: 'deleteNotebookEntry', entryId: entry.id });
          loadActiveNotebook(activeNotebookId);
          showToast('Entry deleted');
        }
      });
      actions.appendChild(deleteBtn);

      header.appendChild(videoLink);
      header.appendChild(actions);
      card.appendChild(header);

      const body = document.createElement('div');
      body.className = 'timeline-body';

      if (entry.type === 'chat') {
        const q = document.createElement('div');
        q.className = 'timeline-question';
        if (typeof renderMessageContent === 'function') {
          renderMessageContent(q, entry.question);
        } else {
          q.textContent = entry.question;
        }

        const answerLabel = document.createElement('div');
        answerLabel.className = 'timeline-answer-label';
        answerLabel.textContent = 'Answer';

        const a = document.createElement('div');
        if (typeof renderMessageContent === 'function') {
          renderMessageContent(a, entry.answer);
        } else {
          a.textContent = entry.answer;
        }

        body.appendChild(q);
        body.appendChild(answerLabel);
        body.appendChild(a);
      } else if (entry.type === 'note') {
        body.textContent = entry.noteText;
      } else if (entry.type === 'capture') {
        body.textContent = 'Annotated frame capture.';
      }

      if (entry.imageDataUrl) {
        const img = document.createElement('img');
        img.className = 'timeline-image';
        img.src = entry.imageDataUrl;
        body.appendChild(img);
      }

      card.appendChild(body);
      container.appendChild(card);
    });
  }

  function openCreateNotebookModal() {
    const modal = document.getElementById('modal-overlay');
    const card = document.getElementById('modal-card');
    modal.classList.remove('hidden');

    card.innerHTML = `
      <h4>New Notebook</h4>
      <label>Title</label>
      <input type="text" id="new-nb-title" placeholder="My Notebook">
      <label>Description</label>
      <input type="text" id="new-nb-desc" placeholder="Course notes">
      <label>Accent Color</label>
      <select id="new-nb-color">
        <option value="#7c93ff">Blue</option>
        <option value="#f87171">Red</option>
        <option value="#4ade80">Green</option>
        <option value="#fbbf24">Yellow</option>
        <option value="#c084fc">Purple</option>
      </select>
      <div class="modal-actions">
        <button class="cancel">Cancel</button>
        <button class="primary-btn" id="confirm-new-nb">Create</button>
      </div>
    `;

    card.querySelector('.cancel').addEventListener('click', () => {
      modal.classList.add('hidden');
    });

    card.querySelector('#confirm-new-nb').addEventListener('click', async () => {
      const title = card.querySelector('#new-nb-title').value.trim();
      const description = card.querySelector('#new-nb-desc').value.trim();
      const color = card.querySelector('#new-nb-color').value;

      if (!title) {
        alert('Title is required');
        return;
      }

      await sendMessage({ action: 'createNotebook', title, description, color });
      modal.classList.add('hidden');
      loadNotebooks();
      showToast('Notebook created');
    });
  }

  async function openAddToNotebookModal(entryData) {
    const modal = document.getElementById('modal-overlay');
    const card = document.getElementById('modal-card');
    modal.classList.remove('hidden');

    const notebooks = await sendMessage({ action: 'listNotebooks' });

    let options = notebooks.map(nb => `<option value="${nb.id}">${nb.title}</option>`).join('');

    card.innerHTML = `
      <h4>Add to notebook</h4>
      <label>Select a notebook</label>
      <select id="select-nb-dest">
        ${options}
        <option value="new-nb">+ Create notebook...</option>
      </select>
      <div class="modal-actions">
        <button class="cancel">Cancel</button>
        <button class="primary-btn" id="confirm-add-entry">Add</button>
      </div>
    `;

    card.querySelector('.cancel').addEventListener('click', () => {
      modal.classList.add('hidden');
    });

    card.querySelector('#confirm-add-entry').addEventListener('click', async () => {
      const val = card.querySelector('#select-nb-dest').value;
      if (val === 'new-nb') {
        modal.classList.add('hidden');
        openCreateNotebookModal();
        return;
      }

      const entry = {
        type: 'chat',
        question: entryData.question,
        answer: entryData.answer,
        explanationLevel: entryData.explanationLevel,
        overlay: entryData.overlay,
        videoId: entryData.videoId,
        videoTitle: entryData.videoTitle,
        videoUrl: entryData.videoId ? `https://www.youtube.com/watch?v=${entryData.videoId}` : null,
        timestamp: entryData.timestamp,
        humanTime: formatTime(entryData.timestamp),
        imageId: entryData.imageId
      };

      await sendMessage({ action: 'addEntryToNotebook', notebookId: val, entry });
      modal.classList.add('hidden');
      showToast('Added successfully!');
    });
  }

  async function openAddNoteModal(parentEntryData = null) {
    const modal = document.getElementById('modal-overlay');
    const card = document.getElementById('modal-card');
    modal.classList.remove('hidden');

    const notebooks = await sendMessage({ action: 'listNotebooks' });
    let options = notebooks.map(nb => `<option value="${nb.id}">${nb.title}</option>`).join('');

    card.innerHTML = `
      <h4>Add a note</h4>
      <label>Notebook</label>
      <select id="select-note-nb">
        ${options}
        <option value="new-nb">+ Create notebook...</option>
      </select>
      <label>Note</label>
      <textarea id="note-textarea" rows="4" placeholder="Write your note here..."></textarea>
      <div class="modal-actions">
        <button class="cancel">Cancel</button>
        <button class="primary-btn" id="confirm-add-note">Save</button>
      </div>
    `;

    card.querySelector('.cancel').addEventListener('click', () => {
      modal.classList.add('hidden');
    });

    card.querySelector('#confirm-add-note').addEventListener('click', async () => {
      const notebookId = card.querySelector('#select-note-nb').value;
      const text = card.querySelector('#note-textarea').value.trim();

      if (notebookId === 'new-nb') {
        modal.classList.add('hidden');
        openCreateNotebookModal();
        return;
      }

      if (!text) {
        alert('Note cannot be empty');
        return;
      }

      let imageId = parentEntryData ? parentEntryData.imageId : (currentCapture ? currentCapture.imageId : null);
      let videoId = parentEntryData ? parentEntryData.videoId : (currentCapture ? currentCapture.videoId : null);
      let videoTitle = parentEntryData ? parentEntryData.videoTitle : (currentCapture ? currentCapture.videoTitle : null);
      let timestamp = parentEntryData ? parentEntryData.timestamp : (currentCapture ? currentCapture.currentTime : 0);

      const entry = {
        type: 'note',
        noteText: text,
        videoId,
        videoTitle,
        videoUrl: videoId ? `https://www.youtube.com/watch?v=${videoId}` : null,
        timestamp,
        humanTime: formatTime(timestamp),
        imageId
      };

      await sendMessage({ action: 'addEntryToNotebook', notebookId, entry });
      modal.classList.add('hidden');
      showToast('Note added!');
    });
  }

  function openEditNoteModal(entry) {
    const modal = document.getElementById('modal-overlay');
    const card = document.getElementById('modal-card');
    modal.classList.remove('hidden');

    card.innerHTML = `
      <h4>Edit note</h4>
      <textarea id="edit-note-textarea" rows="4">${entry.noteText || ''}</textarea>
      <div class="modal-actions">
        <button class="cancel">Cancel</button>
        <button class="primary-btn" id="confirm-edit-note">Save</button>
      </div>
    `;

    card.querySelector('.cancel').addEventListener('click', () => {
      modal.classList.add('hidden');
    });

    card.querySelector('#confirm-edit-note').addEventListener('click', async () => {
      const text = card.querySelector('#edit-note-textarea').value.trim();
      if (!text) {
        alert('Note cannot be empty');
        return;
      }

      await sendMessage({ action: 'updateNotebookEntry', entryId: entry.id, updates: { noteText: text } });
      modal.classList.add('hidden');
      loadActiveNotebook(activeNotebookId);
      showToast('Note edited');
    });
  }

  function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.remove('hidden');
    setTimeout(() => {
      toast.classList.add('hidden');
    }, 2000);
  }

  function debounce(fn, delay) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }
})();
