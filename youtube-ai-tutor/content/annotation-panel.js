/**
 * @file Modal annotation panel for multi-frame capture review.
 */

/** @type {Record<string, { beforeSec: number, afterSec: number, preferFull: boolean, mode: string }>} */
const ANNOTATION_TRANSCRIPT_PRESETS = {
  economical: { beforeSec: 30, afterSec: 15, preferFull: false, mode: 'local' },
  standard: { beforeSec: 60, afterSec: 30, preferFull: false, mode: 'local' },
  complete: { beforeSec: 120, afterSec: 60, preferFull: true, mode: 'local' },
  global: { beforeSec: 60, afterSec: 30, preferFull: true, mode: 'global' },
  'global-local': { beforeSec: 60, afterSec: 30, preferFull: true, mode: 'global-local' }
};

/**
 * Full-screen panel to select a frame, annotate it, and submit to the tutor.
 */
class AnnotationPanel {
  setUiPreparing(force = false) {
    if (!this.panel || (!this.uiPreparing && !force)) {
      // still allow if panel exists
    }
    this.uiPreparing = true;
    this.uiReady = false;

    const statusTitle = this.statusTitle;
    const statusSubtitle = this.statusSubtitle;
    if (statusTitle) statusTitle.textContent = 'Preparing…';
    if (statusSubtitle) statusSubtitle.textContent = 'Captures + transcription';

    const spinner = this.statusSpinner;
    if (spinner) spinner.style.opacity = '0.95';

    // lock interactions that can confuse the user during async estimation
    const disabled = true;
    this.panel.querySelectorAll('button, input, select').forEach((el) => {
      if (!el) return;
      if (el.id === 'ytaitutor-close-panel') return;
      // Don't disable the text input focus while typing during final state; but during preparing it's ok.
      el.disabled = disabled;
    });
  }

  setUiReady() {
    this.uiPreparing = false;
    this.uiReady = true;

    const statusTitle = this.statusTitle;
    const statusSubtitle = this.statusSubtitle;
    if (statusTitle) {
      statusTitle.textContent = 'Ready';
      statusTitle.style.color = '#81c784';
    }
    if (statusSubtitle) statusSubtitle.textContent = 'You can annotate and submit';

    const spinner = this.statusSpinner;
    if (spinner) spinner.style.opacity = '0';

    // re-enable interactions
    this.panel?.querySelectorAll('button, input, select').forEach((el) => {
      if (!el) return;
      if (el.id === 'ytaitutor-close-panel') return;
      el.disabled = false;
    });

    // fade-out status bar
    if (this.statusBar) {
      this.statusBar.style.opacity = '0';
      setTimeout(() => {
        try {
          this.statusBar?.remove();
        } catch {
          /* ignore */
        }
      }, 350);
    }
  }

  /**
   * @param {Array<{label: string, dataUrl: string, time: number}>} frames
   * @param {string} videoId
   * @param {string} videoTitle
   * @param {number} currentTime
   * @param {object|null} transcriptData
   * @param {HTMLVideoElement|null} videoElement
   */
  constructor(frames, videoId, videoTitle, currentTime, transcriptData = null, videoElement = null, userDefaults = null) {
    this.frames = frames;
    this.videoId = videoId;
    this.videoTitle = videoTitle;
    this.currentTime = currentTime;
    this.transcriptData = transcriptData;
    this.videoElement = videoElement;
    this.selectedFrameIndex = 1;
    this.editor = null;
    this.panel = null;
    this.thumbElements = [];
    this.frameAnnotations = this.frames.map(() => []);

    // Apply user default preferences if configured
    this.frameSendMode = userDefaults?.defaultFrameMode || 't0-only';
    this.frameBeforeOffset = 6;
    this.frameAfterOffset = 6;

    const initialPriority = userDefaults?.defaultTranscriptContext || 'standard';
    this.transcriptPriority = initialPriority;
    const preset = ANNOTATION_TRANSCRIPT_PRESETS[initialPriority] || ANNOTATION_TRANSCRIPT_PRESETS.standard;
    this.beforeSec = preset.beforeSec;
    this.afterSec = preset.afterSec;
    this.transcriptPreferFull = preset.preferFull;
    this.transcriptMode = preset.mode || 'local';

    this.isRecapturing = false;
    this.previewDebounceTimer = null;

    this.build();
    this.setUiPreparing(true);
    this.updateTranscriptPreview().finally(() => {
      this.setUiPreparing(false);
      this.setUiReady();
      // Ensure text inputs etc. are usable after async update.
      try {
        this.editor?.redraw?.();
      } catch {
        /* ignore */
      }
    });
  }

  /**
   * Builds and injects the panel DOM.
   */
  build() {
    const overlay = document.createElement('div');

    // UI state helpers (setUiPreparing/setUiReady will mutate this.panel)
    this.uiPreparing = true;
    this.uiReady = false;

    overlay.id = 'ytaitutor-annotation-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.85);
      z-index: 100000; display: flex; align-items: center; justify-content: center;
      font-family: 'Segoe UI', system-ui, sans-serif;
    `;

    const container = document.createElement('div');
    container.style.cssText = `
      background: #1a1a1a; border-radius: 12px; width: 900px; max-width: 95vw;
      max-height: 95vh; display: flex; flex-direction: column;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    `;

    const header = document.createElement('div');
    header.style.cssText = 'padding: 16px 20px; border-bottom: 1px solid #333; display: flex; justify-content: space-between; align-items: center;';

    const title = document.createElement('div');
    title.style.cssText = 'color: #fff; font-size: 16px; font-weight: 600;';
    title.textContent = 'Annotate Frame';

    const closeBtn = document.createElement('button');
    closeBtn.id = 'ytaitutor-close-panel';
    closeBtn.textContent = '×';
    closeBtn.style.cssText = 'background: none; border: none; color: #888; font-size: 20px; cursor: pointer;';
    header.appendChild(title);
    header.appendChild(closeBtn);

    const framesRow = document.createElement('div');
    framesRow.id = 'ytaitutor-frames-row';
    framesRow.style.cssText = 'display: flex; gap: 12px; padding: 16px 20px; justify-content: center; flex-wrap: wrap;';

    this.renderFrameThumbnails(framesRow);

    const frameOffsetRow = document.createElement('div');
    frameOffsetRow.style.cssText = 'display: flex; gap: 16px; padding: 0 20px 12px; align-items: center; flex-wrap: wrap; color: #aaa; font-size: 12px;';

    const beforeFrameWrap = document.createElement('div');
    const beforeFrameSlider = document.createElement('input');
    beforeFrameSlider.type = 'range';
    beforeFrameSlider.id = 'ytaitutor-frame-before';
    beforeFrameSlider.min = '1';
    beforeFrameSlider.max = '60';
    beforeFrameSlider.value = '6';
    beforeFrameSlider.style.width = '70px';
    const beforeFrameVal = document.createElement('span');
    beforeFrameVal.id = 'frame-before-val';
    beforeFrameVal.textContent = '6';
    beforeFrameWrap.appendChild(document.createTextNode('Frames: T-'));
    beforeFrameWrap.appendChild(beforeFrameVal);
    beforeFrameWrap.appendChild(beforeFrameSlider);
    beforeFrameWrap.appendChild(document.createTextNode('s'));

    const afterFrameWrap = document.createElement('div');
    const afterFrameSlider = document.createElement('input');
    afterFrameSlider.type = 'range';
    afterFrameSlider.id = 'ytaitutor-frame-after';
    afterFrameSlider.min = '1';
    afterFrameSlider.max = '60';
    afterFrameSlider.value = '6';
    afterFrameSlider.style.width = '70px';
    const afterFrameVal = document.createElement('span');
    afterFrameVal.id = 'frame-after-val';
    afterFrameVal.textContent = '6';
    afterFrameWrap.appendChild(document.createTextNode('T+'));
    afterFrameWrap.appendChild(afterFrameVal);
    afterFrameWrap.appendChild(afterFrameSlider);
    afterFrameWrap.appendChild(document.createTextNode('s'));

    const recaptureBtn = document.createElement('button');
    recaptureBtn.id = 'ytaitutor-recapture-frames';
    recaptureBtn.textContent = '↻ Recapture 3 frames';
    recaptureBtn.style.cssText = 'padding: 6px 12px; background: #333; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 12px;';

    const frameSendWrap = document.createElement('div');
    frameSendWrap.style.cssText = 'display: flex; align-items: center; gap: 8px; color: #aaa; font-size: 12px;';
    const frameSendLabel = document.createElement('label');
    frameSendLabel.textContent = 'Send frames:';
    const frameSendSelect = document.createElement('select');
    frameSendSelect.id = 'ytaitutor-frame-send-mode';
    frameSendSelect.style.cssText = 'padding: 6px 8px; border-radius: 4px; background: #1a1a1a; color: #fff; border: 1px solid #444; font-size: 12px;';
    [
      ['contextual', 'T-X / T0 / T+X'],
      ['t0-only', 'Only T0 (default)'],
      ['none', 'Send no frames (0 images)']
    ].forEach(([value, label]) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      if (value === this.frameSendMode) {
        opt.selected = true;
      }
      frameSendSelect.appendChild(opt);
    });
    frameSendWrap.appendChild(frameSendLabel);
    frameSendWrap.appendChild(frameSendSelect);

    frameOffsetRow.appendChild(beforeFrameWrap);
    frameOffsetRow.appendChild(afterFrameWrap);
    frameOffsetRow.appendChild(recaptureBtn);
    frameOffsetRow.appendChild(frameSendWrap);

    const canvasContainer = document.createElement('div');
    canvasContainer.style.cssText = 'flex: 1; display: flex; justify-content: center; align-items: center; padding: 0 20px; min-height: 300px; background: #0f0f0f; overflow: auto;';

    // Zoom controls + state for the editor canvas
    const zoomWrap = document.createElement('div');
    zoomWrap.style.cssText = 'position: relative; display: flex; flex-direction: column; align-items: center; gap: 10px;';

    const zoomToolbar = document.createElement('div');
    zoomToolbar.style.cssText = 'display:flex; gap:8px; align-items:center;';

    const zoomOutBtn = document.createElement('button');
    zoomOutBtn.type = 'button';
    zoomOutBtn.textContent = '−';
    zoomOutBtn.style.cssText = 'padding: 6px 10px; background:#333; color:#fff; border:none; border-radius:6px; cursor:pointer;';

    const zoomInBtn = document.createElement('button');
    zoomInBtn.type = 'button';
    zoomInBtn.textContent = '+';
    zoomInBtn.style.cssText = 'padding: 6px 10px; background:#333; color:#fff; border:none; border-radius:6px; cursor:pointer;';

    const zoomResetBtn = document.createElement('button');
    zoomResetBtn.type = 'button';
    zoomResetBtn.textContent = 'Reset';
    zoomResetBtn.style.cssText = 'padding: 6px 10px; background:#444; color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:12px;';

    const zoomLabel = document.createElement('span');
    zoomLabel.id = 'ytaitutor-zoom-label';
    zoomLabel.textContent = '100%';
    zoomLabel.style.cssText = 'color:#aaa; font-size:12px; min-width:56px; text-align:center;';

    zoomToolbar.appendChild(zoomOutBtn);
    zoomToolbar.appendChild(zoomInBtn);
    zoomToolbar.appendChild(zoomResetBtn);
    zoomToolbar.appendChild(zoomLabel);

    const canvas = document.createElement('canvas');
    canvas.id = 'ytaitutor-annotation-canvas';
    canvas.style.cssText = 'border-radius: 8px; cursor: crosshair; max-width: 100%;';

    zoomWrap.appendChild(zoomToolbar);
    zoomWrap.appendChild(canvas);
    canvasContainer.appendChild(zoomWrap);




    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'display: flex; gap: 8px; padding: 12px 20px; border-top: 1px solid #333; align-items: center; flex-wrap: wrap;';

    const tools = [
      { id: 'rectangle', label: 'Rectangle' },
      { id: 'arrow', label: 'Arrow' },
      { id: 'circle', label: 'Circle' },
      { id: 'pencil', label: 'Pencil' },
      { id: 'text', label: 'Text' }
    ];

    tools.forEach((t, i) => {
      const btn = document.createElement('button');
      btn.className = 'ytaitutor-tool';
      btn.dataset.tool = t.id;
      btn.textContent = t.label;
      btn.style.cssText = `padding: 8px 14px; background: ${i === 0 ? '#4285f4' : '#333'}; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 13px;`;
      toolbar.appendChild(btn);
    });

    const clearBtn = document.createElement('button');
    clearBtn.id = 'ytaitutor-clear';
    clearBtn.textContent = 'Clear';
    clearBtn.style.cssText = 'padding: 8px 14px; background: #b71c1c; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; margin-left: auto;';
    toolbar.appendChild(clearBtn);

    const textStyleBar = document.createElement('div');
    textStyleBar.id = 'ytaitutor-text-style-bar';
    textStyleBar.style.cssText = 'display: none; gap: 10px; align-items: center; padding: 8px 20px 0; flex-wrap: wrap; color: #aaa; font-size: 12px;';

    const colorLabel = document.createElement('label');
    colorLabel.textContent = 'Color:';
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = '#ffffff';
    colorInput.id = 'ytaitutor-text-color';

    const sizeLabel = document.createElement('label');
    sizeLabel.textContent = 'Size:';
    const sizeInput = document.createElement('input');
    sizeInput.type = 'range';
    sizeInput.min = '10';
    sizeInput.max = '48';
    sizeInput.value = '16';
    sizeInput.step = '1';
    sizeInput.id = 'ytaitutor-text-size';
    const sizeValue = document.createElement('span');
    sizeValue.id = 'ytaitutor-text-size-value';
    sizeValue.textContent = '16';

    textStyleBar.appendChild(colorLabel);
    textStyleBar.appendChild(colorInput);
    textStyleBar.appendChild(sizeLabel);
    textStyleBar.appendChild(sizeInput);
    textStyleBar.appendChild(sizeValue);

    const contextSection = document.createElement('div');
    contextSection.id = 'ytaitutor-context-section';
    contextSection.style.cssText = 'padding: 12px 20px; border-top: 1px solid #333; background: #141414;';

    const contextTitle = document.createElement('div');
    contextTitle.style.cssText = 'color: #fff; font-size: 13px; font-weight: 600; margin-bottom: 8px;';
    contextTitle.textContent = 'Transcription context';

    const presetRow = document.createElement('div');
    presetRow.style.cssText = 'display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 8px;';

    const presetLabel = document.createElement('label');
    presetLabel.htmlFor = 'ytaitutor-transcript-priority';
    presetLabel.style.cssText = 'color: #aaa; font-size: 12px; font-weight: 500;';
    presetLabel.textContent = 'Context:';

    const presetSelect = document.createElement('select');
    presetSelect.id = 'ytaitutor-transcript-priority';
    presetSelect.style.cssText = 'flex: 1; min-width: 210px; padding: 6px; border-radius: 4px; background: #1a1a1a; color: #fff; border: 1px solid #444; font-size: 12px;';
    [
      ['standard', '🎯 Standard (60s before / 30s after)'],
      ['economical', '⚡ Economical (30s before / 15s after)'],
      ['complete', '🔍 Complete (120s before / 60s after)'],
      ['global', '🌐 Full video transcript (entire video)'],
      ['global-local', '🌐+🎯 Global transcript + Local focus'],
      ['custom', '⚙️ Custom interval (sliders)']
    ].forEach(([value, label]) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      if (value === this.transcriptPriority) {
        opt.selected = true;
      }
      presetSelect.appendChild(opt);
    });

    const tokenEstimate = document.createElement('span');
    tokenEstimate.id = 'ytaitutor-token-estimate';
    tokenEstimate.style.cssText = 'font-size: 11px; color: #90caf9; background: #1a1a2a; border: 1px solid #333; border-radius: 4px; padding: 4px 8px; white-space: nowrap;';
    tokenEstimate.textContent = '— tokens';

    presetRow.appendChild(presetLabel);
    presetRow.appendChild(presetSelect);
    presetRow.appendChild(tokenEstimate);

    const sliderRow = document.createElement('div');
    sliderRow.id = 'ytaitutor-slider-row';
    sliderRow.style.cssText = 'display: flex; gap: 16px; align-items: center; flex-wrap: wrap; color: #aaa; font-size: 12px; margin-bottom: 8px;';
    if (this.transcriptPriority === 'global') {
      sliderRow.style.display = 'none';
    }

    const beforeWrap = document.createElement('div');
    const beforeSlider = document.createElement('input');
    beforeSlider.type = 'range';
    beforeSlider.id = 'ytaitutor-before';
    beforeSlider.min = '5';
    beforeSlider.max = '120';
    beforeSlider.value = String(this.beforeSec);
    beforeSlider.style.width = '90px';
    const beforeVal = document.createElement('span');
    beforeVal.id = 'before-val';
    beforeVal.textContent = String(this.beforeSec);
    beforeWrap.appendChild(document.createTextNode('Interval: '));
    beforeWrap.appendChild(beforeSlider);
    beforeWrap.appendChild(beforeVal);
    beforeWrap.appendChild(document.createTextNode('s before'));

    const afterWrap = document.createElement('div');
    const afterSlider = document.createElement('input');
    afterSlider.type = 'range';
    afterSlider.id = 'ytaitutor-after';
    afterSlider.min = '5';
    afterSlider.max = '120';
    afterSlider.value = String(this.afterSec);
    afterSlider.style.width = '90px';
    const afterVal = document.createElement('span');
    afterVal.id = 'after-val';
    afterVal.textContent = String(this.afterSec);
    afterWrap.appendChild(afterSlider);
    afterWrap.appendChild(afterVal);
    afterWrap.appendChild(document.createTextNode('s after'));

    sliderRow.appendChild(beforeWrap);
    sliderRow.appendChild(afterWrap);

    const previewBox = document.createElement('div');
    previewBox.id = 'ytaitutor-transcript-preview-box';
    previewBox.style.cssText = 'max-height: 100px; overflow-y: auto; background: #0f0f0f; border: 1px solid #333; border-radius: 6px; padding: 8px;';

    const previewText = document.createElement('pre');
    previewText.id = 'ytaitutor-transcript-preview-text';
    previewText.style.cssText = 'margin: 0; font-size: 11px; color: #ccc; white-space: pre-wrap; word-break: break-word; font-family: inherit;';
    previewText.textContent = 'Loading transcript…';
    previewBox.appendChild(previewText);

    contextSection.appendChild(contextTitle);
    contextSection.appendChild(presetRow);
    contextSection.appendChild(sliderRow);
    contextSection.appendChild(previewBox);

    const actions = document.createElement('div');
    actions.style.cssText = 'padding: 16px 20px; display: flex; gap: 12px; justify-content: flex-end; border-top: 1px solid #333;';

    const resetBtn = document.createElement('button');
    resetBtn.id = 'ytaitutor-reset';
    resetBtn.textContent = 'Reset';
    resetBtn.style.cssText = 'padding: 10px 20px; background: #333; color: #fff; border: none; border-radius: 8px; cursor: pointer; font-size: 14px;';

    const submitBtn = document.createElement('button');
    submitBtn.id = 'ytaitutor-submit';
    submitBtn.textContent = 'Ask my question →';
    submitBtn.style.cssText = 'padding: 10px 24px; background: #4285f4; color: #fff; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 600;';

    actions.appendChild(resetBtn);
    actions.appendChild(submitBtn);

    container.appendChild(header);
    container.appendChild(framesRow);
    container.appendChild(frameOffsetRow);
    container.appendChild(canvasContainer);
    container.appendChild(toolbar);
    container.appendChild(textStyleBar);
    container.appendChild(contextSection);
    container.appendChild(actions);

    // Pretty loading / ready state layer
    const statusBar = document.createElement('div');
    statusBar.id = 'ytaitutor-annotation-status';
    statusBar.style.cssText = `
      position: absolute; left: 20px; right: 20px; bottom: 20px;
      background: rgba(17,17,17,0.65);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px;
      padding: 12px 14px;
      color: #cfd8dc;
      display: flex; align-items: center; justify-content: space-between;
      gap: 12px;
      backdrop-filter: blur(6px);
      transition: opacity 200ms ease, transform 200ms ease;
    `;

    const statusLeft = document.createElement('div');
    statusLeft.style.cssText = 'display:flex; flex-direction:column; gap:4px;';

    const statusTitle = document.createElement('div');
    statusTitle.id = 'ytaitutor-annotation-status-title';
    statusTitle.style.cssText = 'font-weight: 700; font-size: 13px; color: #fff;';
    statusTitle.textContent = 'Preparing…';

    const statusSubtitle = document.createElement('div');
    statusSubtitle.id = 'ytaitutor-annotation-status-subtitle';
    statusSubtitle.style.cssText = 'font-size: 12px; color: #9aa7b0;';
    statusSubtitle.textContent = 'Captures + transcription';

    statusLeft.appendChild(statusTitle);
    statusLeft.appendChild(statusSubtitle);

    const statusSpinner = document.createElement('div');
    statusSpinner.id = 'ytaitutor-annotation-status-spinner';
    statusSpinner.style.cssText = `
      width: 30px; height: 30px; border-radius: 50%;
      border: 3px solid rgba(255,255,255,0.18);
      border-top-color: #4285f4;
      animation: ytaitutor-spin 0.9s linear infinite;
      flex: 0 0 auto;
      opacity: 0.95;
    `;

    const styleTag = document.createElement('style');
    styleTag.textContent = `@keyframes ytaitutor-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`;

    statusBar.appendChild(statusLeft);
    statusBar.appendChild(statusSpinner);

    overlay.appendChild(styleTag);
    overlay.appendChild(container);
    overlay.appendChild(statusBar);
    document.body.appendChild(overlay);
    this.panel = overlay;
    this.statusBar = statusBar;
    this.statusTitle = statusTitle;
    this.statusSubtitle = statusSubtitle;
    this.statusSpinner = statusSpinner;


    this.editor = new AnnotationEditor(canvas);
    this.selectFrame(1);

    // Zoom implementation: redraw canvas at a new display scale (canvas internal mapping is handled by editor)
    // We change only the CSS size and canvas intrinsic size by triggering a re-load redraw.
    const zoom = {
      value: 1,
      min: 0.5,
      max: 3,
      step: 0.1,
      apply: () => {
        zoomLabel.textContent = `${Math.round(zoom.value * 100)}%`;
        // Trigger resize by re-loading the current image with the same annotations.
        const frame = this.frames?.[this.selectedFrameIndex];
        if (!frame?.dataUrl) return;
        const annotations = this.frameAnnotations?.[this.selectedFrameIndex] || [];
        // editor.loadImage will apply its own max width rule; we temporarily override by CSS sizing via scale factor.
        // To keep it deterministic, we set an attribute and let editor read it.
        canvas.dataset.zoom = String(zoom.value);
        this.editor.loadImage(frame.dataUrl, annotations);
      }
    };

    zoomOutBtn.addEventListener('click', () => {
      zoom.value = Math.max(zoom.min, Math.round((zoom.value - zoom.step) * 10) / 10);
      zoom.apply();
    });
    zoomInBtn.addEventListener('click', () => {
      zoom.value = Math.min(zoom.max, Math.round((zoom.value + zoom.step) * 10) / 10);
      zoom.apply();
    });
    zoomResetBtn.addEventListener('click', () => {
      zoom.value = 1;
      zoom.apply();
    });

    // Wheel zoom
    canvasContainer.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return; // avoid breaking normal scrolling
      e.preventDefault();
      const delta = -Math.sign(e.deltaY);
      if (delta > 0) zoom.value = Math.min(zoom.max, Math.round((zoom.value + zoom.step) * 10) / 10);
      else zoom.value = Math.max(zoom.min, Math.round((zoom.value - zoom.step) * 10) / 10);
      zoom.apply();
    }, { passive: false });

    zoom.apply();

    closeBtn.addEventListener('click', () => this.close());

    resetBtn.addEventListener('click', () => this.reset());
    clearBtn.addEventListener('click', () => {
      this.editor.clear();
      this.saveCurrentFrameAnnotations();
    });
    submitBtn.addEventListener('click', () => this.submit());

    const toggleTextStyleControls = (tool) => {
      const isTextTool = tool === 'text';
      textStyleBar.style.display = isTextTool ? 'flex' : 'none';
    };

    toolbar.querySelectorAll('.ytaitutor-tool').forEach((btn) => {
      btn.addEventListener('click', () => {
        toolbar.querySelectorAll('.ytaitutor-tool').forEach((b) => {
          b.style.background = '#333';
        });
        btn.style.background = '#4285f4';
        this.editor.setTool(btn.dataset.tool);
        toggleTextStyleControls(btn.dataset.tool);
      });
    });

    toggleTextStyleControls('rectangle');

    colorInput.addEventListener('input', (e) => {
      this.editor.setTextStyle({ color: e.target.value });
    });

    sizeInput.addEventListener('input', (e) => {
      const size = parseInt(e.target.value, 10);
      sizeValue.textContent = String(size);
      this.editor.setTextStyle({ size });
    });

    beforeSlider.addEventListener('input', (e) => {
      this.beforeSec = parseInt(e.target.value, 10);
      beforeVal.textContent = String(this.beforeSec);
      this.transcriptPriority = 'custom';
      this.transcriptMode = 'local';
      presetSelect.value = 'custom';
      this.scheduleTranscriptPreview();
    });

    afterSlider.addEventListener('input', (e) => {
      this.afterSec = parseInt(e.target.value, 10);
      afterVal.textContent = String(this.afterSec);
      this.transcriptPriority = 'custom';
      this.transcriptMode = 'local';
      presetSelect.value = 'custom';
      this.scheduleTranscriptPreview();
    });

    presetSelect.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val === 'custom') {
        this.transcriptPriority = 'custom';
        this.transcriptMode = 'local';
        sliderRow.style.display = 'flex';
        this.updateTranscriptPreview();
        return;
      }
      this.applyTranscriptPreset(val);
      if (val === 'global') {
        sliderRow.style.display = 'none';
      } else {
        sliderRow.style.display = 'flex';
        beforeSlider.value = String(this.beforeSec);
        afterSlider.value = String(this.afterSec);
        beforeVal.textContent = String(this.beforeSec);
        afterVal.textContent = String(this.afterSec);
      }
      this.updateTranscriptPreview();
    });

    beforeFrameSlider.addEventListener('input', (e) => {
      this.frameBeforeOffset = parseInt(e.target.value, 10);
      beforeFrameVal.textContent = String(this.frameBeforeOffset);
    });

    afterFrameSlider.addEventListener('input', (e) => {
      this.frameAfterOffset = parseInt(e.target.value, 10);
      afterFrameVal.textContent = String(this.frameAfterOffset);
    });

    recaptureBtn.addEventListener('click', () => this.recaptureFrames());
    frameSendSelect.addEventListener('change', (e) => {
      this.frameSendMode = e.target.value;
      this.updateTranscriptPreview();
    });

    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.close();
      }
    });
  }

  /**
   * Builds or refreshes frame thumbnail elements.
   * @param {HTMLElement} container
   */
  renderFrameThumbnails(container) {
    container.innerHTML = '';
    this.thumbElements = [];

    this.frames.forEach((frame, idx) => {
      const thumb = document.createElement('div');
      thumb.style.cssText = `
        width: 160px; height: 90px; border-radius: 8px; overflow: hidden;
        cursor: pointer; border: 3px solid ${idx === this.selectedFrameIndex ? '#4285f4' : 'transparent'};
        transition: border-color 0.2s; position: relative;
      `;

      const img = document.createElement('img');
      img.src = frame.dataUrl;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      img.alt = frame.label;

      const label = document.createElement('div');
      label.style.cssText = 'position:absolute;bottom:4px;left:4px;background:rgba(0,0,0,0.7);color:#fff;font-size:11px;padding:2px 6px;border-radius:4px;';
      label.textContent = frame.label;

      thumb.appendChild(img);
      thumb.appendChild(label);
      thumb.addEventListener('click', () => this.selectFrame(idx));
      this.thumbElements.push(thumb);
      container.appendChild(thumb);
    });
  }

  /**
   * Re-captures the three frames with the current T-X / T+X offsets.
   */
  async recaptureFrames() {
    if (this.isRecapturing || !this.videoElement) {
      return;
    }

    const btn = this.panel.querySelector('#ytaitutor-recapture-frames');
    this.isRecapturing = true;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Capturing…';
    }

    try {
      const { frames } = await CaptureEngine.captureMultiFrame(
        this.videoElement,
        this.currentTime,
        this.frameBeforeOffset,
        this.frameAfterOffset
      );
      this.frames = frames;
      this.frameAnnotations = this.frames.map(() => []);

      const row = this.panel.querySelector('#ytaitutor-frames-row');
      if (row) {
        this.renderFrameThumbnails(row);
      }

      this.editor.clear();
      this.selectFrame(1);
    } catch (err) {
      console.error('[YTAITutor] Erreur recapture frames:', err);
    } finally {
      this.isRecapturing = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = '↻ Recapture 3 frames';
      }
    }
  }

  /**
   * Persists annotations for the currently selected frame.
   */
  saveCurrentFrameAnnotations() {
    if (!this.editor || this.selectedFrameIndex == null) {
      return;
    }
    this.frameAnnotations[this.selectedFrameIndex] = this.editor.getAnnotations();
  }

  /**
   * Selects a frame thumbnail and loads it in the editor.
   * @param {number} index
   */
  selectFrame(index) {
    this.saveCurrentFrameAnnotations();
    this.selectedFrameIndex = index;
    this.thumbElements.forEach((thumb, i) => {
      thumb.style.borderColor = i === index ? '#4285f4' : 'transparent';
    });
    const annotations = this.frameAnnotations[index] || [];
    this.editor.loadImage(this.frames[index].dataUrl, annotations);
  }

  /**
   * Applies a transcript preset to the context sliders.
   * @param {string} priority
   */
  applyTranscriptPreset(priority) {
    const preset = ANNOTATION_TRANSCRIPT_PRESETS[priority];
    if (!preset) {
      return;
    }
    this.transcriptPriority = priority;
    this.beforeSec = preset.beforeSec;
    this.afterSec = preset.afterSec;
    this.transcriptPreferFull = preset.preferFull;
    this.transcriptMode = preset.mode || 'local';
  }

  /**
   * Debounces transcript preview refresh while dragging sliders.
   */
  scheduleTranscriptPreview() {
    clearTimeout(this.previewDebounceTimer);
    this.previewDebounceTimer = setTimeout(() => {
      this.syncPreferFullFromSliders();
      this.updateTranscriptPreview();
    }, 250);
  }

  /**
   * Keeps preferFull in sync when user picks a custom interval.
   */
  syncPreferFullFromSliders() {
    if (this.transcriptPriority !== 'custom') {
      return;
    }
    const complete = ANNOTATION_TRANSCRIPT_PRESETS.complete;
    this.transcriptPreferFull = this.beforeSec >= complete.beforeSec
      && this.afterSec >= complete.afterSec;
  }

  /**
   * Sends a runtime message and returns a promise.
   * @param {object} message
   * @returns {Promise<any>}
   */
  sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    });
  }

  /**
   * Fetches and displays the transcript window for the current interval.
   */
  async updateTranscriptPreview() {
    // Prevent multiple overlapping previews from clobbering the UI.
    // (We keep it simple: last request wins.)
    const requestId = (this._previewReqId = (this._previewReqId || 0) + 1);
    const applyIfLatest = (fn) => {
      if (this._previewReqId === requestId) fn();
    };
    const tokenEl = this.panel?.querySelector('#ytaitutor-token-estimate');
    const previewEl = this.panel?.querySelector('#ytaitutor-transcript-preview-text');

    applyIfLatest(() => {
      if (tokenEl) {
        tokenEl.textContent = 'estimating…';
        tokenEl.style.color = '#90caf9';
        tokenEl.style.background = '#1a1a2a';
      }
      if (previewEl) {
        previewEl.textContent = 'Loading transcript…';
      }

      // update bottom status message to be more “plausible”
      if (this.statusSubtitle) {
        this.statusSubtitle.textContent = 'Transcription & token estimate…';
      }
    });



    if (!this.videoId) {
      if (previewEl) {
        previewEl.textContent = 'Video not identified.';
      }
      return;
    }

    try {
      const frameCount = this.frameSendMode === 'none'
        ? 0
        : this.frameSendMode === 't0-only'
          ? 1
          : this.frames.length;

      const result = await this.sendRuntimeMessage({
        
      
        action: 'previewTranscriptWindow',
        videoId: this.videoId,
        currentTime: this.currentTime,
        beforeSec: this.beforeSec,
        afterSec: this.afterSec,
        transcriptPreferFull: this.transcriptPreferFull,
        transcriptMode: this.transcriptMode,
        frameSendMode: this.frameSendMode,
        frameCount,
        transcriptLang: this.transcriptData?.language || 'fr'
      });

      const charCount = result?.charCount || 0;
      const localTokens = result?.localTokens || 0;
      const globalTokens = result?.globalTokens || 0;
      const frameEst = result?.frameEstimate;

      // frameEstimate: { imageCount, imageTokens, tokensByMode?: {local, global} }
      const imageCount = frameEst?.imageCount
        ?? (this.frameSendMode === 'none' ? 0 : this.frameSendMode === 't0-only' ? 1 : (this.frames?.length || 3));
      const imageTokens = frameEst?.imageTokens ?? (imageCount * 900);

      const fullSuffix = result?.isFull ? ' — full' : '';

      let transcriptTokens = localTokens;
      let transcriptDetail = `local (~${localTokens} tok)`;

      if (this.transcriptMode === 'global') {
        transcriptTokens = globalTokens;
        transcriptDetail = `global (~${globalTokens} tok)`;
      } else if (this.transcriptMode === 'global-local') {
        transcriptTokens = localTokens + globalTokens + 200;
        transcriptDetail = `local (~${localTokens} tok) + global (~${globalTokens} tok)`;
      }

      const totalTokens = transcriptTokens + imageTokens;
      const imageLabel = imageCount === 1 ? '1 image' : `${imageCount} images`;

      if (tokenEl) {
        tokenEl.textContent = `~${totalTokens} estimated tokens (${transcriptDetail}, ${imageLabel}, ${charCount} chars${fullSuffix})`;
        tokenEl.style.color = result?.isFull ? '#81c784' : '#90caf9';
        tokenEl.style.background = result?.isFull ? '#1b3a1b' : '#1a1a2a';
      }

      if (previewEl) {
        previewEl.textContent = result?.previewText?.trim()
          || '(Transcript unavailable for this interval — AI will still be able to use the images)';
      }

      if (this.statusSubtitle) {
        this.statusSubtitle.textContent = 'Prêt à annoter';
      }
    } catch (err) {
      console.warn('[YTAITutor] Preview transcript annotation:', err);
      if (tokenEl) {
        tokenEl.textContent = 'estimation unavailable';
      }
      if (previewEl) {
        previewEl.textContent = '(Unable to load transcript — check video subtitles)';
      }
    }
  }

  /**
   * Resets annotations and re-selects T0.
   */
  reset() {
    this.editor.clear();
    this.selectFrame(1);
  }

  /**
   * Renders a specific frame with its own annotations for submission.
   * @param {number} frameIndex
   * @returns {Promise<string|null>}
   */
  async renderFrameImageWithAnnotations(frameIndex) {
    const frame = this.frames[frameIndex];
    if (!frame?.dataUrl) {
      return null;
    }

    const annotations = this.frameAnnotations[frameIndex] || [];
    const img = new Image();
    const dataUrl = await new Promise((resolve, reject) => {
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          annotations.forEach((ann) => this.editor.drawAnnotationOnContext(ctx, ann));
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error('Impossible de charger la frame pour l’envoi'));
      img.src = frame.dataUrl;
    });

    return dataUrl;
  }

  /**
   * Burns in annotations, stores capture, and opens the side panel.
   */
  async submit() {
    try {
      this.saveCurrentFrameAnnotations();

      const annotatedImage = this.editor.burnIn();
      const cropRegion = this.editor.getCropRegion();
      const shouldIncludeContext = this.frameSendMode !== 't0-only';
      const t0Index = this.frames.findIndex((frame) => frame.label === 'T0' || /^T0\b/.test(frame.label || ''));
      const annotatedT0Image = !shouldIncludeContext && t0Index >= 0
        ? await this.renderFrameImageWithAnnotations(t0Index)
        : null;
      const framePayloads = this.frames
        .filter((frame) => {
          if (!shouldIncludeContext) {
            return frame.label === 'T0' || /^T0\b/.test(frame.label || '');
          }
          return true;
        })
        .map((frame) => ({
          label: frame.label,
          time: frame.time,
          offset: frame.offset,
          dataUrl: (frame.label === 'T0' || /^T0\b/.test(frame.label))
            ? (annotatedT0Image || annotatedImage)
            : frame.dataUrl
        }));

      await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          action: 'storeAnnotatedCapture',
          data: {
            videoId: this.videoId,
            videoTitle: this.videoTitle,
            currentTime: this.currentTime,
            dataUrl: annotatedImage,
            cropRegion,
            beforeSec: this.beforeSec,
            afterSec: this.afterSec,
            transcriptPreferFull: this.transcriptPreferFull,
            transcriptPriority: this.transcriptPriority,
            transcriptMode: this.transcriptMode,
            transcriptLang: this.transcriptData?.language || null,
            frames: framePayloads,
            frameSendMode: this.frameSendMode,
            selectedFrame: this.frames[this.selectedFrameIndex]?.label || 'T0',
            annotated: true,
            timestamp: Date.now()
          }
        }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!response?.success) {
            reject(new Error(response?.error || 'Échec du stockage'));
            return;
          }
          resolve(response);
        });
      });

      this.close();
      chrome.runtime.sendMessage({ action: 'openSidePanel' });
    } catch (err) {
      console.error('[YTAITutor] Erreur soumission annotation:', err);
    }
  }

  /**
   * Removes the panel from the DOM.
   */
  close() {
    if (this.panel) {
      this.panel.remove();
      this.panel = null;
    }
  }
}

/**
 * Opens the annotation panel, closing any existing instance.
 * @param {Array} frames
 * @param {string} videoId
 * @param {string} videoTitle
 * @param {number} currentTime
 * @param {object|null} transcriptData
 * @param {HTMLVideoElement|null} videoElement
 */
async function openAnnotationPanel(frames, videoId, videoTitle, currentTime, transcriptData = null, videoElement = null) {
  const existing = document.getElementById('ytaitutor-annotation-overlay');
  if (existing) {
    existing.remove();
  }
  let userDefaults = null;
  try {
    const stored = await chrome.storage.local.get('defaultPreferences');
    userDefaults = stored?.defaultPreferences || null;
  } catch {
    /* ignore */
  }
  new AnnotationPanel(frames, videoId, videoTitle, currentTime, transcriptData, videoElement, userDefaults);
}

