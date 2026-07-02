document.addEventListener('DOMContentLoaded', async () => {
  try {
    const data = await chrome.storage.local.get('temp_print_notebook');
    const payload = data.temp_print_notebook;
    if (!payload) {
      document.getElementById('print-content').textContent = 'Error: Data not found.';
      return;
    }

    const { notebook, entries } = payload;
    document.title = notebook.title;

    let html = `
      <div class="container">
        <div class="header">
          <div class="header-title-area">
            <h1>${notebook.title}</h1>
            <div class="desc">${notebook.description || "Personal Study Notebook"}</div>
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
          <div class="chat-a-label">Answer</div>
          <div class="chat-a" id="ans-${idx}"></div>
        `;
      }

      if (entry.imageDataUrl) {
        html += `<div class="img-container"><img class="capture-img" src="${entry.imageDataUrl}" alt="Visual Frame" /></div>`;
      }
      
      html += `</div>`;
    });

    html += `
        </div>
      </div>
    `;

    document.getElementById('print-content').innerHTML = html;

    entries.forEach((entry, idx) => {
      if (entry.type !== 'note') {
        const el = document.getElementById('ans-' + idx);
        if (el && entry.answer) {
          renderMessageContent(el, entry.answer);
        }
      }
    });

    const images = Array.from(document.querySelectorAll('.capture-img'));
    if (images.length === 0) {
      window.print();
      return;
    }
    
    let loadedCount = 0;
    function checkAllLoaded() {
      loadedCount++;
      if (loadedCount === images.length) {
        setTimeout(() => {
          window.print();
        }, 500);
      }
    }

    images.forEach(img => {
      if (img.complete) {
        checkAllLoaded();
      } else {
        img.onload = checkAllLoaded;
        img.onerror = checkAllLoaded;
      }
    });
  } catch (err) {
    document.getElementById('print-content').textContent = 'Error loading: ' + err.message;
  }
});

window.onafterprint = function() {
  chrome.storage.local.remove('temp_print_notebook');
  window.close();
};
