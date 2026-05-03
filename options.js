const DEFAULT_PROMPT =
  "Refine the following email draft. Keep my intent and tone, fix grammar, " +
  "improve clarity and flow, and keep it concise. Return only the rewritten " +
  "email body with no preamble, commentary, or quotes.\n\n---\n\n";

const promptEl = document.getElementById("prompt");
const statusEl = document.getElementById("status");

function flash(msg) {
  statusEl.textContent = msg;
  setTimeout(() => { statusEl.textContent = ""; }, 2000);
}

chrome.storage.sync.get({ refinePrompt: DEFAULT_PROMPT }, (res) => {
  promptEl.value = res.refinePrompt;
});

document.getElementById("save").addEventListener("click", () => {
  chrome.storage.sync.set({ refinePrompt: promptEl.value }, () => flash("Saved"));
});

document.getElementById("reset").addEventListener("click", () => {
  promptEl.value = DEFAULT_PROMPT;
  chrome.storage.sync.set({ refinePrompt: DEFAULT_PROMPT }, () => flash("Reset"));
});
