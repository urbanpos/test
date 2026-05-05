// Runs on chatgpt.com / chat.openai.com. Receives REFINE_RUN messages from the
// background worker, types the prompt into the composer, waits for ChatGPT to
// finish answering, and returns the answer.

function log(...args) { console.log("[RefineChatGPT/ChatGPT]", ...args); }

const INPUT_SELECTORS = [
  '#prompt-textarea',
  'div#prompt-textarea',
  'textarea#prompt-textarea',
  'div[contenteditable="true"][data-id="root"]',
  'div.ProseMirror[contenteditable="true"]',
  'form textarea',
  'form div[contenteditable="true"]',
];

const SEND_SELECTORS = [
  '[data-testid="send-button"]',
  'button[aria-label="Send prompt"]',
  'button[aria-label*="Send"]',
  'button[data-testid*="send"]',
];

const STOP_SELECTORS = [
  '[data-testid="stop-button"]',
  'button[aria-label="Stop generating"]',
  'button[aria-label*="Stop"]',
];

const ASSISTANT_MSG_SELECTOR = '[data-message-author-role="assistant"]';

function pickFirst(selectors) {
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

function findInput() { return pickFirst(INPUT_SELECTORS); }
function findSend()  { return pickFirst(SEND_SELECTORS); }
function findStop()  { return pickFirst(STOP_SELECTORS); }

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function isReady() {
  const ok = !!findInput();
  return ok;
}

async function waitFor(predicate, { timeout = 30000, interval = 200 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const v = predicate();
    if (v) return v;
    await sleep(interval);
  }
  return null;
}

async function typeIntoComposer(text) {
  const input = findInput();
  if (!input) throw new Error("ChatGPT input box not found. Are you logged in? If a Cloudflare challenge is showing, solve it and try again.");
  input.focus();
  log("input focused", input);

  // Handle textarea vs contenteditable.
  if (input.tagName === "TEXTAREA") {
    const proto = Object.getPrototypeOf(input);
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    // contenteditable (ProseMirror). Clear, then insert text line by line.
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(input);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand("delete", false);
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) document.execCommand("insertLineBreak", false);
      if (lines[i]) document.execCommand("insertText", false, lines[i]);
    }
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
  }
  await sleep(200);
}

async function clickSend() {
  const btn = await waitFor(() => {
    const b = findSend();
    return b && !b.disabled && b.getAttribute("aria-disabled") !== "true" ? b : null;
  }, { timeout: 8000 });
  if (btn) {
    log("clicking send", btn);
    btn.click();
    return;
  }
  log("send button not found, sending Enter key");
  const input = findInput();
  ["keydown", "keypress", "keyup"].forEach((type) => {
    input.dispatchEvent(new KeyboardEvent(type, {
      key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true,
    }));
  });
}

async function waitForAnswerComplete(beforeCount) {
  // Wait for a new assistant message OR a stop button to appear.
  const started = await waitFor(() => {
    return findStop() ||
      (document.querySelectorAll(ASSISTANT_MSG_SELECTOR).length > beforeCount);
  }, { timeout: 20000 });
  if (!started) throw new Error("ChatGPT did not start responding (rate limited or page state issue).");
  log("response started");
  // Wait for stop button to disappear.
  await waitFor(() => !findStop(), { timeout: 80000, interval: 400 });
  await sleep(500);
  log("response complete");
}

function readLastAnswer() {
  const msgs = document.querySelectorAll(ASSISTANT_MSG_SELECTOR);
  const last = msgs[msgs.length - 1];
  if (!last) return "";
  const md = last.querySelector(".markdown") || last;
  return md.innerText.trim();
}

async function runRefine(requestId, prompt, text) {
  try {
    log("runRefine start", requestId);
    if (!isReady()) {
      throw new Error("ChatGPT page not ready. Log in, dismiss any popups/Cloudflare challenge, then retry.");
    }
    const before = document.querySelectorAll(ASSISTANT_MSG_SELECTOR).length;

    await typeIntoComposer(prompt + text);
    await clickSend();
    await waitForAnswerComplete(before);

    const answer = readLastAnswer();
    if (!answer) throw new Error("No answer captured from ChatGPT");

    log("returning answer of length", answer.length);
    chrome.runtime.sendMessage({ type: "REFINE_RESULT", requestId, text: answer });
  } catch (err) {
    log("error", err);
    chrome.runtime.sendMessage({
      type: "REFINE_ERROR",
      requestId,
      error: String(err && err.message || err),
    });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return false;
  if (message.type === "PING") {
    sendResponse({ ready: isReady() });
    return false;
  }
  if (message.type === "REFINE_RUN") {
    runRefine(message.requestId, message.prompt, message.text);
    sendResponse({ accepted: true });
    return false;
  }
  return false;
});

log("content script loaded");
