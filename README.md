# Gmail Refine with ChatGPT

Chrome extension that adds a **Refine with ChatGPT** button to the Gmail compose window. Clicking it sends your draft to your logged-in `chatgpt.com` account and replaces the draft with the refined version.

No API key required — it drives the chatgpt.com web UI in a background tab using your existing session.

## Install (developer mode)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Visit `https://chatgpt.com` once and log in. Keep that tab open or let the extension open one for you.
5. Open Gmail and start a new compose. You'll see a **Refine with ChatGPT** button next to **Send**.

## Usage

1. Write your rough draft in the Gmail compose body.
2. Click **Refine with ChatGPT**.
3. The extension forwards the draft to chatgpt.com, waits for the answer, and replaces the body with the refined version.

## Customizing the prompt

Click the extension's toolbar icon (or right-click → Options) to edit the instruction sent to ChatGPT before your draft.

## Files

- `manifest.json` — MV3 manifest.
- `background.js` — Service worker. Routes refine requests between Gmail and a chatgpt.com tab.
- `content_gmail.js` / `content_gmail.css` — Injects the toolbar button and handles body replacement.
- `content_chatgpt.js` — Types the prompt into chatgpt.com, waits for the reply, returns the text.
- `options.html` / `options.js` — Settings page for the refine prompt.

## Caveats

- This automates the chatgpt.com web UI. If OpenAI changes their HTML/selectors, the ChatGPT script may need updates — see `SELECTORS` in `content_chatgpt.js`.
- You must be logged in to chatgpt.com in the same Chrome profile.
- First refine after a cold start opens a chatgpt.com tab in the background; subsequent refines reuse it.
- Rate limits and Cloudflare challenges from chatgpt.com will surface as errors.
