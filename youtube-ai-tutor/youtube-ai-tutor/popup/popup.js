/**
 * @file Popup UI logic for independent notebooks, chat, settings.
 */

(function () {
  'use strict';

  let currentCapture = null;
  let isLoading = false;
  let activeNotebookId = null;
  let skipImageModelCheck = false;

  /** @type {Record<string, { beforeSec: number, afterSec: number, preferFull: boolean }>} */
  const TRANSCRIPT_PRIORITY_PRESETS = {
    economical: { beforeSec: 30, afterSec: 15, preferFull: false },
    standard: { beforeSec: 60, afterSec: 30, preferFull: false },
    complete: { beforeSec: 120, afterSec: 60, preferFull: true }
  };

  const PROVIDER_MODELS = {
    gemini: ['gemini-2.5-flash', 'gemini-2.5-flash-image', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-3.5-flash'],
    openai: ['gpt-4o', 'gpt-4o-mini'],
    anthropic: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229'],
    mistral: ['mistral-large-latest']
  };

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

  function renderModelOptions(provider, selectedModel) {
    const modelSelect = document.getElementById('model-select');
    modelSelect.innerHTML = '';
    const models = PROVIDER_MODELS[provider] || PROVIDER_MODELS.gemini;
    models.forEach((model) => {
      const option = document.createElement('option');
      option.value = model;
      option.textContent = model;
      if (model === selectedModel) {
        option.selected = true;
      }
      modelSelect.appendChild(option);
    });
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
    const preset = TRANSCRIPT_PRIORITY_PRESETS.standard;
    const priority = currentCapture?.transcriptPriority || 'standard';
    const presetValues = TRANSCRIPT_PRIORITY_PRESETS[priority] || preset;

    return {
      beforeSec: currentCapture?.beforeSec ?? presetValues.beforeSec,
      afterSec: currentCapture?.afterSec ?? presetValues.afterSec,
      preferFull: currentCapture?.transcriptPreferFull ?? presetValues.preferFull,
      priority,
      transcriptMode: currentCapture?.transcriptMode || 'local'
    };
  }

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      setupTabs();
      setupCaptureStorageListener();
      await loadCapture();
      await loadSettings();
      await loadNotebooks();
      setupEventListeners();
    } catch (err) {
      console.error('[YTAITutor Popup] Init error:', err);
    }
  });

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
      const model = settings?.model || apiKeysResponse?.apiKeys?.[provider]?.model || PROVIDER_MODELS[provider]?.[0] || PROVIDER_MODELS.gemini[0];

      document.getElementById('provider-selector').value = provider;
      document.getElementById('current-provider-label').textContent = provider;
      renderModelOptions(provider, model);
      renderSavedKeysList(apiKeysResponse?.apiKeys || {}, apiKeysResponse?.activeProvider || provider);
      updateModelIndicator(provider, model);

      const storedKey = apiKeysResponse?.apiKeys?.[provider]?.key;
      const input = document.getElementById('api-key-input');
      if (storedKey) {
        input.value = '••••••••••••••••';
        input.dataset.stored = 'true';
      } else {
        input.value = '';
        input.dataset.stored = 'false';
      }
    } catch (err) {
      console.error('Erreur chargement settings:', err);
    }
  }

  function setupEventListeners() {
    document.getElementById('send-btn').addEventListener('click', sendQuestion);
    document.getElementById('question-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        sendQuestion();
      }
    });

    document.getElementById('save-key-btn').addEventListener('click', saveApiKey);
    document.getElementById('provider-selector').addEventListener('change', async (e) => {
      const provider = e.target.value;
      document.getElementById('current-provider-label').textContent = provider;
      renderModelOptions(provider, PROVIDER_MODELS[provider]?.[0]);
      updateModelIndicator(provider, PROVIDER_MODELS[provider]?.[0]);
      try {
        await sendMessage({ action: 'saveSettings', provider, model: document.getElementById('model-select').value });
        const apiKeysResponse = await sendMessage({ action: 'getApiKeys' });
        renderSavedKeysList(apiKeysResponse?.apiKeys || {}, apiKeysResponse?.activeProvider || provider);
        const storedKey = apiKeysResponse?.apiKeys?.[provider]?.key;
        const input = document.getElementById('api-key-input');
        input.value = storedKey ? '••••••••••••••••' : '';
        input.dataset.stored = storedKey ? 'true' : 'false';
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
      } catch (err) {
        console.error('Erreur sauvegarde modèle:', err);
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

    document.getElementById('clear-overlay-btn').addEventListener('click', async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) {
          await chrome.tabs.sendMessage(tab.id, { action: 'clearOverlay' });
        }
      } catch (err) {
        console.error('Erreur clear overlay:', err);
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

    try {
      currentCapture = await ensureCapture();
    } catch (err) {
      addMessage('assistant', err.message);
      isLoading = false;
      btn.disabled = false;
      btn.textContent = 'Envoyer';
      return;
    }

    addMessage('user', question);
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

      const ctx = getTranscriptContextSettings();
      const response = await sendMessage({
        action: 'askLLM',
        provider,
        model,
        question,
        imageDataUrl: currentCapture.dataUrl,
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
          overlay: response.overlay,
          videoId: currentCapture.videoId,
          videoTitle: currentCapture.videoTitle,
          timestamp: currentCapture.currentTime,
          imageId: response.imageId || currentCapture.imageId
        });

        if (response.overlay && response.overlay.length > 0) {
          const youtubeTabs = await chrome.tabs.query({
            url: ['*://www.youtube.com/*', '*://youtube.com/*']
          });
          const targetTab = youtubeTabs.find((tab) =>
            getVideoIdFromUrl(tab.url) === currentCapture.videoId
          ) || youtubeTabs.find((tab) => isYouTubeVideoUrl(tab.url));

          if (targetTab?.id) {
            try {
              await chrome.tabs.sendMessage(targetTab.id, {
                action: 'showOverlay',
                elements: response.overlay
              });
            } catch {
              addMessage('assistant', '(Overlay not displayed — go back to the YouTube tab)');
            }
          }
        }
      }
    } catch (err) {
      addMessage('assistant', 'Network error: ' + err.message);
    } finally {
      isLoading = false;
      btn.disabled = false;
      btn.textContent = 'Send';
    }
  }

  function addMessage(role, text, entryData = null) {
    const container = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = `message ${role}`;

    const label = document.createElement('div');
    label.className = 'message-label';
    label.textContent = role === 'user' ? 'You' : 'AI Tutor';
    div.appendChild(label);

    const content = document.createElement('div');
    content.className = 'message-body';
    if (typeof renderMessageContent === 'function') {
      renderMessageContent(content, text);
    } else {
      content.textContent = text;
    }
    div.appendChild(content);

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
  }

  function addSwitchModelPrompt(questionText) {
    const container = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = 'message assistant';

    const label = document.createElement('div');
    label.className = 'message-label';
    label.textContent = 'AI Tutor';
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
