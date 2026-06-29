/**
 * @file Transparent overlay canvas for AI visual responses on the video player.
 */

/**
 * Renders overlay elements on top of the YouTube player.
 */
class VideoOverlay {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.player = null;
    this.elements = [];
    this.fadeTimeout = null;
    this.resizeHandler = null;
  }

  /**
   * Sets the player container and injects the overlay canvas.
   * @param {HTMLElement} player
   */
  setPlayer(player) {
    if (!player || this.player === player) {
      return;
    }
    this.player = player;
    this.injectCanvas();
  }

  /**
   * Injects or re-injects the overlay canvas into the player.
   */
  injectCanvas() {
    const old = document.getElementById('yt-ai-tutor-overlay');
    if (old) {
      old.remove();
    }

    this.canvas = document.createElement('canvas');
    this.canvas.id = 'yt-ai-tutor-overlay';
    this.canvas.style.cssText = `
      position: absolute;
      top: 0; left: 0;
      width: 100%; height: 100%;
      pointer-events: none;
      z-index: 9999;
    `;

    this.player.style.position = 'relative';
    this.player.appendChild(this.canvas);

    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
    }
    this.resizeHandler = debounce(() => this.resize(), 200);
    window.addEventListener('resize', this.resizeHandler);

    document.addEventListener('fullscreenchange', () => {
      setTimeout(() => {
        this.player = document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
        if (this.player) {
          this.injectCanvas();
        }
      }, 500);
    });

    this.resize();
  }

  /**
   * Resizes the canvas to match the player dimensions.
   */
  resize() {
    if (!this.canvas || !this.player) {
      return;
    }

    const rect = this.player.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;

    const ctx = this.canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    this.ctx = ctx;
    this.render();
  }

  /**
   * Sets overlay elements and renders them.
   * @param {object[]} elements
   */
  setElements(elements) {
    this.elements = elements || [];
    this.render();

    if (this.fadeTimeout) {
      clearTimeout(this.fadeTimeout);
    }
    this.fadeTimeout = setTimeout(() => this.clear(), 8000);
  }

  /**
   * Clears and redraws all overlay elements.
   */
  render() {
    if (!this.ctx || !this.canvas) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const width = this.canvas.width / dpr;
    const height = this.canvas.height / dpr;
    this.ctx.clearRect(0, 0, width, height);

    for (const el of this.elements) {
      this.renderElement(el, width, height);
    }
  }

  /**
   * Renders a single overlay element.
   * @param {object} el
   * @param {number} width
   * @param {number} height
   */
  renderElement(el, width, height) {
    const ctx = this.ctx;
    ctx.save();

    switch (el.type) {
      case 'arrow': {
        const fromX = el.from[0] * width;
        const fromY = el.from[1] * height;
        const toX = el.to[0] * width;
        const toY = el.to[1] * height;
        const color = el.color || '#FF4444';

        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(toX, toY);
        ctx.strokeStyle = color;
        ctx.lineWidth = 4;
        ctx.stroke();

        const angle = Math.atan2(toY - fromY, toX - fromX);
        const headLen = 15;
        ctx.beginPath();
        ctx.moveTo(toX, toY);
        ctx.lineTo(toX - headLen * Math.cos(angle - Math.PI / 6), toY - headLen * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(toX - headLen * Math.cos(angle + Math.PI / 6), toY - headLen * Math.sin(angle + Math.PI / 6));
        ctx.fillStyle = color;
        ctx.fill();
        break;
      }

      case 'circle': {
        const cx = el.center[0] * width;
        const cy = el.center[1] * height;
        const radius = el.radius * width;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
        ctx.strokeStyle = el.color || '#00FF00';
        ctx.lineWidth = 3;
        ctx.stroke();
        break;
      }

      case 'text': {
        const tx = el.position[0] * width;
        const ty = el.position[1] * height;
        const text = el.content || '';
        ctx.font = 'bold 16px Arial, sans-serif';
        const metrics = ctx.measureText(text);
        const padding = 6;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(tx - padding, ty - 20, metrics.width + padding * 2, 24);

        ctx.fillStyle = el.color || '#FFFFFF';
        ctx.fillText(text, tx, ty);
        break;
      }

      case 'highlight': {
        ctx.fillStyle = el.color || 'rgba(255, 255, 0, 0.3)';
        ctx.fillRect(el.rect[0] * width, el.rect[1] * height, el.rect[2] * width, el.rect[3] * height);
        break;
      }

      case 'badge': {
        const bx = el.position[0] * width;
        const by = el.position[1] * height;
        ctx.beginPath();
        ctx.arc(bx, by, 15, 0, 2 * Math.PI);
        ctx.fillStyle = el.color || '#FF4444';
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(el.number || 1), bx, by);
        break;
      }

      default:
        break;
    }

    ctx.restore();
  }

  /**
   * Clears all overlay elements.
   */
  clear() {
    this.elements = [];
    if (this.ctx && this.canvas) {
      const dpr = window.devicePixelRatio || 1;
      const width = this.canvas.width / dpr;
      const height = this.canvas.height / dpr;
      this.ctx.clearRect(0, 0, width, height);
    }
  }
}
