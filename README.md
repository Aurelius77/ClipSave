# ClipSave

A Chrome extension that saves your clipboard history for as long as you want. Easily find the text and links you've copied when you need them, right in your browser — easy and stress free.

## Features

- **Auto-save history** — every copy is saved with a timestamp (keeps your latest 100).
- **Right-click to save** — select text on any page and pick *Save to ClipSave* from the context menu.
- **Keyboard shortcut** — open ClipSave with `Ctrl+Shift+Y` (`⌘+Shift+Y` on Mac). Change it anytime at `chrome://extensions/shortcuts`.
- **Search** — instantly filter through your clips.
- **Tabs** — *All*, *Recent* (last used), *Frequent* (most used), *★ Fav*, and *Groups*.
- **Groups** — create named groups and drop clips into them; a clip can live in more than one.
- **Snippet templates** — save a clip with `{{placeholders}}` (e.g. `Hi {{name}}, thanks for {{thing}}`), and ClipSave prompts you to fill them in each time you copy.
- **Edit & dedup** — fix a saved clip inline, and copying the same thing twice won't make a duplicate.
- **Dark / light mode** — toggle it from the header, or let it follow your system.
- **Privacy** (⚙ tab) — pause capturing, ignore specific sites, and auto-expire old clips. Favorites and grouped clips are always kept.
- **Backup** (⚙ tab) — export everything to a JSON file and import it back later.
- **Sync** (⚙ tab) — optionally sync your favorites and groups across devices signed into the same Chrome.

## Usage

Copy any text and it's saved automatically for later — or select text on a page and right-click **Save to ClipSave**. Open the popup from its toolbar icon or with `Ctrl+Shift+Y` (`⌘+Shift+Y` on Mac). Mark favorites for quick access to your most-used clips, organize them into groups, and delete whatever you don't need — one clip at a time or all at once. For text you reuse with small changes, save it as a template with `{{placeholders}}` and fill them in on the fly when you copy.

## Installation

I haven't put it on the Chrome Web Store yet, so for now:

1. Download the `clipsave` folder from [Google Drive](https://drive.google.com/drive/folders/1QOOWo1bYrClMdwKWy7e3K1yKNObIQU7l?usp=sharing).
2. Open Chrome and go to `chrome://extensions` (or Menu → Extensions → Manage Extensions).
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** and select the downloaded `clipsave` folder.

Chrome will install it, and you'll see the ClipSave icon in your toolbar. Pin it for easy access.

## Forking and contributing

Since it deals with the clipboard, which can hold sensitive data, I've kept it open source so you can see exactly what's done with your data. Contributions are welcome as I keep adding features — and you can support by dropping a star. #WINKWINK#
