/**
 * @file Page script — runs in YouTube page context to access ytInitialPlayerResponse.
 */

(function () {
  'use strict';

  function getPlayerResponse() {
    let playerResponse = window.ytInitialPlayerResponse
      || window.ytInitialData?.playerResponse
      || null;

    if (!playerResponse?.captions) {
      try {
        const raw = window.ytplayer?.config?.args?.player_response
          || window.ytplayer?.config?.args?.raw_player_response;
        if (typeof raw === 'string') {
          playerResponse = JSON.parse(raw);
        } else if (raw && typeof raw === 'object') {
          playerResponse = raw;
        }
      } catch {
        /* ignore */
      }
    }

    return playerResponse;
  }

  /**
   * Extracts caption track metadata and posts it to the content script.
   */
  function extractTranscript() {
    try {
      const ytData = getPlayerResponse();
      const tracks = ytData?.captions?.captionTracks || [];
      if (!tracks.length) {
        window.postMessage({ source: 'YTAITUTOR_PAGE', type: 'TRANSCRIPT_DATA', payload: null }, '*');
        return;
      }

      const lang = (document.documentElement.lang || navigator.language || 'en').slice(0, 2);
      const track = tracks.find((t) => t.kind !== 'asr' && t.languageCode?.startsWith(lang))
        || tracks.find((t) => t.languageCode?.startsWith(lang))
        || tracks.find((t) => t.kind === 'asr')
        || tracks[0];

      window.postMessage({
        source: 'YTAITUTOR_PAGE',
        type: 'TRANSCRIPT_DATA',
        payload: {
          url: track.baseUrl,
          language: track.languageCode,
          name: track.name?.simpleText || track.languageCode,
          trackCount: tracks.length
        }
      }, '*');
    } catch {
      window.postMessage({ source: 'YTAITUTOR_PAGE', type: 'TRANSCRIPT_DATA', payload: null }, '*');
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.source !== 'YTAITUTOR_CONTENT') {
      return;
    }
    if (event.data.type === 'REQUEST_TRANSCRIPT') {
      extractTranscript();
    }
  });

  // Helper functions exposed in window for MAIN world scripting
  window.__YTAITUTOR_GET_FRESH_CAPTION_TRACKS__ = function getFreshCaptionTracks() {
    try {
      const ytData = getPlayerResponse();
      return (ytData?.captions?.captionTracks || []).map((track) => ({
        baseUrl: track.baseUrl,
        languageCode: track.languageCode,
        kind: track.kind,
        name: track.name?.simpleText || track.languageCode
      }));
    } catch (err) {
      console.error('[YTAITutor] Error in getFreshCaptionTracks:', err);
      return [];
    }
  };

  window.__YTAITUTOR_SCRAPE_TRANSCRIPT_PANEL__ = async function scrapeTranscriptPanel() {
    try {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      let transcriptButton = document.querySelector(
        'button[aria-label="Show transcript"], button[aria-label="Afficher la transcription"]'
      );
      if (!transcriptButton) {
        const buttons = Array.from(document.querySelectorAll('button, ytd-button-renderer'));
        transcriptButton = buttons.find((button) => {
          const txt = button.textContent?.toLowerCase() || '';
          return txt.includes('transcript') || txt.includes('transcription') || txt.includes('sous-titres');
        });
      }

      const panelVisible = document.querySelector('ytd-transcript-renderer, ytd-transcript-search-panel-renderer');
      if (transcriptButton && !panelVisible) {
        transcriptButton.click();
        await sleep(1500);
      }

      const scrollContainer = document.querySelector(
        'ytd-transcript-renderer #body, ytd-transcript-segment-list-renderer, #segments-container'
      );
      if (scrollContainer) {
        let lastHeight = 0;
        for (let i = 0; i < 30; i += 1) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
          await sleep(250);
          if (scrollContainer.scrollHeight === lastHeight) {
            break;
          }
          lastHeight = scrollContainer.scrollHeight;
        }
      }

      let attempts = 0;
      let transcriptRows = [];
      while (attempts < 12) {
        transcriptRows = document.querySelectorAll(
          'ytd-transcript-segment-renderer, ytd-transcript-segment-list-renderer ytd-transcript-segment-renderer, .ytd-transcript-segment-renderer'
        );
        if (transcriptRows.length > 5) {
          break;
        }
        await sleep(200);
        attempts += 1;
      }

      const segments = [];
      transcriptRows.forEach((row) => {
        const timeEl = row.querySelector('.segment-timestamp, .ytp-time-segment, [class*="timestamp"]');
        const textEl = row.querySelector('.segment-text, yt-formatted-string.segment-text, yt-formatted-string');
        const timeText = timeEl?.textContent?.trim() || '0:00';
        const text = textEl?.textContent?.trim() || row.textContent?.trim() || '';
        if (!text) {
          return;
        }

        const parts = timeText.split(':').map(Number);
        let start = 0;
        if (parts.length === 3) {
          start = parts[0] * 3600 + parts[1] * 60 + parts[2];
        } else if (parts.length === 2) {
          start = parts[0] * 60 + parts[1];
        }

        segments.push({ start, duration: 2, text });
      });

      if (segments.length > 5) {
        return segments;
      }

      const captionNodes = document.querySelectorAll(
        '.ytp-caption-segment, .caption-window yt-formatted-string, .ytp-caption-window-container span'
      );
      const visibleText = Array.from(captionNodes)
        .map((node) => node.textContent?.trim())
        .filter(Boolean)
        .join(' ');

      if (visibleText) {
        const currentTime = document.querySelector('video')?.currentTime || 0;
        return [{ start: currentTime, duration: 5, text: visibleText }];
      }

      return null;
    } catch (err) {
      console.error('[YTAITutor] Error in scrapeTranscriptPanel:', err);
      return null;
    }
  };

  if (getPlayerResponse()) {
    extractTranscript();
  } else {
    const check = setInterval(() => {
      if (getPlayerResponse()) {
        clearInterval(check);
        extractTranscript();
      }
    }, 400);
    setTimeout(() => clearInterval(check), 20000);
  }
})();
