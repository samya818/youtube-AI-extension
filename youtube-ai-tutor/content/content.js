/**
 * @file Content script — injected on youtube.com watch pages.
 */

(function () {
  'use strict';

  const SCRIPT_VERSION = 6;

  if (window.__YTAITUTOR_LOADED__ && window.__YTAITUTOR_SCRIPT_VERSION__ >= SCRIPT_VERSION) {
    return;
  }

  if (window.__YTAITUTOR_LOADED__) {
    document.getElementById('ytaitutor-float-btn')?.remove();
  }

  window.__YTAITUTOR_LOADED__ = true;
  window.__YTAITUTOR_SCRIPT_VERSION__ = SCRIPT_VERSION;

  let videoElement = null;
  let playerContainer = null;
  let floatingButton = null;
  let overlayManager = null;
  let currentVideoId = null;

  /**
   * Injects the page script to access ytInitialPlayerResponse.
   */
  function injectPageScript() {
    try {
      const existing = document.getElementById('ytaitutor-page-script');
      if (existing) {
        return;
      }

      const script = document.createElement('script');
      script.id = 'ytaitutor-page-script';
      script.src = chrome.runtime.getURL('content/page-script.js');
      script.onload = () => script.remove();
      (document.head || document.documentElement).appendChild(script);
    } catch (err) {
      console.error('[YTAITutor] Erreur injection page script:', err);
    }
  }

  window.addEventListener('message', (event) => {
    try {
      if (event.source !== window) {
        return;
      }
      if (event.data?.source !== 'YTAITUTOR_PAGE') {
        return;
      }
      if (event.data.type === 'TRANSCRIPT_DATA') {
        window.__YTAITUTOR_TRANSCRIPT__ = event.data.payload;
      }
    } catch (err) {
      console.error('[YTAITutor] Erreur message page:', err);
    }
  });

  /**
   * Detects the video player and injects UI when on a watch page.
   * @returns {boolean}
   */
  function detectVideoPlayer() {
    try {
      const video = document.querySelector('video');
      const player = document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
      let videoId = new URLSearchParams(window.location.search).get('v');

      if (!videoId) {
        const shortsMatch = window.location.pathname.match(/\/shorts\/([^/?]+)/);
        videoId = shortsMatch ? shortsMatch[1] : null;
      }

      if (!video || !player || !videoId) {
        return false;
      }

      videoElement = video;
      playerContainer = player;

      if (videoId !== currentVideoId) {
        currentVideoId = videoId;
        window.__YTAITUTOR_TRANSCRIPT__ = null;
        injectPageScript();
      }

      injectFloatingButton();

      if (overlayManager) {
        overlayManager.setPlayer(player);
      }

      return true;
    } catch (err) {
      console.error('[YTAITutor] Erreur détection lecteur:', err);
      return false;
    }
  }

  const bodyObserver = new MutationObserver(debounce(() => {
    detectVideoPlayer();
  }, 500));

  if (document.body) {
    bodyObserver.observe(document.body, { childList: true, subtree: true });
    detectVideoPlayer();
  } else {
    window.addEventListener('DOMContentLoaded', () => {
      bodyObserver.observe(document.body, { childList: true, subtree: true });
      detectVideoPlayer();
    });
  }

  let lastUrl = location.href;
  new MutationObserver(() => {
    try {
      const url = location.href;
      if (url !== lastUrl) {
        lastUrl = url;
        currentVideoId = null;
        if (floatingButton) {
          floatingButton.remove();
          floatingButton = null;
        }
        setTimeout(detectVideoPlayer, 1500);
      }
    } catch (err) {
      console.error('[YTAITutor] Erreur navigation SPA:', err);
    }
  }).observe(document, { subtree: true, childList: true });

  /**
   * Injects the floating "?" button on the video player.
   */
  function injectFloatingButton() {
    try {
      if (floatingButton || !playerContainer) {
        return;
      }

      floatingButton = document.createElement('button');
      floatingButton.id = 'ytaitutor-float-btn';
      floatingButton.textContent = '?';
      floatingButton.title = 'Ask a question about this video (Ctrl+Shift+?)';
      floatingButton.style.cssText = `
        position: absolute;
        bottom: 60px;
        right: 20px;
        width: 48px;
        height: 48px;
        border-radius: 50%;
        background: #4285f4;
        color: white;
        border: none;
        font-size: 24px;
        font-weight: bold;
        cursor: pointer;
        z-index: 10000;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        opacity: 0.45;
        transition: opacity 0.3s, transform 0.2s;
        pointer-events: auto;
        display: flex;
        align-items: center;
        justify-content: center;
      `;

      playerContainer.addEventListener('mouseenter', () => {
        floatingButton.style.opacity = '1';
      });
      playerContainer.addEventListener('mouseleave', () => {
        floatingButton.style.opacity = '0.45';
      });

      floatingButton.addEventListener('click', (e) => {
        e.stopPropagation();
        triggerCapture();
      });
      floatingButton.addEventListener('mouseenter', () => {
        floatingButton.style.transform = 'scale(1.1)';
      });
      floatingButton.addEventListener('mouseleave', () => {
        floatingButton.style.transform = 'scale(1)';
      });

      playerContainer.appendChild(floatingButton);
    } catch (err) {
      console.error('[YTAITutor] Erreur bouton flottant:', err);
    }
  }

  document.addEventListener('keydown', (e) => {
    try {
      if (e.ctrlKey && e.shiftKey && (e.key === '?' || e.key === '/' || e.key === '¿')) {
        e.preventDefault();
        triggerCapture();
      }
    } catch (err) {
      console.error('[YTAITutor] Erreur raccourci:', err);
    }
  });

  /**
   * Requests fresh caption metadata from the page script.
   * @returns {Promise<object|null>}
   */
  async function ensureTranscriptLoaded() {
    if (window.__YTAITUTOR_TRANSCRIPT__?.url) {
      return window.__YTAITUTOR_TRANSCRIPT__;
    }

    injectPageScript();
    window.postMessage({ source: 'YTAITUTOR_CONTENT', type: 'REQUEST_TRANSCRIPT' }, '*');

    return new Promise((resolve) => {
      const deadline = Date.now() + 5000;
      const check = setInterval(() => {
        if (window.__YTAITUTOR_TRANSCRIPT__?.url || Date.now() > deadline) {
          clearInterval(check);
          resolve(window.__YTAITUTOR_TRANSCRIPT__ || null);
        }
      }, 100);
    });
  }

  /**
   * Builds capture metadata and frame from the current video.
   * @param {boolean} pauseVideo
   * @returns {Promise<object>}
   */
  async function buildCaptureData(pauseVideo = true) {
    detectVideoPlayer();

    if (!videoElement) {
      throw new Error('Aucune vidéo en lecture sur cette page.');
    }

    if (pauseVideo) {
      videoElement.pause();
    }

    const currentTime = videoElement.currentTime;
    let videoId = new URLSearchParams(window.location.search).get('v');
    if (!videoId) {
      const shortsMatch = window.location.pathname.match(/\/shorts\/([^/?]+)/);
      videoId = shortsMatch ? shortsMatch[1] : null;
    }
    const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string')
      || document.querySelector('h1.ytd-watch-flexy')
      || document.querySelector('h1.title');
    const videoTitle = titleEl?.textContent?.trim() || 'Unknown';
    const dataUrl = await CaptureEngine.capture(videoElement);

    const transcriptData = await ensureTranscriptLoaded();

    return {
      videoId,
      videoTitle,
      currentTime,
      dataUrl,
      transcriptLang: transcriptData?.language || null,
      timestamp: Date.now()
    };
  }

  /**
   * Captures the current frame and stores it via the service worker.
   * @param {boolean} pauseVideo
   * @returns {Promise<object>}
   */
  async function captureAndStore(pauseVideo = true) {
    const data = await buildCaptureData(pauseVideo);

    const storeResult = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'storeCapture', data }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response?.success) {
          reject(new Error('Échec du stockage de la capture'));
          return;
        }
        resolve(response);
      });
    });

    const capture = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'getCapture' }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    });

    return { ...capture, imageId: storeResult.imageId || capture?.imageId };
  }

  /**
   * Pauses the video, captures T-6/T0/T+6, and opens the annotation panel.
   */
  async function triggerCapture() {
    try {
      detectVideoPlayer();

      if (!videoElement) {
        console.warn('[YTAITutor] Aucune vidéo détectée');
        return;
      }

      videoElement.pause();
      const currentTime = videoElement.currentTime;

      let videoId = new URLSearchParams(window.location.search).get('v');
      if (!videoId) {
        const shortsMatch = window.location.pathname.match(/\/shorts\/([^/?]+)/);
        videoId = shortsMatch ? shortsMatch[1] : null;
      }

      const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string')
        || document.querySelector('h1.ytd-watch-flexy')
        || document.querySelector('h1.title');
      const videoTitle = titleEl?.textContent?.trim() || 'Unknown';

      const transcriptData = await ensureTranscriptLoaded();
      const { frames } = await CaptureEngine.captureMultiFrame(videoElement, currentTime);

      openAnnotationPanel(frames, videoId, videoTitle, currentTime, transcriptData, videoElement);
    } catch (err) {
      console.error('[YTAITutor] Erreur capture:', err);
    }
  }

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    (async () => {
      try {
        switch (request.action) {
          case 'showOverlay':
            if (!overlayManager) {
              overlayManager = new VideoOverlay();
            }
            overlayManager.setPlayer(playerContainer);
            overlayManager.setElements(request.elements);
            sendResponse({ success: true });
            break;

          case 'clearOverlay':
            if (overlayManager) {
              overlayManager.clear();
            }
            sendResponse({ success: true });
            break;

          case 'captureNow': {
            const capture = await captureAndStore(request.pauseVideo !== false);
            sendResponse({ success: true, capture });
            break;
          }

          case 'openAnnotation':
            await triggerCapture();
            sendResponse({ success: true });
            break;

          case 'getVideoInfo':
            sendResponse({
              currentTime: videoElement?.currentTime || 0,
              videoId: currentVideoId,
              paused: videoElement?.paused ?? true
            });
            break;

          case 'scrapeTranscriptFromDom': {
            if (typeof window.__YTAITUTOR_SCRAPE_TRANSCRIPT_PANEL__ === 'function') {
              const segments = await window.__YTAITUTOR_SCRAPE_TRANSCRIPT_PANEL__();
              sendResponse({ success: true, segments });
            } else {
              sendResponse({ success: false, error: 'Page script not ready or not loaded' });
            }
            break;
          }

          default:
            sendResponse({ error: 'Action inconnue' });
        }
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();

    return true;
  });

  if (videoElement) {
    videoElement.addEventListener('play', () => {
      if (overlayManager) {
        overlayManager.clear();
      }
    });
  }

})();
