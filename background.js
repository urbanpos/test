// Coordinates between the Gmail content script and a chatgpt.com tab.
// Flow:
//   1. Gmail content script sends { type: "REFINE_REQUEST", text, prompt }
//   2. We find or open a chatgpt.com tab, wait for it to be ready, forward the prompt.
//   3. ChatGPT content script replies with { type: "REFINE_RESULT", text } or { type: "REFINE_ERROR" }.
//   4. We relay that back to the Gmail tab that asked.

const CHATGPT_URL = "https://chatgpt.com/";
const READY_TIMEOUT_MS = 30000;
const RESPONSE_TIMEOUT_MS = 120000;

const pending = new Map(); // requestId -> { gmailTabId, sendResponse, timer }

function newRequestId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function findChatGptTab() {
  const tabs = await chrome.tabs.query({
    url: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
  });
  return tabs[0] || null;
}

async function ensureChatGptTab() {
  const existing = await findChatGptTab();
  if (existing) return existing;
  return await chrome.tabs.create({ url: CHATGPT_URL, active: false });
}

function waitForChatGptReady(tabId) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tryPing = () => {
      chrome.tabs.sendMessage(tabId, { type: "PING" }, (res) => {
        if (chrome.runtime.lastError || !res || !res.ready) {
          if (Date.now() - start > READY_TIMEOUT_MS) {
            reject(new Error("ChatGPT tab not ready (login required?)"));
            return;
          }
          setTimeout(tryPing, 500);
        } else {
          resolve();
        }
      });
    };
    tryPing();
  });
}

async function handleRefineRequest(message, sender, sendResponse) {
  const requestId = newRequestId();
  const gmailTabId = sender.tab && sender.tab.id;

  try {
    const tab = await ensureChatGptTab();
    await waitForChatGptReady(tab.id);

    const timer = setTimeout(() => {
      const entry = pending.get(requestId);
      if (entry) {
        pending.delete(requestId);
        entry.sendResponse({ ok: false, error: "Timed out waiting for ChatGPT response." });
      }
    }, RESPONSE_TIMEOUT_MS);

    pending.set(requestId, { gmailTabId, sendResponse, timer });

    chrome.tabs.sendMessage(tab.id, {
      type: "REFINE_RUN",
      requestId,
      prompt: message.prompt,
      text: message.text,
    });
  } catch (err) {
    sendResponse({ ok: false, error: String(err && err.message || err) });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "REFINE_REQUEST") {
    handleRefineRequest(message, sender, sendResponse);
    return true; // async
  }

  if (message && message.type === "REFINE_RESULT") {
    const entry = pending.get(message.requestId);
    if (entry) {
      clearTimeout(entry.timer);
      pending.delete(message.requestId);
      entry.sendResponse({ ok: true, text: message.text });
    }
    return false;
  }

  if (message && message.type === "REFINE_ERROR") {
    const entry = pending.get(message.requestId);
    if (entry) {
      clearTimeout(entry.timer);
      pending.delete(message.requestId);
      entry.sendResponse({ ok: false, error: message.error || "Unknown ChatGPT error" });
    }
    return false;
  }

  return false;
});
