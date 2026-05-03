// Injects a "Refine with ChatGPT" button into every Gmail compose window.
// Strategy: find the body editor (most stable selector), walk up to the compose
// root, then find the bottom toolbar (.btC) where Send lives.

const BUTTON_MARKER = "data-refine-chatgpt-injected";
const DEFAULT_PROMPT =
  "Refine the following email draft. Keep my intent and tone, fix grammar, " +
  "improve clarity and flow, and keep it concise. Return only the rewritten " +
  "email body with no preamble, commentary, or quotes.\n\n---\n\n";

function log(...args) { console.log("[RefineChatGPT]", ...args); }

function findBodyEditors() {
  // The body editor is the most stable anchor across Gmail UI variants.
  // It's a contenteditable div with aria-label starting with "Message Body".
  let editors = Array.from(document.querySelectorAll(
    'div[role="textbox"][aria-label^="Message Body"], ' +
    'div[contenteditable="true"][aria-label^="Message Body"], ' +
    'div[contenteditable="true"][g_editable="true"]'
  ));
  if (editors.length === 0) {
    // Localized fallback: any contenteditable inside a compose form.
    editors = Array.from(document.querySelectorAll(
      'form[enctype] div[contenteditable="true"]'
    ));
  }
  return editors;
}

function findComposeRoot(editor) {
  // Walk up to the dialog or form that wraps the whole compose window.
  return editor.closest('div[role="dialog"]')
      || editor.closest('form')
      || editor.parentElement;
}

function findToolbar(composeRoot) {
  // .btC is Gmail's compose footer (Send button + formatting + attach).
  // Fall back to the row containing a Send button identified by class or aria.
  let tb = composeRoot.querySelector('.btC');
  if (tb) return tb;

  const send = findSendButton(composeRoot);
  if (send) {
    // Walk up a couple levels to land on the toolbar row.
    let el = send;
    for (let i = 0; i < 5 && el; i++) {
      if (el.children && el.children.length >= 2) return el;
      el = el.parentElement;
    }
    return send.parentElement;
  }
  return null;
}

function findSendButton(composeRoot) {
  return composeRoot.querySelector(
    'div[role="button"][data-tooltip^="Send"], ' +
    'div[role="button"][aria-label^="Send"], ' +
    'div.T-I.T-I-atl, ' +
    'div.T-I-KE'
  );
}

async function getStoredPrompt() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ refinePrompt: DEFAULT_PROMPT }, (res) => {
      resolve(res.refinePrompt || DEFAULT_PROMPT);
    });
  });
}

function setBodyHtml(editor, text) {
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
  return editor.innerText.replace(/ /g, " ").trimEnd();
}

function injectButton(editor) {
  const composeRoot = findComposeRoot(editor);
  if (!composeRoot) return;
  if (composeRoot.hasAttribute(BUTTON_MARKER)) return;
  const toolbar = findToolbar(composeRoot);
  if (!toolbar) {
    log("toolbar not found for compose", composeRoot);
    return;
  }
  composeRoot.setAttribute(BUTTON_MARKER, "1");
  log("injecting into toolbar", toolbar);

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
  for (const editor of findBodyEditors()) {
    try { injectButton(editor); } catch (err) { log("inject error", err); }
  }
}

const observer = new MutationObserver(() => scan());
observer.observe(document.body, { childList: true, subtree: true });
scan();
log("content script loaded");
