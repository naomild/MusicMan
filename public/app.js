(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const STORE_KEY = "musicman.tasks.v1";
  const POLL_MS = 10000;               // poll every 10s
  const MAX_POLL_MS = 15 * 60 * 1000;  // give up after 15 minutes
  const FAIL_STATUSES = ["CREATE_TASK_FAILED", "GENERATE_AUDIO_FAILED", "CALLBACK_EXCEPTION", "SENSITIVE_WORD_ERROR", "GENERATE_LYRICS_FAILED"];
  const STATUS_TEXT = {
    SUBMITTED: "Submitted",
    PENDING: "Composing…",
    TEXT_SUCCESS: "Lyrics ready…",
    FIRST_SUCCESS: "First track ready…",
    SUCCESS: "Done",
    CREATE_TASK_FAILED: "Failed",
    GENERATE_AUDIO_FAILED: "Failed",
    CALLBACK_EXCEPTION: "Failed",
    SENSITIVE_WORD_ERROR: "Blocked",
    TIMEOUT: "Timed out",
  };

  let mode = "simple";
  let tasks = loadTasks();
  const pollers = {};

  // ---------- helpers ----------
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function safeUrl(u) {
    return typeof u === "string" && /^https?:\/\//i.test(u) ? u : "";
  }
  function fmtTime(sec) {
    sec = Math.round(Number(sec) || 0);
    return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
  }
  function loadTasks() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; }
  }
  function saveTasks() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(tasks.slice(0, 50))); } catch { /* storage unavailable */ }
  }
  async function api(path, opts = {}) {
    const res = await fetch("/api/" + path, {
      ...opts,
      headers: { "content-type": "application/json", ...(opts.headers || {}) },
    });
    let data;
    try { data = await res.json(); } catch { data = { code: res.status, msg: res.statusText }; }
    if (!res.ok || (data && data.code && data.code !== 200)) {
      const err = new Error(data?.msg || `Request failed (${res.status})`);
      err.code = data?.code || res.status;
      throw err;
    }
    return data;
  }
  function friendlyError(err) {
    const map = {
      401: "The API key was rejected. Check SUNO_API_KEY in Netlify.",
      405: "Rate limit hit — wait a moment and try again.",
      413: "Your prompt or lyrics are too long.",
      429: "Out of SunoAPI credits. Top up at sunoapi.org.",
      430: "Too many requests — please wait a bit and try again.",
      455: "SunoAPI is under maintenance. Try again later.",
    };
    return map[err.code] || err.message || "Something went wrong.";
  }
  // SunoAPI uses snake_case in record-info and camelCase in callbacks; accept both.
  function normTrack(t) {
    return {
      id: t.id,
      title: t.title || "Untitled",
      tags: t.tags || "",
      lyrics: t.prompt || "",
      duration: t.duration,
      image: safeUrl(t.image_url || t.imageUrl || t.source_image_url || t.sourceImageUrl),
      audio: safeUrl(t.audio_url || t.audioUrl || t.source_audio_url || t.sourceAudioUrl),
      stream: safeUrl(t.stream_audio_url || t.streamAudioUrl || t.source_stream_audio_url || t.sourceStreamAudioUrl),
    };
  }

  // ---------- form UI ----------
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      mode = btn.dataset.mode;
      document.querySelectorAll(".tab").forEach((b) => {
        b.classList.toggle("active", b === btn);
        b.setAttribute("aria-selected", b === btn);
      });
      document.querySelector(".mode-simple").classList.toggle("hidden", mode !== "simple");
      document.querySelector(".mode-custom").classList.toggle("hidden", mode !== "custom");
      $("formError").classList.add("hidden");
    });
  });

  const IDEAS = [
    "An upbeat summer pop song about road trips with friends",
    "A melancholic piano ballad about a city in the rain",
    "Energetic 80s synthwave about racing through neon streets",
    "A cozy acoustic folk song about Sunday mornings",
    "A hype hip-hop track about chasing your dreams",
  ];
  const STYLES = ["pop", "lo-fi", "rock", "hip-hop", "edm", "jazz", "acoustic", "r&b", "synthwave", "cinematic", "country", "reggaeton"];

  IDEAS.forEach((idea) => addChip($("ideaChips"), idea.split(" about ")[0].replace(/^An? /, ""), () => { $("prompt").value = idea; }));
  STYLES.forEach((s) => addChip($("styleChips"), s, () => {
    const cur = $("style").value.trim();
    const parts = cur ? cur.split(/\s*,\s*/) : [];
    if (!parts.includes(s)) parts.push(s);
    $("style").value = parts.join(", ");
  }));
  function addChip(container, label, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = label;
    b.addEventListener("click", onClick);
    container.appendChild(b);
  }

  const bindRange = (id, outId, fmt) => {
    const upd = () => { $(outId).textContent = fmt($(id).value); };
    $(id).addEventListener("input", upd);
    upd();
  };
  bindRange("duration", "durationVal", fmtTime);
  bindRange("styleWeight", "styleWeightVal", (v) => Number(v).toFixed(2));
  bindRange("weirdness", "weirdnessVal", (v) => Number(v).toFixed(2));

  $("lyrics").addEventListener("input", () => { $("lyricsCount").textContent = $("lyrics").value.length; });
  $("instrumental").addEventListener("change", () => {
    $("lyrics").disabled = $("instrumental").checked;
    $("lyrics").placeholder = $("instrumental").checked ? "Instrumental — lyrics are ignored" : "[Verse]\nNight city lights shining bright\n\n[Chorus]\n...";
  });

  // ---------- AI lyrics helper ----------
  $("lyricsToggle").addEventListener("click", () => $("lyricsHelper").classList.toggle("hidden"));
  $("lyricsBtn").addEventListener("click", async () => {
    const prompt = $("lyricsPrompt").value.trim();
    if (!prompt) { $("lyricsPrompt").focus(); return; }
    const btn = $("lyricsBtn");
    btn.disabled = true;
    btn.textContent = "Writing…";
    showError("");
    try {
      const start = await api("lyrics", { method: "POST", body: JSON.stringify({ prompt }) });
      const taskId = start.data?.taskId;
      if (!taskId) throw new Error("No task id returned");
      const started = Date.now();
      while (Date.now() - started < 5 * 60 * 1000) {
        await new Promise((r) => setTimeout(r, 5000));
        const res = await api("lyrics?taskId=" + encodeURIComponent(taskId));
        const d = res.data || {};
        if (FAIL_STATUSES.includes(d.status)) throw new Error(d.errorMessage || "Lyrics generation failed");
        const items = d.response?.data || d.response?.lyricsData || [];
        const done = items.find((x) => x && x.text);
        if (d.status === "SUCCESS" || done) {
          if (!done) throw new Error("No lyrics returned");
          $("lyrics").value = done.text;
          $("lyricsCount").textContent = done.text.length;
          if (done.title && !$("title").value) $("title").value = done.title.slice(0, 80);
          $("lyricsHelper").classList.add("hidden");
          return;
        }
      }
      throw new Error("Lyrics generation timed out");
    } catch (err) {
      showError(friendlyError(err));
    } finally {
      btn.disabled = false;
      btn.textContent = "Generate";
    }
  });

  function showError(msg) {
    $("formError").textContent = msg;
    $("formError").classList.toggle("hidden", !msg);
  }

  // ---------- generate ----------
  $("genForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    showError("");
    const instrumental = $("instrumental").checked;
    const body = { customMode: mode === "custom", instrumental, model: $("model").value, style: $("style").value.trim() };

    if (mode === "simple") {
      body.prompt = $("prompt").value.trim();
      if (!body.prompt && !body.style) return showError("Describe your song first.");
    } else {
      Object.assign(body, {
        title: $("title").value.trim(),
        lyrics: instrumental ? "" : $("lyrics").value.trim(),
        negativeTags: $("negativeTags").value.trim(),
        vocalGender: instrumental ? "" : $("vocalGender").value,
        duration: Number($("duration").value),
        styleWeight: Number($("styleWeight").value),
        weirdnessConstraint: Number($("weirdness").value),
        variety: Number($("variety").value),
      });
      if (!body.style && !body.lyrics && !body.negativeTags) return showError("Add a style or some lyrics.");
    }

    const btn = $("genBtn");
    btn.disabled = true;
    btn.textContent = "Submitting…";
    try {
      const res = await api("generate", { method: "POST", body: JSON.stringify(body) });
      const taskId = res.data?.taskId;
      if (!taskId) throw new Error("No task id returned");
      const task = {
        taskId,
        label: body.title || body.prompt || body.style || "Custom song",
        style: body.style,
        model: body.model,
        status: "SUBMITTED",
        tracks: [],
        createdAt: Date.now(),
      };
      tasks.unshift(task);
      saveTasks();
      render();
      poll(taskId);
      refreshCredits();
    } catch (err) {
      showError(friendlyError(err));
    } finally {
      btn.disabled = false;
      btn.textContent = "🎵 Generate music";
    }
  });

  // ---------- polling ----------
  function poll(taskId) {
    if (pollers[taskId]) return;
    const tick = async () => {
      const task = tasks.find((t) => t.taskId === taskId);
      if (!task) { delete pollers[taskId]; return; }
      try {
        const res = await api("status?taskId=" + encodeURIComponent(taskId));
        const d = res.data || {};
        if (d.status) task.status = d.status;
        const raw = d.response?.sunoData || d.response?.data || [];
        if (Array.isArray(raw) && raw.length) task.tracks = raw.map(normTrack);
        if (FAIL_STATUSES.includes(d.status)) {
          task.error = d.errorMessage || "Generation failed.";
          finish(taskId);
          return;
        }
        if (d.status === "SUCCESS") { finish(taskId); refreshCredits(); return; }
      } catch (err) {
        task.lastError = friendlyError(err);
      }
      if (Date.now() - task.createdAt > MAX_POLL_MS) {
        task.status = "TIMEOUT";
        task.error = "This is taking longer than usual. Use “Check again” in a bit.";
        finish(taskId);
        return;
      }
      saveTasks();
      render();
      pollers[taskId] = setTimeout(tick, POLL_MS);
    };
    pollers[taskId] = setTimeout(tick, 3000);
  }
  function finish(taskId) {
    clearTimeout(pollers[taskId]);
    delete pollers[taskId];
    saveTasks();
    render();
  }

  // ---------- rendering ----------
  function badge(status) {
    const cls = status === "SUCCESS" ? "done" : FAIL_STATUSES.includes(status) || status === "TIMEOUT" ? "failed" : "pending";
    return `<span class="badge ${cls}">${esc(STATUS_TEXT[status] || status)}</span>`;
  }
  function trackHtml(t, task) {
    const src = t.audio || t.stream;
    const ready = !!t.audio;
    const fname = (t.title || "track").replace(/[^\w\- ]+/g, "").trim() || "track";
    return `
      <article class="track">
        <div class="cover">
          ${t.image ? `<img src="${esc(t.image)}" alt="" loading="lazy" />` : ""}
          ${!src ? `<div class="spinner"></div>` : ""}
        </div>
        <div class="track-body">
          <div class="track-title">${esc(t.title)}${t.duration ? ` <span class="muted small">· ${fmtTime(t.duration)}</span>` : ""}</div>
          ${t.tags ? `<div class="track-tags">${esc(t.tags)}</div>` : ""}
          ${src ? `<audio controls preload="none" src="${esc(src)}"></audio>` : `<div class="placeholder-line"></div><div class="muted small">Generating audio…</div>`}
          ${src && !ready ? `<div class="muted small">Streaming preview — final file still rendering</div>` : ""}
          <div class="track-links">
            ${ready ? `<a href="${esc(t.audio)}" download="${esc(fname)}.mp3" target="_blank" rel="noopener">⬇ Download MP3</a>` : ""}
            ${t.image ? `<a href="${esc(t.image)}" target="_blank" rel="noopener">🖼 Cover</a>` : ""}
            ${t.lyrics && t.lyrics.trim() ? `<button type="button" data-lyrics="${esc(task.taskId)}:${esc(t.id)}">📝 Lyrics</button>` : ""}
          </div>
          <div class="lyrics-view hidden" id="ly-${esc(task.taskId)}-${esc(t.id)}">${esc(t.lyrics)}</div>
        </div>
      </article>`;
  }
  function render() {
    $("empty").classList.toggle("hidden", tasks.length > 0);
    $("tasks").innerHTML = tasks.map((task) => {
      const pending = !task.tracks.length && !task.error;
      const placeholders = pending ? [0, 1].map(() => trackHtml({ id: "p", title: "Composing…" }, task)).join("") : "";
      const canRetry = task.status === "TIMEOUT" || (task.lastError && !pollers[task.taskId]);
      return `
        <div class="task">
          <div class="task-head">
            <div class="task-prompt" title="${esc(task.label)}">${esc(task.label)}</div>
            ${badge(task.status)}
          </div>
          ${task.error ? `<p class="task-error">${esc(task.error)}</p>` : ""}
          <div class="tracks">${task.tracks.map((t) => trackHtml(t, task)).join("") || placeholders}</div>
          <div class="task-actions">
            ${canRetry ? `<button class="link" data-retry="${esc(task.taskId)}">↻ Check again</button>` : ""}
            <button class="link" data-remove="${esc(task.taskId)}">Remove</button>
          </div>
        </div>`;
    }).join("");
  }

  $("tasks").addEventListener("click", (e) => {
    const el = e.target.closest("button");
    if (!el) return;
    if (el.dataset.lyrics) {
      const [tid, id] = el.dataset.lyrics.split(":");
      document.getElementById(`ly-${tid}-${id}`)?.classList.toggle("hidden");
    } else if (el.dataset.remove) {
      finish(el.dataset.remove);
      tasks = tasks.filter((t) => t.taskId !== el.dataset.remove);
      saveTasks();
      render();
    } else if (el.dataset.retry) {
      const task = tasks.find((t) => t.taskId === el.dataset.retry);
      if (task) {
        task.createdAt = Date.now();
        task.error = "";
        task.lastError = "";
        task.status = "PENDING";
        render();
        poll(task.taskId);
      }
    }
  });

  $("clearBtn").addEventListener("click", () => {
    if (!tasks.length || !confirm("Clear all tracks from this page? (Download anything you want to keep first.)")) return;
    Object.keys(pollers).forEach(finish);
    tasks = [];
    saveTasks();
    render();
  });

  // ---------- credits ----------
  async function refreshCredits() {
    try {
      const res = await api("credits");
      $("credits").textContent = "Credits: " + (typeof res.data === "number" ? res.data.toLocaleString() : res.data);
    } catch {
      $("credits").textContent = "Credits: —";
    }
  }

  // ---------- boot ----------
  render();
  refreshCredits();
  tasks.forEach((t) => {
    if (!["SUCCESS", "TIMEOUT"].includes(t.status) && !FAIL_STATUSES.includes(t.status)) poll(t.taskId);
  });
})();
