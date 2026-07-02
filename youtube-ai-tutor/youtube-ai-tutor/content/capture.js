/**
 * @file Frame capture engine for YouTube video elements.
 */

/**
 * Captures frames from a video element via canvas.
 */
class CaptureEngine {
  /**
   * Captures a video frame at the current or specified time.
   * @param {HTMLVideoElement} videoElement
   * @param {number|null} targetTime
   * @returns {Promise<string>} JPEG data URL
   */
  static async capture(videoElement, targetTime = null, options = {}) {
    const { suppressRestore = false } = options;
    const wasPlaying = !videoElement.paused;
    const originalTime = videoElement.currentTime;

    try {
      if (targetTime !== null && Math.abs(videoElement.currentTime - targetTime) > 0.1) {
        videoElement.currentTime = targetTime;
        await new Promise((resolve, reject) => {
          const onSeeked = () => {
            videoElement.removeEventListener('seeked', onSeeked);
            clearTimeout(timeout);
            resolve();
          };
          const timeout = setTimeout(() => {
            videoElement.removeEventListener('seeked', onSeeked);
            reject(new Error('Timeout seek'));
          }, 3000);
          videoElement.addEventListener('seeked', onSeeked);
        });
      }

      const canvas = document.createElement('canvas');
      canvas.width = videoElement.videoWidth;
      canvas.height = videoElement.videoHeight;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

      const maxSide = 640;
      let { width, height } = canvas;

      if (width > height && width > maxSide) {
        height = Math.round((height * maxSide) / width);
        width = maxSide;
      } else if (height > maxSide) {
        width = Math.round((width * maxSide) / height);
        height = maxSide;
      }

      if (width !== canvas.width || height !== canvas.height) {
        const resizeCanvas = document.createElement('canvas');
        resizeCanvas.width = width;
        resizeCanvas.height = height;
        resizeCanvas.getContext('2d').drawImage(canvas, 0, 0, width, height);
        return resizeCanvas.toDataURL('image/jpeg', 0.85);
      }

      return canvas.toDataURL('image/jpeg', 0.85);
    } finally {
      if (targetTime !== null && !suppressRestore) {
        if (Math.abs(videoElement.currentTime - originalTime) > 0.1) {
          videoElement.currentTime = originalTime;
        }
        if (wasPlaying) {
          try {
            await videoElement.play();
          } catch {
            /* autoplay restrictions */
          }
        }
      }
    }
  }

  /**
   * Sorts frames chronologically: T-X, then T0, then T+X.
   * @param {Array<{time: number, offset?: number}>} frames
   * @returns {Array}
   */
  static sortFramesChronologically(frames) {
    return [...frames].sort((a, b) => {
      const offsetA = a.offset ?? 0;
      const offsetB = b.offset ?? 0;
      if (offsetA !== offsetB) {
        return offsetA - offsetB;
      }
      return (a.time ?? 0) - (b.time ?? 0);
    });
  }

  /**
   * Captures T-X, T0, and T+X frames around a timestamp.
   * @param {HTMLVideoElement} videoElement
   * @param {number} currentTime
   * @param {number} beforeOffset Seconds before T0 (default 6)
   * @param {number} afterOffset Seconds after T0 (default 6)
   * @returns {Promise<{frames: object[], currentTime: number, originalTime: number}>}
   */
  static async captureMultiFrame(videoElement, currentTime, beforeOffset = 6, afterOffset = 6) {
    const wasPlaying = !videoElement.paused;
    const originalTime = videoElement.currentTime;

    if (wasPlaying) {
      videoElement.pause();
    }

    const before = Math.max(1, Math.min(120, Math.round(beforeOffset)));
    const after = Math.max(1, Math.min(120, Math.round(afterOffset)));
    const times = [
      { offset: -before, label: `T-${before}` },
      { offset: 0, label: 'T0' },
      { offset: after, label: `T+${after}` }
    ];

    const frames = [];
    for (const t of times) {
      const time = Math.max(0, currentTime + t.offset);
      const dataUrl = await CaptureEngine.capture(videoElement, time, { suppressRestore: true });
      frames.push({ time, dataUrl, label: t.label, offset: t.offset });
    }

    if (Math.abs(videoElement.currentTime - originalTime) > 0.1) {
      videoElement.currentTime = originalTime;
    }
    if (wasPlaying) {
      try {
        await videoElement.play();
      } catch {
        /* autoplay restrictions */
      }
    }

    return {
      frames: CaptureEngine.sortFramesChronologically(frames),
      currentTime,
      originalTime
    };
  }
}
