// Runs on chatgpt.com / chat.openai.com. Receives REFINE_RUN messages from the
// background worker, types the prompt into the composer, waits for ChatGPT to
// finish answering, and returns the answer.

const SELECTORS = {
  // ChatGPT's composer is a contenteditable ProseMirror div with id="prompt-textarea".
  input: '#prompt-textarea',
  sendBtn: '[data-testid="send-button"], button[aria-label="Send prompt"]',
  stopBtn: '[data-testid="stop-button"], button[aria-label="Stop generating"]',
  assistantMsg: '[data-message-author-role="assistant"]',
};

function $(sel) { return document.querySelector(sel); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function isReady() {
  return !!$(SELECTORS.input);
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
  const input = $(SELECTORS.input);
  if (!input) throw new Error("ChatGPT composer not found");
  input.focus();

  // Clear any existing content.
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(input);
  sel.removeAllRanges();
  sel.addRange(range);
  document.execCommand("delete", false);

  // Insert text. execCommand insertText also fires the input events ProseMirror
  // listens to, so React state updates and the Send button enables.
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) document.execCommand("insertLineBreak", false);
    if (lines[i]) document.execCommand("insertText", false, lines[i]);
  }
  input.dispatchEvent(new InputEvent("input", { bubbles: true }));
  await sleep(120);
}

async function clickSend() {
  const btn = await waitFor(() => {
    const b = $(SELECTORS.sendBtn);
    return b && !b.disabled ? b : null;
  }, { timeout: 5000 });
  if (!btn) {
    // Fallback: dispatch Enter on the composer.
    const input = $(SELECTORS.input);
    input.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", code: "Enter", keyCode: 13, bubbles: true,
    }));
    return;
  }
  btn.click();
}

async function waitForAnswerComplete() {
  // Wait for the stop button to appear (generation started).
  await waitFor(() => $(SELECTORS.stopBtn), { timeout: 15000 });
  // Then wait for it to disappear (generation finished).
  await waitFor(() => !$(SELECTORS.stopBtn), { timeout: 110000, interval: 300 });
  // Small settle delay so the final DOM update lands.
  await sleep(400);
}

function readLastAnswer() {
  const msgs = document.querySelectorAll(SELECTORS.assistantMsg);
  const last = msgs[msgs.length - 1];
  if (!last) return "";
  const md = last.querySelector(".markdown") || last;
  return md.innerText.trim();
}

async function runRefine(requestId, prompt, text) {
  try {
    if (!isReady()) throw new Error("Composer not ready — are you logged in to ChatGPT?");
    const before = document.querySelectorAll(SELECTORS.assistantMsg).length;

    await typeIntoComposer(prompt + text);
    await clickSend();

    // Wait until a new assistant message appears.
    await waitFor(
      () => document.querySelectorAll(SELECTORS.assistantMsg).length > before,
      { timeout: 15000 }
    );
    await waitForAnswerComplete();

    const answer = readLastAnswer();
    if (!answer) throw new Error("No answer captured from ChatGPT");

    chrome.runtime.sendMessage({ type: "REFINE_RESULT", requestId, text: answer });
  } catch (err) {
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
