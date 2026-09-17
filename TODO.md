# TODO

## Fix overlay drawing + image zoom inside annotation panel

- [ ] Diagnose why the user can’t zoom/enlarge the returned image (likely canvas resize/overflow/interaction). Focus: `youtube-ai-tutor/content/annotation-editor.js` and `annotation-panel.js`.
- [ ] Diagnose why the overlay is not drawn on the editor image/canvas (likely annotations coordinate mismatch or scaling). Focus: `overlay.js`, `annotation-editor.js` and the annotation object schema.
- [ ] Implement image zoom (add wrapper with CSS `transform: scale()` + mouse wheel/pinch or buttons) without breaking canvas coordinate mapping.
- [ ] Ensure overlay rendering uses correct coordinate ratios and redraws on resize/zoom.
- [ ] Update any schema conversions needed so `response.overlay` objects match what `AnnotationEditor.drawAnnotationOnContext` expects.
- [ ] Add minimal safeguards/logging for missing `currentImage`/`annotations`.
- [ ] Test flow: chat answer -> overlay -> editor/return image -> zoom -> verify overlay.

