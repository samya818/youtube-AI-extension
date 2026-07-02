/**
 * @file Canvas annotation editor with rectangle, arrow, circle, pencil, and text tools.
 */

/**
 * Manages drawing annotations on a captured video frame.
 */
class AnnotationEditor {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.tool = 'rectangle';
    this.isDrawing = false;
    this.startPos = null;
    this.currentStroke = [];
    /** @type {Array<{type: string, start: {x: number, y: number}, end?: {x: number, y: number}, points?: Array<{x: number, y: number}>, text?: string}>} */
    this.annotations = [];
    this.currentImage = null;
    this.textInput = null;
    this.textStyle = { color: '#FFFFFF', size: 16 };

    this.bindEvents();
  }

  /**
   * Binds mouse events on the canvas.
   */
  bindEvents() {
    this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
    this.canvas.addEventListener('mouseleave', () => {
      this.isDrawing = false;
      this.currentStroke = [];
    });
  }

  /**
   * Sets the active drawing tool.
   * @param {string} tool
   */
  setTool(tool) {
    this.tool = tool;
  }

  /**
   * Updates the active text styling.
   * @param {{color?: string, size?: number}} style
   */
  setTextStyle(style) {
    this.textStyle = { ...this.textStyle, ...style };
  }

  /**
   * Loads an image onto the canvas for editing.
   * @param {string} dataUrl
   * @param {Array<object>} [initialAnnotations=[]]
   */
  loadImage(dataUrl, initialAnnotations = []) {
    const img = new Image();
    img.onload = () => {
      try {
        const dpr = window.devicePixelRatio || 1;
        const displayWidth = img.width;
        const displayHeight = img.height;

        const maxDisplayWidth = 800;
        let scale = 1;
        if (displayWidth > maxDisplayWidth) {
          scale = maxDisplayWidth / displayWidth;
        }

        this.canvas.width = displayWidth * scale * dpr;
        this.canvas.height = displayHeight * scale * dpr;
        this.canvas.style.width = `${displayWidth * scale}px`;
        this.canvas.style.height = `${displayHeight * scale}px`;

        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.scale(scale * dpr, scale * dpr);
        this.ctx.drawImage(img, 0, 0, displayWidth, displayHeight);

        this.currentImage = { img, displayWidth, displayHeight, scale, dpr };
        this.annotations = (initialAnnotations || []).map((ann) => this.cloneAnnotation(ann));
        this.redraw();
      } catch (err) {
        console.error('[YTAITutor] Erreur chargement image éditeur:', err);
      }
    };
    img.onerror = () => {
      console.error('[YTAITutor] Impossible de charger l\'image dans l\'éditeur');
    };
    img.src = dataUrl;
  }

  /**
   * Clones a persisted annotation object.
   * @param {object} ann
   * @returns {object}
   */
  cloneAnnotation(ann) {
    return JSON.parse(JSON.stringify(ann));
  }

  /**
   * Sets the annotations for the current frame.
   * @param {Array<object>} annotations
   */
  setAnnotations(annotations) {
    this.annotations = (annotations || []).map((ann) => this.cloneAnnotation(ann));
    this.redraw();
  }

  /**
   * Returns the annotations for the current frame.
   * @returns {Array<object>}
   */
  getAnnotations() {
    return this.annotations.map((ann) => this.cloneAnnotation(ann));
  }

  /**
   * Converts a mouse event to image coordinates.
   * @param {MouseEvent} e
   * @returns {{x: number, y: number}}
   */
  getMousePos(e) {
    const rect = this.canvas.getBoundingClientRect();
    const ratioX = (this.currentImage?.displayWidth || rect.width) / rect.width;
    const ratioY = (this.currentImage?.displayHeight || rect.height) / rect.height;
    return {
      x: (e.clientX - rect.left) * ratioX,
      y: (e.clientY - rect.top) * ratioY
    };
  }

  /**
   * @param {MouseEvent} e
   */
  handleMouseDown(e) {
    e.preventDefault();
    e.stopPropagation();

    if (this.tool === 'text') {
      this.handleTextClick(e);
      return;
    }
    this.isDrawing = true;
    this.startPos = this.getMousePos(e);
    this.currentStroke = this.tool === 'pencil' ? [{ ...this.startPos }] : [];
  }

  /**
   * @param {MouseEvent} e
   */
  handleMouseMove(e) {
    if (!this.isDrawing || !this.startPos || !this.currentImage) {
      return;
    }
    e.preventDefault();
    const currentPos = this.getMousePos(e);
    if (this.tool === 'pencil') {
      this.currentStroke.push({ ...currentPos });
      this.redraw();
      this.drawPreview(this.tool, this.currentStroke);
      return;
    }

    this.redraw();
    this.drawPreview(this.tool, this.startPos, currentPos);
  }

  /**
   * @param {MouseEvent} e
   */
  handleMouseUp(e) {
    if (!this.isDrawing || !this.startPos) {
      return;
    }
    e.preventDefault();
    const endPos = this.getMousePos(e);

    if (this.tool === 'pencil') {
      const points = this.currentStroke.length > 1 ? this.currentStroke : [{ ...this.startPos }, { ...endPos }];
      this.annotations.push({ type: 'pencil', points });
    } else if (this.tool === 'rectangle') {
      this.annotations.push({ type: 'rectangle', start: { ...this.startPos }, end: { ...endPos } });
    } else if (this.tool === 'arrow') {
      this.annotations.push({ type: 'arrow', start: { ...this.startPos }, end: { ...endPos } });
    } else if (this.tool === 'circle') {
      this.annotations.push({ type: 'circle', start: { ...this.startPos }, end: { ...endPos } });
    }

    this.isDrawing = false;
    this.startPos = null;
    this.currentStroke = [];
    this.redraw();
  }

  /**
   * @param {MouseEvent} e
   */
  handleTextClick(e) {
    e.preventDefault();
    e.stopPropagation();

    const pos = this.getMousePos(e);

    if (this.textInput) {
      this.textInput.remove();
      this.textInput = null;
    }

    const input = document.createElement('input');
    input.type = 'text';
    input.style.cssText = `
      position: fixed; left: ${e.clientX}px; top: ${e.clientY}px;
      background: rgba(0,0,0,0.8); color: ${this.textStyle.color}; border: 1px solid #4285f4;
      padding: 4px 8px; font-size: ${this.textStyle.size}px; z-index: 100001; border-radius: 4px;
      min-width: 140px; font-family: Arial, sans-serif;
    `;
    input.placeholder = 'Text...';

    const saveText = () => {
      const value = input.value.trim();
      if (value) {
        this.annotations.push({ type: 'text', start: pos, text: value, color: this.textStyle.color, size: this.textStyle.size });
        this.redraw();
      }
      input.remove();
      this.textInput = null;
    };

    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        saveText();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        input.remove();
        this.textInput = null;
      }
    });

    input.addEventListener('blur', () => {
      saveText();
    });

    document.body.appendChild(input);
    input.focus();
    this.textInput = input;
  }

  /**
   * Redraws the base image and all annotations.
   */
  redraw() {
    if (!this.currentImage) {
      return;
    }
    const { img, displayWidth, displayHeight } = this.currentImage;
    this.ctx.clearRect(0, 0, displayWidth, displayHeight);
    this.ctx.drawImage(img, 0, 0, displayWidth, displayHeight);

    for (const ann of this.annotations) {
      this.drawAnnotation(ann);
    }
  }

  /**
   * Draws a preview while dragging.
   * @param {string} tool
   * @param {{x: number, y: number}|Array<{x: number, y: number}>} start
   * @param {{x: number, y: number}} [end]
   */
  drawPreview(tool, start, end) {
    if (tool === 'rectangle') {
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
      this.ctx.fillRect(0, 0, this.currentImage.displayWidth, this.currentImage.displayHeight);
      const x = Math.min(start.x, end.x);
      const y = Math.min(start.y, end.y);
      const w = Math.abs(end.x - start.x);
      const h = Math.abs(end.y - start.y);
      this.ctx.clearRect(x, y, w, h);
      this.ctx.strokeStyle = '#4285f4';
      this.ctx.lineWidth = 2;
      this.ctx.strokeRect(x, y, w, h);
    } else if (tool === 'arrow') {
      this.drawArrow(start.x, start.y, end.x, end.y, '#FF4444', 4);
    } else if (tool === 'circle') {
      const radius = Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2);
      this.ctx.beginPath();
      this.ctx.arc(start.x, start.y, radius, 0, 2 * Math.PI);
      this.ctx.strokeStyle = '#00FF00';
      this.ctx.lineWidth = 3;
      this.ctx.stroke();
    } else if (tool === 'pencil') {
      this.drawPencil(start);
    }
  }

  /**
   * @param {object} ann
   */
  drawAnnotation(ann) {
    this.drawAnnotationOnContext(this.ctx, ann);
  }

  /**
   * Draws an annotation on any canvas context.
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} ann
   */
  drawAnnotationOnContext(ctx, ann) {
    if (ann.type === 'rectangle') {
      const x = Math.min(ann.start.x, ann.end.x);
      const y = Math.min(ann.start.y, ann.end.y);
      const w = Math.abs(ann.end.x - ann.start.x);
      const h = Math.abs(ann.end.y - ann.start.y);
      ctx.strokeStyle = '#4285f4';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
    } else if (ann.type === 'arrow') {
      this.drawArrowOnContext(ctx, ann.start.x, ann.start.y, ann.end.x, ann.end.y, '#FF4444', 4);
    } else if (ann.type === 'circle') {
      const radius = Math.sqrt((ann.end.x - ann.start.x) ** 2 + (ann.end.y - ann.start.y) ** 2);
      ctx.beginPath();
      ctx.arc(ann.start.x, ann.start.y, radius, 0, 2 * Math.PI);
      ctx.strokeStyle = '#00FF00';
      ctx.lineWidth = 3;
      ctx.stroke();
    } else if (ann.type === 'pencil') {
      this.drawPencilOnContext(ctx, ann.points || []);
    } else if (ann.type === 'text') {
      const size = ann.size || this.textStyle.size;
      const color = ann.color || this.textStyle.color;
      ctx.font = `bold ${size}px Arial, sans-serif`;
      const metrics = ctx.measureText(ann.text);
      const boxHeight = size + 6;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(ann.start.x - 4, ann.start.y - size, metrics.width + 8, boxHeight);
      ctx.fillStyle = color;
      ctx.fillText(ann.text, ann.start.x, ann.start.y);
    }
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {Array<{x: number, y: number}>} points
   */
  drawPencilOnContext(ctx, points) {
    if (!points?.length) {
      return;
    }
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    points.slice(1).forEach((point) => {
      ctx.lineTo(point.x, point.y);
    });
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  /**
   * @param {Array<{x: number, y: number}>} points
   */
  drawPencil(points) {
    this.drawPencilOnContext(this.ctx, points);
  }

  /**
   * @param {number} fromX
   * @param {number} fromY
   * @param {number} toX
   * @param {number} toY
   * @param {string} color
   * @param {number} width
   */
  drawArrow(fromX, fromY, toX, toY, color, width) {
    this.drawArrowOnContext(this.ctx, fromX, fromY, toX, toY, color, width);
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} fromX
   * @param {number} fromY
   * @param {number} toX
   * @param {number} toY
   * @param {string} color
   * @param {number} width
   */
  drawArrowOnContext(ctx, fromX, fromY, toX, toY, color, width) {
    const headlen = 15;
    const angle = Math.atan2(toY - fromY, toX - fromX);

    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(
      toX - headlen * Math.cos(angle - Math.PI / 6),
      toY - headlen * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      toX - headlen * Math.cos(angle + Math.PI / 6),
      toY - headlen * Math.sin(angle + Math.PI / 6)
    );
    ctx.fillStyle = color;
    ctx.fill();
  }

  /**
   * Exports the canvas with annotations burned in.
   * @returns {string} JPEG data URL
   */
  burnIn() {
    this.redraw();
    return this.canvas.toDataURL('image/jpeg', 0.85);
  }

  /**
   * Returns the rectangle region in image coordinates, if any.
   * @returns {{x: number, y: number, width: number, height: number}|null}
   */
  getCropRegion() {
    const rect = this.annotations.find((a) => a.type === 'rectangle');
    if (!rect?.end) {
      return null;
    }
    return {
      x: Math.min(rect.start.x, rect.end.x),
      y: Math.min(rect.start.y, rect.end.y),
      width: Math.abs(rect.end.x - rect.start.x),
      height: Math.abs(rect.end.y - rect.start.y)
    };
  }

  /**
   * Clears all annotations.
   */
  clear() {
    this.annotations = [];
    this.redraw();
  }
}
