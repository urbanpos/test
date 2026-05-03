// Injects a "Refine with ChatGPT" button into every Gmail compose window.
// Strategy: anchor on the body editor (most stable), walk up to the compose
// dialog, then try multiple toolbar selectors. If no toolbar is found, fall
// back to absolutely positioning the button on the compose dialog itself so
// it's visible no matter what.

const BUTTON_MARKER = "data-refine-chatgpt-injected";
const DEFAULT_PROMPT =
  "Refine the following email draft. Keep my intent and tone, fix grammar, " +
  "improve clarity and flow, and keep it concise. Return only the rewritten " +
  "email body with no preamble, commentary, or quotes.\n\n---\n\n";

function log(...args) { console.log("[RefineChatGPT]", ...args); }

function findBodyEditors() {
  const sels = [
    'div[role="textbox"][aria-label^="Message Body"]',
    'div[contenteditable="true"][aria-label^="Message Body"]',
    'div[contenteditable="true"][g_editable="true"]',
    'div[role="textbox"][contenteditable="true"][aria-multiline="true"]',
  ];
  let editors = [];
  for (const s of sels) {
    editors = editors.concat(Array.from(document.querySelectorAll(s)));
  }
  // Dedupe
  return Array.from(new Set(editors));
}

function findComposeRoot(editor) {
  return editor.closest('div[role="dialog"]')
      || editor.closest('form')
      || editor.parentElement;
}

function findSendButton(composeRoot) {
  const candidates = [
    'div[role="button"][data-tooltip^="Send"]',
    'div[role="button"][aria-label^="Send"]',
    'div.T-I.T-I-atl',
    'div.T-I-KE',
  ];
  for (const sel of candidates) {
    const el = composeRoot.querySelector(sel);
    if (el) return el;
  }
  // Last resort: scan all role="button" for textContent starting with Send.
  const all = composeRoot.querySelectorAll('[role="button"]');
  for (const el of all) {
    const t = (el.textContent || "").trim();
    if (t === "Send" || t.startsWith("Send ")) return el;
  }
  return null;
}

function findToolbar(composeRoot) {
  // Prefer Gmail's compose footer class if present.
  const btC = composeRoot.querySelector('.btC, .aDh, .IZ');
  if (btC) return btC;
  // Otherwise walk up from Send button to find a row with siblings.
  const send = findSendButton(composeRoot);
  if (send) {
    let el = send.parentElement;
    while (el && el !== composeRoot) {
      if (el.children.length >= 2) return el;
      el = el.parentElement;
    }
    return send.parentElement;
  }
  return null;
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
  return editor.innerText.replace(/ /g, " ").trimEnd();
}

function buildButton(editor) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "refine-chatgpt-btn";
  btn.textContent = "Refine with ChatGPT";
  btn.title = "Rewrite this draft using your chatgpt.com account";
  btn.addEventListener("click", (e) => onClick(e, btn, editor));
  return btn;
}

async function onClick(e, btn, editor) {
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
}

function injectButton(editor) {
  const composeRoot = findComposeRoot(editor);
  if (!composeRoot) return;
  if (composeRoot.hasAttribute(BUTTON_MARKER)) return;

  const btn = buildButton(editor);
  const toolbar = findToolbar(composeRoot);

  if (toolbar) {
    toolbar.appendChild(btn);
    log("injected into toolbar", toolbar);
  } else {
    // Floating fallback pinned to the compose dialog.
    btn.classList.add("refine-chatgpt-floating");
    if (getComputedStyle(composeRoot).position === "static") {
      composeRoot.style.position = "relative";
    }
    composeRoot.appendChild(btn);
    log("injected as floating button on", composeRoot);
  }
  composeRoot.setAttribute(BUTTON_MARKER, "1");
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
