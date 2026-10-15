/* ══════════════════════════════════════════════════════════════════════
   ShareLink — frontend  v2
   Quiet editorial feed: timeline by day, partner initial badges,
   skeleton loading, staggered entrance, refined state management.
══════════════════════════════════════════════════════════════════════ */

/* ── Session state ────────────────────────────────────────────────────── */
const session = { name: "", code: "", links: [] };
let favoritesOnly = false;

/* ── Partner color palette (cycled by insertion order of unique names) ── */
const PARTNER_PALETTE = [
  { fg: "var(--p1)",      bg: "var(--p1-soft)" },   // sage
  { fg: "var(--p2)",      bg: "var(--p2-soft)" },   // rose
  { fg: "var(--p3)",      bg: "var(--p3-soft)" },   // slate
  { fg: "var(--p4)",      bg: "var(--p4-soft)" },   // ochre
];

const partnerColorMap = new Map();

function partnerColor(name) {
  if (!partnerColorMap.has(name)) {
    const idx = partnerColorMap.size % PARTNER_PALETTE.length;
    partnerColorMap.set(name, PARTNER_PALETTE[idx]);
  }
  return partnerColorMap.get(name);
}

function nameInitial(name) {
  return (name || "?").trim().charAt(0).toUpperCase();
}

/* ── DOM refs ─────────────────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);

const el = {
  loginView:        $("loginView"),
  appView:          $("appView"),
  loginForm:        $("loginForm"),
  loginError:       $("loginError"),
  loginSubmitBtn:   $("loginSubmitBtn"),
  partnerName:      $("partnerName"),
  coupleCode:       $("coupleCode"),
  logoutButton:     $("logoutButton"),
  spaceLabel:       $("spaceLabel"),
  linkForm:         $("linkForm"),
  editingId:        $("editingId"),
  urlInput:         $("urlInput"),
  titleInput:       $("titleInput"),
  noteInput:        $("noteInput"),
  tagsInput:        $("tagsInput"),
  linkError:        $("linkError"),
  saveButton:       $("saveButton"),
  saveBtnLabel:     $("saveBtnLabel"),
  cancelEditButton: $("cancelEditButton"),
  composerExtra:    $("composerExtra"),
  emptyState:       $("emptyState"),
  linkFeed:         $("linkFeed"),
  skeletonFeed:     $("skeletonFeed"),
  listStatus:       $("listStatus"),
  searchInput:      $("searchInput"),
  favoritesFilter:  $("favoritesFilter"),
  noResults:        $("noResults"),
  confirmDialog:    $("confirmDialog"),
  confirmMsg:       $("confirmMsg"),
  tplDayGroup:      $("tplDayGroup"),
  tplLink:          $("linkTemplate"),
  tplSkeleton:      $("tplSkeleton"),
};

/* ── Boot ─────────────────────────────────────────────────────────────── */
restoreSession();
wireEvents();

function wireEvents() {
  el.loginForm.addEventListener("submit", onLogin);
  el.logoutButton.addEventListener("click", onLogout);
  el.linkForm.addEventListener("submit", onSaveLink);
  el.cancelEditButton.addEventListener("click", resetComposer);

  // Reveal expanded fields when URL input is focused
  el.urlInput.addEventListener("focus", expandComposer);

  // Delegate edit / delete clicks on the feed
  el.linkFeed.addEventListener("click", onFeedClick);
  el.searchInput.addEventListener("input", renderFeed);
  el.favoritesFilter.addEventListener("click", () => {
    favoritesOnly = !favoritesOnly;
    el.favoritesFilter.setAttribute("aria-pressed", String(favoritesOnly));
    el.favoritesFilter.querySelector("span").textContent = favoritesOnly ? "★" : "☆";
    renderFeed();
  });
}

/* ══════════════════════════════════════════════════════════════════════
   LOGIN / LOGOUT
══════════════════════════════════════════════════════════════════════ */
async function onLogin(e) {
  e.preventDefault();
  clearError(el.loginError);

  const name = el.partnerName.value.trim();
  const code = el.coupleCode.value.trim();

  if (!name) { showError(el.loginError, "Enter your name."); el.partnerName.focus(); return; }
  if (!code) { showError(el.loginError, "Enter the shared code."); el.coupleCode.focus(); return; }

  setInputInvalid(el.partnerName, false);
  setInputInvalid(el.coupleCode, false);

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
  session.name  = "";
  session.code  = "";
  session.links = [];
  favoritesOnly = false;
  el.searchInput.value = "";
  el.favoritesFilter.setAttribute("aria-pressed", "false");
  el.favoritesFilter.querySelector("span").textContent = "☆";
  partnerColorMap.clear();

  el.appView.classList.add("hidden");
  el.loginView.classList.remove("hidden");
  el.partnerName.value = "";
  el.coupleCode.value  = "";
  clearError(el.loginError);
  resetComposer();
  el.linkFeed.textContent = "";
  el.skeletonFeed.textContent = "";
  el.emptyState.classList.add("hidden");
  el.noResults.classList.add("hidden");

  requestAnimationFrame(() => el.partnerName.focus());
}

function restoreSession() {
  try {
    const saved = JSON.parse(localStorage.getItem("sl.session") ?? "null");
    if (saved?.name && saved?.code) {
      session.name = saved.name;
      session.code = saved.code;
      showApp();
      showSkeleton();
      loadLinks().catch(() => {
        localStorage.removeItem("sl.session");
        hideSkeleton();
        el.appView.classList.add("hidden");
        el.loginView.classList.remove("hidden");
        showError(el.loginError, "Session expired — please enter your details again.");
        requestAnimationFrame(() => el.partnerName.focus());
      });
    }
  } catch {
    localStorage.removeItem("sl.session");
  }
}

/* ══════════════════════════════════════════════════════════════════════
   APP VIEW
══════════════════════════════════════════════════════════════════════ */
function showApp() {
  el.loginView.classList.add("hidden");
  el.appView.classList.remove("hidden");
  el.spaceLabel.textContent = session.name;
  el.spaceLabel.setAttribute("aria-label", `Logged in as ${session.name}`);
  requestAnimationFrame(() => el.urlInput.focus());
}

/* ══════════════════════════════════════════════════════════════════════
   SKELETON LOADING
══════════════════════════════════════════════════════════════════════ */
function showSkeleton(count = 4) {
  el.skeletonFeed.textContent = "";
  el.skeletonFeed.removeAttribute("aria-hidden");
  const tpl = el.tplSkeleton;
  for (let i = 0; i < count; i++) {
    const frag = tpl.content.cloneNode(true);
    el.skeletonFeed.append(frag);
  }
  el.linkFeed.classList.add("hidden");
}

function hideSkeleton() {
  el.skeletonFeed.textContent = "";
  el.skeletonFeed.setAttribute("aria-hidden", "true");
  el.linkFeed.classList.remove("hidden");
}

/* ══════════════════════════════════════════════════════════════════════
   LOAD + RENDER LINKS
══════════════════════════════════════════════════════════════════════ */
async function loadLinks() {
  const data = await api("/api/links");
  session.links = data.links;
  hideSkeleton();
  renderFeed();
}

function renderFeed() {
  el.linkFeed.textContent = "";
  el.emptyState.classList.toggle("hidden", session.links.length > 0);
  const query = el.searchInput.value.trim().toLocaleLowerCase();
  const visibleLinks = session.links.filter((link) => {
    if (favoritesOnly && !link.isFavorite) return false;
    if (!query) return true;
    const searchable = [
      link.title, link.url, link.note, link.description, link.siteName,
      ...(Array.isArray(link.tags) ? link.tags : []),
    ].filter(Boolean).join(" ").toLocaleLowerCase();
    return searchable.includes(query);
  });
  el.noResults.classList.toggle("hidden", session.links.length === 0 || visibleLinks.length > 0);
  if (session.links.length > 0 && visibleLinks.length === 0) {
    el.noResults.textContent = favoritesOnly && !query
      ? "No favorites yet. Tap the star on a link to save it here."
      : "No links match this search.";
  }

  if (!visibleLinks.length) return;

  // Group by calendar day
  const groups = new Map();
  for (const link of visibleLinks) {
    const key = toDayKey(link.createdAt);
    if (!groups.has(key)) {
      groups.set(key, { label: toDayLabel(link.createdAt), isRecent: isToday(link.createdAt), links: [] });
    }
    groups.get(key).links.push(link);
  }

  let itemIndex = 0;
  for (const { label, isRecent, links } of groups.values()) {
    const groupFrag = el.tplDayGroup.content.cloneNode(true);
    const heading   = groupFrag.querySelector(".day-label");
    heading.textContent = label;
    if (isRecent) heading.setAttribute("data-recent", "");

    const container = groupFrag.querySelector(".day-items");
    for (const link of links) {
      const itemFrag = buildLinkItem(link, itemIndex);
      container.append(itemFrag);
      itemIndex++;
    }
    el.linkFeed.append(groupFrag);
  }
}

function buildLinkItem(link, index = 0) {
  const frag  = el.tplLink.content.cloneNode(true);
  const item  = frag.querySelector(".link-item");
  const badge = frag.querySelector(".saver-badge");
  const title = frag.querySelector(".link-title");
  const domain= frag.querySelector(".link-domain");
  const note  = frag.querySelector(".link-note");
  const meta  = frag.querySelector(".link-meta");
  const editBtn = frag.querySelector(".edit-link");
  const delBtn  = frag.querySelector(".delete-link");
  const favoriteBtn = frag.querySelector(".favorite-link");
  const preview = frag.querySelector(".site-preview");
  const previewImage = frag.querySelector(".preview-image");
  const previewSite = frag.querySelector(".preview-site");
  const previewDescription = frag.querySelector(".preview-description");
  const tags = frag.querySelector(".link-tags");

  item.dataset.id = link.id;

  // Stagger entrance animation
  item.style.animationDelay = `${Math.min(index * 40, 280)}ms`;

  // Partner badge — initial + color
  const color = partnerColor(link.saverName);
  badge.textContent = nameInitial(link.saverName);
  badge.style.setProperty("--badge-fg", color.fg);
  badge.style.setProperty("--badge-bg", color.bg);
  badge.setAttribute("title",      `Saved by ${link.saverName}`);
  badge.setAttribute("aria-label", `Saved by ${link.saverName}`);

  // Link content
  title.href        = link.url;
  title.textContent = link.title || link.url;
  title.setAttribute("aria-label", `${link.title || link.url} — opens in new tab`);
  domain.textContent = domainOf(link.url);

  if (link.previewImage || link.description || link.siteName) {
    preview.href = link.url;
    preview.classList.remove("hidden");
    previewSite.textContent = link.siteName || domainOf(link.url);
    previewDescription.textContent = link.description || "Open this link to see more.";
    if (link.previewImage) {
      previewImage.src = link.previewImage;
      previewImage.alt = "";
      previewImage.classList.remove("hidden");
      previewImage.addEventListener("error", () => previewImage.classList.add("hidden"), { once: true });
    }
  }

  const linkTags = Array.isArray(link.tags) ? link.tags : [];
  if (linkTags.length) {
    tags.classList.remove("hidden");
    for (const tag of linkTags) {
      const chip = document.createElement("span");
      chip.className = "tag-chip";
      chip.textContent = tag;
      tags.append(chip);
    }
  }

  if (link.note) {
    note.textContent = link.note;
  } else {
    note.remove();
  }

  // Meta: "Saver · time"
  const saverSpan = document.createElement("span");
  saverSpan.textContent = link.saverName;

  const sep = document.createElement("span");
  sep.className   = "meta-sep";
  sep.setAttribute("aria-hidden", "true");

  const timeSpan = document.createElement("time");
  timeSpan.dateTime = link.createdAt;
  timeSpan.textContent = formatTime(link.createdAt);

  meta.append(saverSpan, sep, timeSpan);

  // Controls — only for the saver
  const isMine = link.saverName === session.name;
  favoriteBtn.textContent = link.isFavorite ? "★" : "☆";
  favoriteBtn.setAttribute("aria-pressed", String(Boolean(link.isFavorite)));
  favoriteBtn.setAttribute("aria-label", link.isFavorite ? "Remove from favorites" : "Add to favorites");
  favoriteBtn.title = link.isFavorite ? "Remove from favorites" : "Add to favorites";
  editBtn.classList.toggle("hidden", !isMine);
  delBtn.classList.toggle("hidden", !isMine);

  return frag;
}

/* ══════════════════════════════════════════════════════════════════════
   FEED INTERACTION
══════════════════════════════════════════════════════════════════════ */
async function onFeedClick(e) {
  const editBtn = e.target.closest(".edit-link");
  const delBtn  = e.target.closest(".delete-link");
  const favoriteBtn = e.target.closest(".favorite-link");
  const item    = e.target.closest(".link-item");

  if (!item) return;

  const link = session.links.find((l) => l.id === Number(item.dataset.id));
  if (!link) return;

  if (favoriteBtn) {
    favoriteBtn.disabled = true;
    try {
      const result = await api(`/api/links/${link.id}/favorite`, {
        method: "POST",
        body: { isFavorite: !link.isFavorite },
      });
      const index = session.links.findIndex((entry) => entry.id === link.id);
      if (index !== -1) session.links[index] = result.link;
      renderFeed();
    } catch (err) {
      showStatusError(err.message || "Could not update favorite.");
    } finally {
      favoriteBtn.disabled = false;
    }
    return;
  }

  if (editBtn) {
    startEdit(link);
    return;
  }

  if (delBtn) {
    const confirmed = await showConfirm(
      `"${link.title || link.url}" will be removed from your shared space.`
    );
    if (!confirmed) return;

    try {
      await api(`/api/links/${link.id}`, { method: "DELETE" });
      // Optimistic: fade item out then reload
      const itemEl = el.linkFeed.querySelector(`[data-id="${link.id}"]`);
      if (itemEl) {
        itemEl.style.transition = "opacity 200ms ease, transform 200ms ease";
        itemEl.style.opacity = "0";
        itemEl.style.transform = "translateX(-8px)";
        await new Promise((r) => setTimeout(r, 200));
      }
      await loadLinks();
    } catch (err) {
      showStatusError(err.message || "Could not delete. Please try again.");
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════
   COMPOSER
══════════════════════════════════════════════════════════════════════ */
function expandComposer() {
  el.composerExtra.classList.remove("hidden");
}

async function onSaveLink(e) {
  e.preventDefault();
  clearError(el.linkError);
  setInputInvalid(el.urlInput, false);

  const body = {
    url:   el.urlInput.value.trim(),
    title: el.titleInput.value.trim(),
    note:  el.noteInput.value.trim(),
    tags:  el.tagsInput.value.split(",").map((tag) => tag.trim()).filter(Boolean),
  };

  const editingId = el.editingId.value;

  if (!body.url && !editingId) {
    setInputInvalid(el.urlInput, true);
    showError(el.linkError, "Paste a URL first.");
    el.urlInput.focus();
    return;
  }

  const path   = editingId ? `/api/links/${editingId}` : "/api/links";
  const method = editingId ? "PATCH" : "POST";

  // Show fetching hint when no custom title
  if (!editingId && !body.title) {
    setStatus("Fetching website preview…", true);
  }

  await withBusy(el.saveButton, async () => {
    await api(path, { method, body });
    resetComposer();
    await loadLinks();
    clearStatus();
  }, el.linkError);

  clearStatus();
}

function startEdit(link) {
  el.editingId.value  = link.id;
  el.urlInput.value   = link.url;
  el.titleInput.value = link.title;
  el.noteInput.value  = link.note ?? "";
  el.tagsInput.value  = Array.isArray(link.tags) ? link.tags.join(", ") : "";
  el.saveBtnLabel.textContent = "Save changes";
  el.cancelEditButton.classList.remove("hidden");
  expandComposer();
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
  setInputInvalid(el.urlInput, false);
}

/* ══════════════════════════════════════════════════════════════════════
   DELETE CONFIRM DIALOG
══════════════════════════════════════════════════════════════════════ */
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

/* ══════════════════════════════════════════════════════════════════════
   STATUS + ERROR DISPLAY
══════════════════════════════════════════════════════════════════════ */
function setStatus(msg, fetching = false) {
  el.listStatus.textContent = msg;
  el.listStatus.classList.toggle("is-fetching", fetching);
}

function clearStatus() {
  el.listStatus.textContent = "";
  el.listStatus.classList.remove("is-fetching");
}

function showStatusError(msg) {
  el.listStatus.textContent = msg;
  el.listStatus.classList.remove("is-fetching");
}

/* ══════════════════════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════════════════════ */

/** Disable a button and show spinner while async action runs */
async function withBusy(btn, action, errEl) {
  btn.disabled = true;
  btn.classList.add("is-loading");
  try {
    await action();
  } catch (err) {
    if (errEl) showError(errEl, err.message || "Something went wrong.");
  } finally {
    btn.disabled = false;
    btn.classList.remove("is-loading");
  }
}

function showError(errorEl, msg) { errorEl.textContent = msg; }
function clearError(errorEl)     { errorEl.textContent = ""; }

function setInputInvalid(input, invalid) {
  if (invalid) {
    input.setAttribute("aria-invalid", "true");
  } else {
    input.removeAttribute("aria-invalid");
  }
}

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
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error ?? "Request failed.");
  return payload;
}

/* ── Date helpers ─────────────────────────────────────────────────────── */
function isoToDate(value) {
  // Postgres may return without trailing Z
  return new Date(value.endsWith("Z") ? value : value + "Z");
}

function isToday(value) {
  const d = isoToDate(value);
  const now = new Date();
  return sameDay(d, now);
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

  if (sameDay(d, today))     return "Today";
  if (sameDay(d, yesterday)) return "Yesterday";

  // Within this calendar year: "Wednesday, October 8"
  // Older: "October 8, 2024"
  const sameYear = d.getFullYear() === today.getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    weekday: sameYear ? "long"  : undefined,
    month:   "long",
    day:     "numeric",
    year:    sameYear ? undefined : "numeric",
  }).format(d);
}

function formatTime(value) {
  const d = isoToDate(value);
  return new Intl.DateTimeFormat(undefined, {
    hour:   "numeric",
    minute: "2-digit",
  }).format(d);
}

function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth()    === b.getMonth()    &&
    a.getDate()     === b.getDate()
  );
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
