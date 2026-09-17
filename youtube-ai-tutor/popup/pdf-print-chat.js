/**
 * @file Script for pdf-print-chat.html — reads serialized chat from
 * chrome.storage.local ('temp_print_chat'), renders it, then calls window.print().
 */
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const data = await chrome.storage.local.get('temp_print_chat');
    const payload = data.temp_print_chat;
    if (!payload || !payload.messages) {
      document.getElementById('print-content').textContent = 'Error: no chat data found.';
      return;
    }

    const { messages, videoTitle, exportedAt } = payload;
    document.title = videoTitle ? `Chat — ${videoTitle}` : 'Chat Export';

    const msgCount = messages.length;
    let html = `
      <div class="container">
        <div class="chat-header">
          <div>
            <h1>${videoTitle ? escHtml(videoTitle) : 'AI Tutor Chat'}</h1>
            <p class="subtitle">${msgCount} message${msgCount !== 1 ? 's' : ''}</p>
          </div>
          <div class="meta">
            Exported on ${new Date(exportedAt).toLocaleString()}<br>
            youtube-ai-tutor
          </div>
        </div>
        <div class="messages-list">
    `;

    messages.forEach((msg, idx) => {
      if (msg.role === 'image') {
        html += `
          <div class="msg image">
            <div class="msg-label">📷 Reference Image (Revision)</div>
            <div class="msg-bubble">
              ${msg.text ? `<div class="chat-print-caption">${escHtml(msg.text)}</div>` : ''}
              ${msg.imageDataUrl ? `<img src="${msg.imageDataUrl}" class="chat-print-img" alt="Reference Image" />` : ''}
            </div>
          </div>
        `;
      } else {
        const roleLabel = msg.role === 'user' ? 'You' : 'AI Tutor';
        html += `
          <div class="msg ${msg.role}">
            <div class="msg-label">${roleLabel}</div>
            <div class="msg-bubble" id="msg-${idx}"></div>
            ${msg.imageDataUrl ? `<img src="${msg.imageDataUrl}" class="chat-print-img" alt="Attached capture" />` : ''}
          </div>
        `;
      }
    });

    html += `</div></div>`;
    document.getElementById('print-content').innerHTML = html;

    // Render markdown + math in each bubble
    messages.forEach((msg, idx) => {
      if (msg.role === 'image') return;
      const el = document.getElementById(`msg-${idx}`);
      if (!el) return;
      if (typeof renderMessageContent === 'function') {
        renderMessageContent(el, msg.text);
      } else {
        el.textContent = msg.text;
      }
    });

    // Hook up manual toolbar buttons
    document.getElementById('manual-print-btn')?.addEventListener('click', () => {
      window.print();
    });
    document.getElementById('close-tab-btn')?.addEventListener('click', () => {
      window.close();
    });

    // Wait for all images to decode/load before triggering window.print()
    const allImgs = Array.from(document.querySelectorAll('img'));
    let loadedCount = 0;
    let printed = false;
    const doPrint = () => {
      if (printed) return;
      printed = true;
      setTimeout(() => window.print(), 350);
    };

    if (allImgs.length === 0) {
      doPrint();
    } else {
      allImgs.forEach((img) => {
        if (img.complete) {
          loadedCount++;
          if (loadedCount === allImgs.length) doPrint();
        } else {
          img.onload = img.onerror = () => {
            loadedCount++;
            if (loadedCount === allImgs.length) doPrint();
          };
        }
      });
      // Safety fallback: if some image hangs, print anyway after 2s
      setTimeout(doPrint, 2000);
    }
  } catch (err) {
    document.getElementById('print-content').textContent = 'Error: ' + err.message;
  }
});

// Clean up temporary data on print finish without abruptly killing the tab
window.onafterprint = function () {
  chrome.storage.local.remove('temp_print_chat');
};

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
