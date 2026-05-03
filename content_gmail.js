// Injects a "Refine with ChatGPT" button into every Gmail compose window.
// Clicking the button sends the current draft body to the background worker,
// which routes it through a chatgpt.com tab, then replaces the body with the result.

const BUTTON_MARKER = "data-refine-chatgpt-injected";
const DEFAULT_PROMPT =
  "Refine the following email draft. Keep my intent and tone, fix grammar, " +
  "improve clarity and flow, and keep it concise. Return only the rewritten " +
  "email body with no preamble, commentary, or quotes.\n\n---\n\n";

function findComposeWindows() {
  // Compose dialogs use role="dialog" with a Send button labeled "Send".
  return Array.from(document.querySelectorAll('div[role="dialog"]'))
    .filter((d) => d.querySelector('div[role="button"][data-tooltip^="Send"]'));
}

function findBodyEditor(composeRoot) {
  return composeRoot.querySelector('div[role="textbox"][aria-label^="Message Body"]')
      || composeRoot.querySelector('div[role="textbox"][g_editable="true"]');
}

function findToolbar(composeRoot) {
  // The send-row contains the Send button; we add our button right after it.
  const send = composeRoot.querySelector('div[role="button"][data-tooltip^="Send"]');
  return send ? send.parentElement : null;
}

async function getStoredPrompt() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ refinePrompt: DEFAULT_PROMPT }, (res) => {
      resolve(res.refinePrompt || DEFAULT_PROMPT);
    });
  });
}

function setBodyHtml(editor, text) {
  // Convert plain text (with blank-line paragraphs) into Gmail-style HTML.
  const paragraphs = text.split(/\n{2,}/).map((para) => {
    const lines = para.split(/\n/).map(escapeHtml).join("<br>");
    return `<div>${lines || "<br>"}</div>`;
  });
  editor.innerHTML = paragraphs.join('<div><br></div>');
  editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function getBodyText(editor) {
  // innerText preserves visible line breaks the way the user sees them.
  return editor.innerText.replace(/ /g, " ").trimEnd();
}

function injectButton(composeRoot) {
  if (composeRoot.hasAttribute(BUTTON_MARKER)) return;
  const toolbar = findToolbar(composeRoot);
  const editor = findBodyEditor(composeRoot);
  if (!toolbar || !editor) return;
  composeRoot.setAttribute(BUTTON_MARKER, "1");

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "refine-chatgpt-btn";
  btn.textContent = "Refine with ChatGPT";
  btn.title = "Rewrite this draft using your chatgpt.com account";

  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const original = getBodyText(editor);
    if (!original) {
      flash(btn, "Draft is empty", true);
      return;
    }
    const prompt = await getStoredPrompt();
    btn.disabled = true;
    const restoreLabel = btn.textContent;
    btn.textContent = "Refining…";

    chrome.runtime.sendMessage(
      { type: "REFINE_REQUEST", text: original, prompt },
      (res) => {
        btn.disabled = false;
        btn.textContent = restoreLabel;
        if (chrome.runtime.lastError) {
          flash(btn, chrome.runtime.lastError.message, true);
          return;
        }
        if (!res || !res.ok) {
          flash(btn, (res && res.error) || "Failed", true);
          return;
        }
        setBodyHtml(editor, res.text);
        flash(btn, "Refined ✓", false);
      }
    );
  });

  toolbar.appendChild(btn);
}

function flash(btn, msg, isError) {
  const tip = document.createElement("span");
  tip.className = "refine-chatgpt-tip" + (isError ? " err" : "");
  tip.textContent = msg;
  btn.parentElement.appendChild(tip);
  setTimeout(() => tip.remove(), 4000);
}

function scan() {
  for (const c of findComposeWindows()) injectButton(c);
}

const observer = new MutationObserver(() => scan());
observer.observe(document.body, { childList: true, subtree: true });
scan();
