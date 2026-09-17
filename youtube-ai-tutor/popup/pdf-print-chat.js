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
      const roleLabel = msg.role === 'user' ? 'You' : 'AI Tutor';
      html += `
        <div class="msg ${msg.role}">
          <div class="msg-label">${roleLabel}</div>
          <div class="msg-bubble" id="msg-${idx}"></div>
        </div>
      `;
    });

    html += `</div></div>`;
    document.getElementById('print-content').innerHTML = html;

    // Render markdown + math in each bubble
    messages.forEach((msg, idx) => {
      const el = document.getElementById(`msg-${idx}`);
      if (!el) return;
      if (typeof renderMessageContent === 'function') {
        renderMessageContent(el, msg.text);
      } else {
        el.textContent = msg.text;
      }
    });

    // Wait for any images, then print
    setTimeout(() => window.print(), 400);
  } catch (err) {
    document.getElementById('print-content').textContent = 'Error: ' + err.message;
  }
});

window.onafterprint = function () {
  chrome.storage.local.remove('temp_print_chat');
  window.close();
};

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
