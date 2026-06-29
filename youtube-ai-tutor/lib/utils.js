/**
 * @file Shared utilities for YouTube AI Tutor extension.
 */

/**
 * Generates a UUID v4-compatible string.
 * @returns {string} UUID format xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
 */
function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Debounces a function.
 * @param {Function} func - Function to debounce
 * @param {number} wait - Delay in milliseconds
 * @returns {Function} Debounced function
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Waits until a DOM element appears.
 * @param {string} selector - CSS selector
 * @param {number} timeoutMs - Maximum wait time
 * @returns {Promise<Element>}
 */
function waitForElement(selector, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(selector);
    if (existing) {
      resolve(existing);
      return;
    }

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timeout waiting for ${selector}`));
    }, timeoutMs);
  });
}

/**
 * Extracts a JSON object from text that may include markdown fences.
 * @param {string} text - Raw text from AI response
 * @returns {object|null}
 */
function extractJSON(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }

  const markdownMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (markdownMatch) {
    try {
      return JSON.parse(markdownMatch[1]);
    } catch {
      /* continue */
    }
  }

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(text.substring(start, end + 1));
    } catch {
      /* continue */
    }
  }

  return null;
}

/**
 * Tries to extract the answer text from a possibly truncated or malformed JSON.
 * @param {string} text 
 * @returns {object|null}
 */
function extractAnswerFromPossiblyTruncatedJSON(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }

  // Look for the "answer" field key
  const answerKeyIndex = text.indexOf('"answer"');
  if (answerKeyIndex === -1) {
    return null;
  }

  // Find the colon after "answer"
  const colonIndex = text.indexOf(':', answerKeyIndex);
  if (colonIndex === -1) {
    return null;
  }

  // Find the starting quote of the string value
  const startQuoteIndex = text.indexOf('"', colonIndex);
  if (startQuoteIndex === -1) {
    return null;
  }

  // Extract the string content to the end or matching unescaped double quote
  let content = '';
  let escaped = false;

  for (let i = startQuoteIndex + 1; i < text.length; i++) {
    const char = text[i];
    if (escaped) {
      if (char === 'n') content += '\n';
      else if (char === 't') content += '\t';
      else if (char === 'r') content += '\r';
      else if (char === 'f') content += '\f';
      else if (char === 'b') content += '\b';
      else content += char;
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (char === '"') {
      break;
    } else {
      content += char;
    }
  }

  return {
    answer: content,
    needs_overlay: false,
    overlay_elements: []
  };
}

/**
 * Converts a data URL to a Blob.
 * @param {string} dataUrl - Base64 data URL
 * @returns {Blob}
 */
function dataURLToBlob(dataUrl) {
  const arr = dataUrl.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  const u8arr = new Uint8Array(bstr.length);
  for (let i = 0; i < bstr.length; i++) {
    u8arr[i] = bstr.charCodeAt(i);
  }
  return new Blob([u8arr], { type: mime });
}

/**
 * Formats seconds as M:SS.
 * @param {number} seconds
 * @returns {string}
 */
function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Escapes HTML for safe text insertion.
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
