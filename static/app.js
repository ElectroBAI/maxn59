(function () {
  "use strict";

  const history = [];
  let attachedFile = null;
  let isRecording = false;
  let mediaRecorder = null;
  let audioChunks = [];
  let isSending = false;

  const landing = document.getElementById("landing");
  const chatView = document.getElementById("chat-view");
  const chatThread = document.getElementById("chat-thread");
  const errorToast = document.getElementById("error-toast");
  const statusPill = document.getElementById("status-pill");
  const statusText = document.getElementById("status-text");
  const statusDot = document.getElementById("status-dot");

  const landingInput = document.getElementById("landing-input");
  const chatInput = document.getElementById("chat-input");
  const landingSend = document.getElementById("landing-send");
  const chatSend = document.getElementById("chat-send");
  const filePreview = document.getElementById("file-preview");
  const landingFilePreview = document.getElementById("landing-file-preview");
  const fileInput = document.getElementById("file-input");
  const inputCard = document.getElementById("input-card");

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function showError(msg) {
    errorToast.textContent = msg;
    errorToast.classList.add("visible");
    setTimeout(() => errorToast.classList.remove("visible"), 5000);
  }

  function setStatus(state) {
    statusPill.classList.remove("busy", "error");
    statusDot.classList.remove("busy", "error");
    if (state === "busy") {
      statusPill.classList.add("busy");
      statusDot.classList.add("busy");
      statusText.textContent = "Working";
    } else if (state === "recording") {
      statusPill.classList.add("busy");
      statusDot.classList.add("busy");
      statusText.textContent = "Recording";
    } else if (state === "error") {
      statusPill.classList.add("error");
      statusDot.classList.add("error");
      statusText.textContent = "Error";
      setTimeout(() => setStatus("ready"), 3000);
    } else {
      statusText.textContent = "Ready";
    }
  }

  function formatTime(d) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    return (bytes / 1024).toFixed(0) + " KB";
  }

  function switchToChat() {
    landing.classList.add("hidden");
    chatView.classList.add("active");
  }

  function getActiveInput() {
    return chatView.classList.contains("active") ? chatInput : landingInput;
  }

  function autoResize(textarea) {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 160) + "px";
  }

  function syncSendButtons() {
    const val = getActiveInput().value.trim();
    const hasContent = val.length > 0 || attachedFile !== null;
    landingSend.disabled = !hasContent || isSending;
    chatSend.disabled = !hasContent || isSending;
  }

  function renderFilePreviewEl(el, file) {
    if (!el || !file) return;
    el.classList.add("visible");
    el.querySelector(".fname").textContent = file.name;
    el.querySelector(".fmeta").textContent =
      formatSize(file.size) + " \u2022 Image equation ready";
  }

  function updateFilePreview() {
    if (!attachedFile) {
      filePreview.classList.remove("visible");
      landingFilePreview.classList.remove("visible");
      inputCard.classList.remove("has-attachment");
      return;
    }
    renderFilePreviewEl(filePreview, attachedFile);
    renderFilePreviewEl(landingFilePreview, attachedFile);
    inputCard.classList.add("has-attachment");
  }

  function attachFile(file) {
    if (!file || !file.type.startsWith("image/")) {
      showError("Please select a valid image file (JPEG, PNG, GIF, or WebP).");
      return;
    }
    attachedFile = file;
    updateFilePreview();
    syncSendButtons();
    getActiveInput().focus();
  }

  function clearAttachment() {
    attachedFile = null;
    fileInput.value = "";
    updateFilePreview();
    syncSendButtons();
  }

  function parseMathSegments(text) {
    const segments = [];
    const pattern = /(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\))/g;
    let lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ type: "text", content: text.slice(lastIndex, match.index) });
      }
      segments.push({ type: "math", content: match[0] });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      segments.push({ type: "text", content: text.slice(lastIndex) });
    }
    return segments.length ? segments : [{ type: "text", content: text }];
  }

  function renderMathLatex(raw) {
    if (typeof katex === "undefined") {
      return `<span class="math-fallback">${escapeHtml(raw)}</span>`;
    }
    let tex = raw;
    let displayMode = false;
    if (raw.startsWith("$$") && raw.endsWith("$$")) {
      tex = raw.slice(2, -2).trim();
      displayMode = true;
    } else if (raw.startsWith("\\[") && raw.endsWith("\\]")) {
      tex = raw.slice(2, -2).trim();
      displayMode = true;
    } else if (raw.startsWith("\\(") && raw.endsWith("\\)")) {
      tex = raw.slice(2, -2).trim();
      displayMode = false;
    }
    try {
      return katex.renderToString(tex, {
        displayMode,
        throwOnError: false,
        strict: "ignore",
        trust: false,
      });
    } catch {
      return `<span class="math-fallback">${escapeHtml(raw)}</span>`;
    }
  }

  function formatInlineText(line) {
    let html = escapeHtml(line);
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    return html;
  }

  function formatTextBlock(text) {
    const lines = text.split("\n");
    const parts = [];
    let paragraph = [];

    function flushParagraph() {
      if (!paragraph.length) return;
      const joined = paragraph.join(" ").trim();
      if (joined) parts.push(`<p>${formatInlineText(joined)}</p>`);
      paragraph = [];
    }

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        flushParagraph();
        continue;
      }
      const h3 = trimmed.match(/^###\s+(.+)$/);
      const h2 = trimmed.match(/^##\s+(.+)$/);
      const h1 = trimmed.match(/^#\s+(.+)$/);
      if (h3) {
        flushParagraph();
        parts.push(`<h3 class="md-heading">${formatInlineText(h3[1])}</h3>`);
      } else if (h2) {
        flushParagraph();
        parts.push(`<h2 class="md-heading">${formatInlineText(h2[1])}</h2>`);
      } else if (h1) {
        flushParagraph();
        parts.push(`<h1 class="md-heading">${formatInlineText(h1[1])}</h1>`);
      } else if (/^STEP\s+\d+:/i.test(trimmed)) {
        flushParagraph();
        parts.push(`<strong class="step-heading">${formatInlineText(trimmed)}</strong>`);
      } else if (/^[-*]\s+/.test(trimmed)) {
        flushParagraph();
        parts.push(`<p class="list-item">${formatInlineText(trimmed.replace(/^[-*]\s+/, ""))}</p>`);
      } else {
        paragraph.push(trimmed);
      }
    }
    flushParagraph();
    return parts.join("");
  }

  function formatAssistantContent(text) {
    return parseMathSegments(text)
      .map((seg) => {
        if (seg.type === "math") {
          const rendered = renderMathLatex(seg.content);
          const isDisplay =
            seg.content.startsWith("$$") || seg.content.startsWith("\\[");
          return isDisplay
            ? `<div class="math-block">${rendered}</div>`
            : rendered;
        }
        return formatTextBlock(seg.content);
      })
      .join("");
  }

  function getResolvedTheme() {
    const explicit = document.documentElement.getAttribute("data-theme");
    if (explicit === "light" || explicit === "dark") return explicit;
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  function applyThemeClass() {
    document.documentElement.classList.toggle(
      "is-dark",
      getResolvedTheme() === "dark"
    );
  }

  function initTheme() {
    applyThemeClass();
    const toggle = document.getElementById("theme-toggle");
    if (!toggle) return;
    toggle.addEventListener("click", () => {
      const next = getResolvedTheme() === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("maxn59-theme", next);
      applyThemeClass();
    });
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", () => {
        if (!localStorage.getItem("maxn59-theme")) applyThemeClass();
      });
  }

  function appendUserMessage(text, attachment) {
    const wrap = document.createElement("div");
    wrap.className = "msg-user";

    let chipHtml = "";
    if (attachment) {
      const safeName = escapeHtml(attachment.name);
      chipHtml = `<div class="attachment-chip">
        <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
        <div><div class="fname">${safeName}</div><div class="fcap">Attached handwritten equation</div></div>
      </div>`;
    }

    wrap.innerHTML = `
      <div class="bubble">${chipHtml}${escapeHtml(text).replace(/\n/g, "<br>")}</div>
      <div class="msg-time">${formatTime(new Date())}</div>`;
    chatThread.appendChild(wrap);
    scrollToBottom();
    return wrap;
  }

  function appendAssistantMessage(text) {
    const wrap = document.createElement("div");
    wrap.className = "msg-assistant";
    wrap.innerHTML = `
      <div class="assistant-card">
        <div class="assistant-header">
          <div class="assistant-avatar">M</div>
          <span class="assistant-name">MAXN59</span>
          <span class="solution-tag">Solution</span>
        </div>
        <div class="assistant-body"></div>
      </div>`;
    const body = wrap.querySelector(".assistant-body");
    body.innerHTML = formatAssistantContent(text);
    chatThread.appendChild(wrap);
    scrollToBottom();
  }

  function appendErrorMessage(msg) {
    const wrap = document.createElement("div");
    wrap.className = "msg-error";
    wrap.innerHTML = `<span>${escapeHtml(msg)}</span>`;
    chatThread.appendChild(wrap);
    scrollToBottom();
    return wrap;
  }

  function scrollToBottom() {
    chatThread.scrollTop = chatThread.scrollHeight;
  }

  function showThinking(label) {
    const el = document.createElement("div");
    el.className = "thinking";
    el.id = "thinking-indicator";
    el.innerHTML = `<div class="thinking-dots"><span></span><span></span><span></span></div> ${label || "MAXN59 is working"}`;
    chatThread.appendChild(el);
    scrollToBottom();
  }

  function hideThinking() {
    const el = document.getElementById("thinking-indicator");
    if (el) el.remove();
  }

  async function parseJsonResponse(resp) {
    try {
      return await resp.json();
    } catch {
      throw new Error("Server returned an invalid response. Please try again.");
    }
  }

  async function sendMessage() {
    if (isSending) return;

    const input = getActiveInput();
    const text = input.value.trim();
    if (!text && !attachedFile) return;

    isSending = true;
    setStatus("busy");
    syncSendButtons();

    if (!chatView.classList.contains("active")) {
      switchToChat();
    }

    const file = attachedFile;
    const displayText = text || "Analyze the attached equation.";
    const userMsgEl = appendUserMessage(displayText, file);
    showThinking(file ? "Analyzing image" : "MAXN59 is working");

    input.value = "";
    autoResize(input);
    clearAttachment();

    try {
      let data;
      if (file) {
        const form = new FormData();
        form.append("image", file);
        if (text) form.append("caption", text);
        const resp = await fetch("/api/chat/image", { method: "POST", body: form });
        data = await parseJsonResponse(resp);
        if (!resp.ok) throw new Error(data.error || "Image request failed.");
        if (!data.response) throw new Error("Empty response from server.");
        history.push({ role: "user", content: `[Image: ${file.name}] ${displayText}` });
      } else {
        const resp = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, history }),
        });
        data = await parseJsonResponse(resp);
        if (!resp.ok) throw new Error(data.error || "Chat request failed.");
        if (!data.response) throw new Error("Empty response from server.");
        history.push({ role: "user", content: text });
      }

      history.push({ role: "assistant", content: data.response });
      hideThinking();
      appendAssistantMessage(data.response);
      setStatus("ready");
    } catch (err) {
      hideThinking();
      userMsgEl.remove();
      setStatus("error");
      showError(err.message);
      if (chatView.classList.contains("active")) {
        appendErrorMessage(err.message);
      }
    } finally {
      isSending = false;
      syncSendButtons();
    }
  }

  async function startRecording(btn) {
    if (isSending) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        btn.classList.remove("recording");
        isRecording = false;

        const blob = new Blob(audioChunks, { type: "audio/webm" });
        if (blob.size < 100) {
          setStatus("ready");
          showError("Recording too short. Please try again.");
          return;
        }

        if (!chatView.classList.contains("active")) switchToChat();
        isSending = true;
        setStatus("busy");
        syncSendButtons();
        showThinking("Transcribing audio");

        try {
          const form = new FormData();
          form.append("audio", blob, "recording.webm");
          form.append("history", JSON.stringify(history));
          const resp = await fetch("/api/chat/voice", { method: "POST", body: form });
          const data = await parseJsonResponse(resp);
          if (!resp.ok) throw new Error(data.error || "Voice request failed.");
          if (!data.transcript) throw new Error("Could not transcribe audio.");
          if (!data.response) throw new Error("Empty response from server.");

          hideThinking();
          appendUserMessage(data.transcript, null);
          showThinking("MAXN59 is working");
          history.push({ role: "user", content: data.transcript });
          history.push({ role: "assistant", content: data.response });
          hideThinking();
          appendAssistantMessage(data.response);
          setStatus("ready");
        } catch (err) {
          hideThinking();
          setStatus("error");
          showError(err.message);
          appendErrorMessage(err.message);
        } finally {
          isSending = false;
          syncSendButtons();
        }
      };
      mediaRecorder.start();
      isRecording = true;
      btn.classList.add("recording");
      setStatus("recording");
    } catch {
      setStatus("error");
      showError("Microphone access denied. Please allow microphone permissions.");
    }
  }

  function stopRecording(btn) {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
    btn.classList.remove("recording");
    isRecording = false;
  }

  function setupMic(btn) {
    btn.addEventListener("click", () => {
      if (isRecording) stopRecording(btn);
      else startRecording(btn);
    });
  }

  function setupInput(input, sendBtn) {
    input.addEventListener("input", () => {
      autoResize(input);
      syncSendButtons();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    sendBtn.addEventListener("click", sendMessage);
  }

  function setupDragDrop(el) {
    el.addEventListener("dragover", (e) => {
      e.preventDefault();
      el.classList.add("drag-over");
    });
    el.addEventListener("dragleave", () => el.classList.remove("drag-over"));
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      el.classList.remove("drag-over");
      if (e.dataTransfer.files[0]) attachFile(e.dataTransfer.files[0]);
    });
  }

  document.querySelectorAll(".file-btn").forEach((btn) => {
    btn.addEventListener("click", () => fileInput.click());
  });

  document.querySelectorAll(".remove-file-btn").forEach((btn) => {
    btn.addEventListener("click", clearAttachment);
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) attachFile(fileInput.files[0]);
  });

  document.querySelectorAll(".mic-btn").forEach(setupMic);
  setupInput(landingInput, landingSend);
  setupInput(chatInput, chatSend);
  setupDragDrop(inputCard);
  setupDragDrop(landingInput);
  setupDragDrop(chatInput.closest(".input-bar"));

  document.querySelectorAll(".example-card").forEach((card) => {
    card.addEventListener("click", () => {
      const query = card.dataset.query;
      getActiveInput().value = query;
      autoResize(getActiveInput());
      syncSendButtons();
      getActiveInput().focus();
    });
  });

  document.querySelectorAll(".insert-math-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = getActiveInput();
      const start = input.selectionStart;
      const end = input.selectionEnd;
      const val = input.value;
      input.value = val.slice(0, start) + "$$  $$" + val.slice(end);
      input.selectionStart = input.selectionEnd = start + 3;
      input.focus();
      autoResize(input);
      syncSendButtons();
    });
  });

  initTheme();
  syncSendButtons();
})();
