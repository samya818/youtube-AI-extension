# TODO - Firefox-ready YouTube AI Tutor

## Step 1: Firefox manifest
- [x] Add `browser_specific_settings.gecko.id` to `youtube-ai-tutor/manifest.json`.

## Step 2: Confirm UI counters behavior
- [x] Remove/hide any “Total installs / Popup opens” display from settings UI (as requested).


## Step 3: Analytics option B (global “other people”)
- [ ] Install Matomo on AlwaysData (self-host, free if you have the hosting features).
- [ ] Configure Matomo to accept tracking from the extension.
- [ ] Implement minimal, privacy-friendly event sending (installs + popup/side-panel opens) to Matomo.


## Step 4: Testing
- [ ] Validate manifest JSON, reload extension in Firefox, confirm no feature break.

