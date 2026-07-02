/**
 * @file Markdown + LaTeX rendering for chat messages (KaTeX auto-render).
 */

(function (global) {
  'use strict';

  const MATH_PLACEHOLDER = '\x00MATH';
  const CODE_PLACEHOLDER = '\x00CODE';

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function protectCodeBlocks(text) {
    const blocks = [];
    const protectedText = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
      const id = blocks.length;
      blocks.push({ lang, code });
      return `${CODE_PLACEHOLDER}${id}${CODE_PLACEHOLDER}`;
    });
    return { text: protectedText, blocks };
  }

  function protectMath(text) {
    const segments = [];
    let protectedText = text;

    protectedText = protectedText.replace(/\$\$([\s\S]+?)\$\$/g, (match) => {
      const id = segments.length;
      segments.push(match);
      return `${MATH_PLACEHOLDER}${id}${MATH_PLACEHOLDER}`;
    });

    protectedText = protectedText.replace(/\\\[([\s\S]+?)\\\]/g, (match) => {
      const id = segments.length;
      segments.push(match);
      return `${MATH_PLACEHOLDER}${id}${MATH_PLACEHOLDER}`;
    });

    protectedText = protectedText.replace(/\\\(([\s\S]+?)\\\)/g, (match) => {
      const id = segments.length;
      segments.push(match);
      return `${MATH_PLACEHOLDER}${id}${MATH_PLACEHOLDER}`;
    });

    protectedText = protectedText.replace(/(^|[^\\$])\$([^\$\n]+?)\$/g, (match, prefix, content) => {
      const id = segments.length;
      segments.push(`$${content}$`);
      return `${prefix}${MATH_PLACEHOLDER}${id}${MATH_PLACEHOLDER}`;
    });

    return { text: protectedText, segments };
  }

  function restorePlaceholders(text, segments) {
    return text.replace(new RegExp(`${MATH_PLACEHOLDER}(\\d+)${MATH_PLACEHOLDER}`, 'g'), (_match, id) => {
      return segments[Number(id)] || '';
    });
  }

  function restoreCodeBlocks(html, blocks) {
    return html.replace(new RegExp(`${CODE_PLACEHOLDER}(\\d+)${CODE_PLACEHOLDER}`, 'g'), (_match, id) => {
      const block = blocks[Number(id)];
      if (!block) {
        return '';
      }
      const langClass = block.lang ? ` class="language-${block.lang}"` : '';
      return `<pre class="code-block"><code${langClass}>${escapeHtml(block.code.trimEnd())}</code></pre>`;
    });
  }

  function formatInlineMarkdown(text, segments) {
    let html = escapeHtml(text);
    html = html.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return restorePlaceholders(html, segments);
  }

  function isStandalonePlaceholder(line, placeholder) {
    const trimmed = line.trim();
    return new RegExp(`^${placeholder}\\d+${placeholder}$`).test(trimmed);
  }

  function formatMessageMarkdown(text) {
    if (!text) {
      return '';
    }

    const { text: withoutCode, blocks } = protectCodeBlocks(text);
    const { text: withoutMath, segments } = protectMath(withoutCode);
    const lines = withoutMath.split('\n');

    const output = [];
    let paragraph = [];
    let listItems = [];
    let listType = null;
    let quoteLines = [];

    function flushParagraph() {
      if (!paragraph.length) {
        return;
      }
      const content = formatInlineMarkdown(paragraph.join('\n'), segments);
      output.push(`<p>${content.replace(/\n/g, '<br>')}</p>`);
      paragraph = [];
    }

    function flushList() {
      if (!listItems.length) {
        return;
      }
      const tag = listType === 'ol' ? 'ol' : 'ul';
      const items = listItems.map((item) =>
        `<li>${formatInlineMarkdown(item, segments)}</li>`
      ).join('');
      output.push(`<${tag} class="md-list">${items}</${tag}>`);
      listItems = [];
      listType = null;
    }

    function flushQuote() {
      if (!quoteLines.length) {
        return;
      }
      const content = formatInlineMarkdown(quoteLines.join('\n'), segments);
      output.push(`<blockquote class="md-quote">${content.replace(/\n/g, '<br>')}</blockquote>`);
      quoteLines = [];
    }

    function flushAll() {
      flushParagraph();
      flushList();
      flushQuote();
    }

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();

      if (!trimmed) {
        flushAll();
        continue;
      }

      if (isStandalonePlaceholder(trimmed, CODE_PLACEHOLDER)) {
        flushAll();
        output.push(trimmed);
        continue;
      }

      if (isStandalonePlaceholder(trimmed, MATH_PLACEHOLDER)) {
        flushAll();
        output.push(`<div class="md-math-block">${trimmed}</div>`);
        continue;
      }

      const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
      if (headingMatch) {
        flushAll();
        const level = headingMatch[1].length;
        const content = formatInlineMarkdown(headingMatch[2], segments);
        output.push(`<h${level + 2} class="md-h${level}">${content}</h${level + 2}>`);
        continue;
      }

      if (/^[-*•]\s+/.test(trimmed)) {
        flushParagraph();
        flushQuote();
        if (listType === 'ol') {
          flushList();
        }
        listType = 'ul';
        listItems.push(trimmed.replace(/^[-*•]\s+/, ''));
        continue;
      }

      const orderedMatch = trimmed.match(/^\d+[.)]\s+(.+)$/);
      if (orderedMatch) {
        flushParagraph();
        flushQuote();
        if (listType === 'ul') {
          flushList();
        }
        listType = 'ol';
        listItems.push(orderedMatch[1]);
        continue;
      }

      if (trimmed.startsWith('> ')) {
        flushParagraph();
        flushList();
        quoteLines.push(trimmed.slice(2));
        continue;
      }

      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        flushAll();
        output.push('<hr class="md-hr">');
        continue;
      }

      flushList();
      flushQuote();
      paragraph.push(trimmed);
    }

    flushAll();
    return restoreCodeBlocks(output.join(''), blocks);
  }

  function renderMathIn(node) {
    if (!node || typeof renderMathInElement !== 'function') {
      return;
    }
    renderMathInElement(node, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '\\[', right: '\\]', display: true },
        { left: '\\(', right: '\\)', display: false },
        { left: '$', right: '$', display: false }
      ],
      throwOnError: false,
      errorColor: '#f87171'
    });
  }

  function renderMessageContent(element, text, options = {}) {
    if (!element || text == null) {
      return;
    }

    element.classList.add('rich-content', 'message-content');

    if (options.plainText) {
      element.textContent = text;
      return;
    }

    element.innerHTML = formatMessageMarkdown(text);
    renderMathIn(element);
  }

  global.formatMessageMarkdown = formatMessageMarkdown;
  global.renderMessageContent = renderMessageContent;
  global.renderMathInElementContent = renderMathIn;
})(typeof window !== 'undefined' ? window : self);
