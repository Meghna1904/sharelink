/* ── State ────────────────────────────────────────────────────────────── */
const session = { name: "", code: "", links: [] };

// Two stable partner colors cycled by insertion order of unique names
const PARTNER_COLORS = [
  { dot: "#4f7c6a", bg: "var(--p1-bg)" },
  { dot: "#9b4f6a", bg: "var(--p2-bg)" },
  { dot: "#5561a4", bg: "var(--p3-bg)" },
  { dot: "#7c6a3a", bg: "var(--p4-bg)" },
];
const partnerColorMap = new Map();

function partnerColor(name) {
  if (!partnerColorMap.has(name)) {
    const idx = partnerColorMap.size % PARTNER_COLORS.length;
    partnerColorMap.set(name, PARTNER_COLORS[idx]);
  }
  return partnerColorMap.get(name);
}

/* ── DOM refs ─────────────────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);
const el = {
  loginView:         $("loginView"),
  appView:           $("appView"),
  loginForm:         $("loginForm"),
  loginError:        $("loginError"),
  loginSubmitBtn:    $("loginSubmitBtn"),
  partnerName:       $("partnerName"),
  coupleCode:        $("coupleCode"),
  logoutButton:      $("logoutButton"),
  spaceLabel:        $("spaceLabel"),
  linkForm:          $("linkForm"),
  editingId:         $("editingId"),
  urlInput:          $("urlInput"),
  titleInput:        $("titleInput"),
  noteInput:         $("noteInput"),
  linkError:         $("linkError"),
  saveButton:        $("saveButton"),
  saveBtnLabel:      $("saveBtnLabel"),
  cancelEditButton:  $("cancelEditButton"),
  composerExtra:     $("composerExtra"),
  emptyState:        $("emptyState"),
  linkFeed:          $("linkFeed"),
  listStatus:        $("listStatus"),
  confirmDialog:     $("confirmDialog"),
  confirmMsg:        $("confirmMsg"),
  tplDayGroup:       $("tplDayGroup"),
  tplLink:           $("linkTemplate"),
};

/* ── Boot ─────────────────────────────────────────────────────────────── */
restoreSession();
wireEvents();

function wireEvents() {
  // Login
  el.loginForm.addEventListener("submit", onLogin);

  // Logout
  el.logoutButton.addEventListener("click", onLogout);

  // Link form
  el.linkForm.addEventListener("submit", onSaveLink);
  el.cancelEditButton.addEventListener("click", resetComposer);

  // Expand composer on URL focus
  el.urlInput.addEventListener("focus", () => {
    el.composerExtra.classList.remove("hidden");
  });

  // Delegate edit / delete clicks on the feed
  el.linkFeed.addEventListener("click", onFeedClick);
}

/* ── Login / logout ───────────────────────────────────────────────────── */
async function onLogin(e) {
  e.preventDefault();
  clearError(el.loginError);

  const name = el.partnerName.value.trim();
  const code = el.coupleCode.value.trim();

  if (!name) return showError(el.loginError, "Please enter your name.");
  if (!code) return showError(el.loginError, "Please enter the shared code.");

  await withBusy(el.loginSubmitBtn, async () => {
    const data = await api("/api/session", {
      method: "POST",
      body: { name, code },
      includeAuth: false,
    });
    session.name = data.partnerName;
    session.code = code;
    localStorage.setItem("sl.session", JSON.stringify({ name: session.name, code }));
    showApp();
    await loadLinks();
  }, el.loginError);
}

function onLogout() {
  localStorage.removeItem("sl.session");
  session.name = "";
  session.code = "";
  session.links = [];
  partnerColorMap.clear();
  el.appView.classList.add("hidden");
  el.loginView.classList.remove("hidden");
  el.partnerName.value = "";
  el.coupleCode.value = "";
  el.partnerName.focus();
  resetComposer();
}

function restoreSession() {
  try {
    const saved = JSON.parse(localStorage.getItem("sl.session") ?? "null");
    if (saved?.name && saved?.code) {
      session.name = saved.name;
      session.code = saved.code;
      showApp();
      loadLinks().catch(() => {
        localStorage.removeItem("sl.session");
        el.appView.classList.add("hidden");
        el.loginView.classList.remove("hidden");
        showError(el.loginError, "Session expired. Please enter your details again.");
        el.partnerName.focus();
      });
    }
  } catch {
    localStorage.removeItem("sl.session");
  }
}

/* ── App view setup ───────────────────────────────────────────────────── */
function showApp() {
  el.loginView.classList.add("hidden");
  el.appView.classList.remove("hidden");
  el.spaceLabel.textContent = `You are ${session.name}`;
  el.urlInput.focus();
}

/* ── Load + render links ─────────────────────────────────────────────── */
async function loadLinks() {
  setStatus("Loading…");
  const data = await api("/api/links");
  session.links = data.links;
  renderFeed();
  clearStatus();
}

function renderFeed() {
  el.linkFeed.textContent = "";
  el.emptyState.classList.toggle("hidden", session.links.length > 0);

  if (!session.links.length) return;

  // Group by calendar day
  const groups = new Map();
  for (const link of session.links) {
    const dayKey = toDayKey(link.createdAt);
    if (!groups.has(dayKey)) groups.set(dayKey, { label: toDayLabel(link.createdAt), links: [] });
    groups.get(dayKey).links.push(link);
  }

  for (const { label, links } of groups.values()) {
    const groupFrag = el.tplDayGroup.content.cloneNode(true);
    groupFrag.querySelector(".day-label").textContent = label;
    const container = groupFrag.querySelector(".day-items");
    for (const link of links) {
      container.append(buildLinkItem(link));
    }
    el.linkFeed.append(groupFrag);
  }
}

function buildLinkItem(link) {
  const frag = el.tplLink.content.cloneNode(true);
  const item     = frag.querySelector(".link-item");
  const dot      = frag.querySelector(".saver-dot");
  const title    = frag.querySelector(".link-title");
  const domain   = frag.querySelector(".link-domain");
  const note     = frag.querySelector(".link-note");
  const meta     = frag.querySelector(".link-meta");
  const editBtn  = frag.querySelector(".edit-link");
  const delBtn   = frag.querySelector(".delete-link");

  item.dataset.id = link.id;

  // Partner color
  const color = partnerColor(link.saverName);
  dot.style.background = color.dot;
  dot.setAttribute("title", `Saved by ${link.saverName}`);
  dot.setAttribute("aria-label", `Saved by ${link.saverName}`);

  // Link content
  title.href = link.url;
  title.textContent = link.title || link.url;
  domain.textContent = domainOf(link.url);
  note.textContent = link.note;
  meta.textContent = `${link.saverName} · ${formatDate(link.createdAt)}`;

  // Controls — only show if this is the saver
  const isMine = link.saverName === session.name;
  editBtn.classList.toggle("hidden", !isMine);
  delBtn.classList.toggle("hidden", !isMine);

  return frag;
}

/* ── Feed click delegation ────────────────────────────────────────────── */
async function onFeedClick(e) {
  const editBtn = e.target.closest(".edit-link");
  const delBtn  = e.target.closest(".delete-link");
  const item    = e.target.closest(".link-item");

  if (!item) return;
  const link = session.links.find((l) => l.id === Number(item.dataset.id));
  if (!link) return;

  if (editBtn) startEdit(link);

  if (delBtn) {
    const confirmed = await showConfirm(`Delete "${link.title || link.url}"? This cannot be undone.`);
    if (!confirmed) return;
    try {
      await api(`/api/links/${link.id}`, { method: "DELETE" });
      await loadLinks();
    } catch (err) {
      setStatus(`Could not delete: ${err.message}`);
    }
  }
}

/* ── Composer ─────────────────────────────────────────────────────────── */
async function onSaveLink(e) {
  e.preventDefault();
  clearError(el.linkError);

  const body = {
    url:   el.urlInput.value.trim(),
    title: el.titleInput.value.trim(),
    note:  el.noteInput.value.trim(),
  };

  const editingId = el.editingId.value;
  const path   = editingId ? `/api/links/${editingId}` : "/api/links";
  const method = editingId ? "PATCH" : "POST";

  // Show fetching status when creating without explicit title
  if (!editingId && !body.title) {
    setStatus("Fetching page title…", true);
  }

  await withBusy(el.saveButton, async () => {
    await api(path, { method, body });
    resetComposer();
    await loadLinks();
  }, el.linkError);

  clearStatus();
}

function startEdit(link) {
  el.editingId.value  = link.id;
  el.urlInput.value   = link.url;
  el.titleInput.value = link.title;
  el.noteInput.value  = link.note;
  el.saveBtnLabel.textContent = "Save changes";
  el.cancelEditButton.classList.remove("hidden");
  el.composerExtra.classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
  requestAnimationFrame(() => el.urlInput.focus());
}

function resetComposer() {
  el.linkForm.reset();
  el.editingId.value = "";
  el.saveBtnLabel.textContent = "Save";
  el.cancelEditButton.classList.add("hidden");
  el.composerExtra.classList.add("hidden");
  clearError(el.linkError);
  el.urlInput.removeAttribute("aria-invalid");
}

/* ── Delete confirm dialog ────────────────────────────────────────────── */
function showConfirm(message) {
  return new Promise((resolve) => {
    el.confirmMsg.textContent = message;
    el.confirmDialog.showModal();
    el.confirmDialog.addEventListener(
      "close",
      () => resolve(el.confirmDialog.returnValue === "confirm"),
      { once: true }
    );
  });
}

/* ── Status bar ───────────────────────────────────────────────────────── */
function setStatus(msg, fetching = false) {
  el.listStatus.textContent = msg;
  el.listStatus.classList.toggle("is-fetching", fetching);
}
function clearStatus() {
  el.listStatus.textContent = "";
  el.listStatus.classList.remove("is-fetching");
}

/* ── Busy button ──────────────────────────────────────────────────────── */
async function withBusy(btn, action, errEl) {
  btn.disabled = true;
  btn.classList.add("is-loading");
  try {
    await action();
  } catch (err) {
    if (errEl) showError(errEl, err.message);
  } finally {
    btn.disabled = false;
    btn.classList.remove("is-loading");
  }
}

/* ── Error helpers ────────────────────────────────────────────────────── */
function showError(el, msg) { el.textContent = msg; }
function clearError(el)     { el.textContent = ""; }

/* ── API ──────────────────────────────────────────────────────────────── */
async function api(path, opts = {}) {
  const headers = { "content-type": "application/json" };
  if (opts.includeAuth !== false) {
    headers["x-partner-name"] = session.name;
    headers["x-couple-code"]  = session.code;
  }

  const res = await fetch(path, {
    method:  opts.method ?? "GET",
    headers,
    body:    opts.body ? JSON.stringify(opts.body) : undefined,
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error ?? "Request failed.");
  return payload;
}

/* ── Date helpers ─────────────────────────────────────────────────────── */
function isoToDate(value) {
  // Postgres returns strings with or without trailing Z
  return new Date(value.endsWith("Z") ? value : value + "Z");
}

function toDayKey(value) {
  const d = isoToDate(value);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function toDayLabel(value) {
  const d = isoToDate(value);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yesterday)) return "Yesterday";

  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month:   "long",
    day:     "numeric",
  }).format(d);
}

function formatDate(value) {
  const d = isoToDate(value);
  return new Intl.DateTimeFormat(undefined, {
    hour:   "numeric",
    minute: "2-digit",
  }).format(d);
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth()    === b.getMonth()    &&
         a.getDate()     === b.getDate();
}

/* ── URL helper ───────────────────────────────────────────────────────── */
function domainOf(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
