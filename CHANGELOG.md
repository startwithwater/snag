# Changelog

Every published Snag update is recorded here. The same release notes are shown
inside Snag before an update is installed.

## 1.8.3 — 2026-07-12

- Replace the Chrome audio picker’s full language list with a clean preferred-language prompt for new users.
- Open Snag’s Settings directly from that prompt and show only configured preferred languages afterward.

## 1.8.2 — 2026-07-12

- Make download buttons on large YouTube homepage hover previews analyze the linked video instead of the homepage.
- Canonicalize YouTube preview links to avoid unnecessary playlist analysis.
- Keep repeated browser handoffs moving even when the same URL is sent twice.
- Release the hidden quick-download window after ten idle minutes to reduce background memory use.
- Validate saved settings without overwriting deliberately empty language selections.
- Let the Chrome extension start Snag and hand the video to the app without opening duplicate pickers.
- Restrict local API pairing to Snag's pinned Chrome extension ID. Existing users may need to load Snag's refreshed extension folder once because Chrome treats the pinned identity as a new extension.

## 1.8.1 — 2026-07-12

- Open MKV downloads as playable Telegram media without re-encoding or changing the original file.
- Prevent rapid duplicate Telegram share requests.
- Prefetch YouTube format details when the in-video button appears so the quality picker opens much faster when clicked.

## 1.8.0 — 2026-07-12

- Redesign the Chrome quality picker into a compact single-decision panel: a quality list with inline MP4/MKV/WEBM chips, a sliding Video/Audio toggle, and a Download button that collapses into in-place progress.
- Default the video container automatically — MKV when merging multiple audio languages, MP4 otherwise — instead of asking every time.
- Add a Cancel action to the in-page download progress view.
- Move audio-language preferences out of the picker and into Settings as selectable pills, applied automatically whenever a video offers those languages.

## 1.7.2 — 2026-07-11

- Restore the update dialog after it is hidden while a download continues.
- Recover completed installers from the updater cache after Snag restarts.
- Revalidate cached update versions so a rapid follow-up release is not mistaken for the latest one.
- Record updater activity in `updater.log` for easier diagnosis.

## 1.7.1 — 2026-07-11

- Compact Chrome file-type tiles into two lines with size as the primary text.
- Move the Download action beside the Video/Audio toggle and fill the remaining width.
- Show only the top three quality sections initially, with lower tiers behind More qualities.

## 1.7.0 — 2026-07-11

- Detect the Chrome extension through an authenticated heartbeat.
- Prompt first-time users with guided setup, Not now, and Don’t show again choices.
- Add separate Clear list and confirmed Delete downloaded files queue actions.
- Add per-download permanent deletion with confirmation.
- Add Windows file sharing so Telegram, WhatsApp, and other registered share targets can receive the actual downloaded file.

## 1.6.3 — 2026-07-11

- Prepare the stable Chrome-extension folder automatically on first app launch.
- Refresh it on every later launch, without a Settings button press.
- Clarify that Chrome's Load unpacked approval is required only once.

## 1.6.2 — 2026-07-11

- Show each release's “What’s new” notes in the in-app update dialog.
- Add automatic Chrome-extension reloads after future Snag app upgrades.
- Package this changelog with the desktop application.

## 1.6.1 — 2026-07-11

- Group MP4, MKV, and WebM choices inside full-width quality cards.
- Make the Chrome Download button match the quality-card width.

## 1.6.0 — 2026-07-11

- Morph the Chrome button into an in-page quality picker.
- Add live download percentage, speed, ETA, processing, and completion states.
- Recommend MP4 normally and MKV for multiple audio tracks.
- Only mark a file “Smallest” when the difference is meaningful.

## 1.5.3 — 2026-07-11

- Restore the missing Windows notification-area icon with a packaged fallback.

## 1.5.2 — 2026-07-11

- Repair Chrome pairing, YouTube overlay stability, language favorites, and accessibility.

## 1.5.1 — 2026-07-11

- Add direct X/Twitter feed-video support.
