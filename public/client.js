/* ══════════════════════════════════════════════════════════════════════
   ShareLink — frontend  v2
   Quiet editorial feed: timeline by day, partner initial badges,
   skeleton loading, staggered entrance, refined state management.
══════════════════════════════════════════════════════════════════════ */

/* ── Session state ────────────────────────────────────────────────────── */
const session = { name: "", code: "", links: [] };
let activeFilter = "all";
let activeTag = null;
let metadataPreviewTimer = 0;
let metadataPreviewRevision = 0;
let autoFetchedTitle = "";
const favoriteSaveQueues = new Map();
const favoriteRevisions = new Map();
const persistedFavorites = new Map();
const favoriteRemovalTimers = new Map();
let toastTimer = 0;
let activeFavoriteToast = null;
let activePreviewId = null;
let previewOpener = null;
let returnToPreviewId = null;
let peekTimer = 0;
let peekCloseTimer = 0;
let activePeekId = null;
let activePeekRow = null;
const metadataLoads = new Map();

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
  userMenuButton:   $("userMenuButton"),
  userDropdown:     $("userDropdown"),
  switchUserButton: $("switchUserButton"),
  signOutButton:    $("signOutButton"),
  userAvatar:       $("userAvatar"),
  headerSearch:     $("headerSearch"),
  mobileSearchToggle: $("mobileSearchToggle"),
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
  extrasToggle:     $("extrasToggle"),
  composerPreview:  $("composerPreview"),
  composerFavicon:  $("composerFavicon"),
  composerFaviconLetter: $("composerFaviconLetter"),
  composerDomain:   $("composerDomain"),
  composerPreviewLoading: $("composerPreviewLoading"),
  tagEntryInput:    $("tagEntryInput"),
  tagChipList:      $("tagChipList"),
  tagSuggestions:   $("tagSuggestions"),
  emptyState:       $("emptyState"),
  linkFeed:         $("linkFeed"),
  skeletonFeed:     $("skeletonFeed"),
  listStatus:       $("listStatus"),
  searchInput:      $("searchInput"),
  filterChips:      $("filterChips"),
  noResults:        $("noResults"),
  clearFiltersButton: $("clearFiltersButton"),
  confirmDialog:    $("confirmDialog"),
  confirmMsg:       $("confirmMsg"),
  toast:            $("toast"),
  toastMessage:     $("toastMessage"),
  toastSeparator:   $("toastSeparator"),
  toastUndo:        $("toastUndo"),
  previewBackdrop:  $("previewBackdrop"),
  previewPanel:     $("previewPanel"),
  previewClose:     $("previewClose"),
  previewTitle:     $("previewTitle"),
  previewMeta:      $("previewMeta"),
  previewDescription: $("previewDescription"),
  previewNote:      $("previewNote"),
  previewTags:      $("previewTags"),
  previewImage:     $("previewImage"),
  previewImageFallback: $("previewImageFallback"),
  previewFavicon:   $("previewFavicon"),
  previewFallbackGlyph: $("previewFallbackGlyph"),
  previewFallbackDomain: $("previewFallbackDomain"),
  previewSkeleton:  $("previewSkeleton"),
  previewLoadingLines: $("previewLoadingLines"),
  previewOpenSite:  $("previewOpenSite"),
  previewFavorite:  $("previewFavorite"),
  linkPeek:         $("linkPeek"),
  peekImage:        $("peekImage"),
  peekImageFallback: $("peekImageFallback"),
  peekFavicon:      $("peekFavicon"),
  peekFallbackGlyph: $("peekFallbackGlyph"),
  peekFallbackDomain: $("peekFallbackDomain"),
  peekTitle:        $("peekTitle"),
  peekDescription:  $("peekDescription"),
  peekDomain:       $("peekDomain"),
  tplDayGroup:      $("tplDayGroup"),
  tplLink:          $("linkTemplate"),
  tplSkeleton:      $("tplSkeleton"),
};

/* ── Boot ─────────────────────────────────────────────────────────────── */
restoreSession();
wireEvents();

function wireEvents() {
  el.loginForm.addEventListener("submit", onLogin);
  el.userMenuButton.addEventListener("click", () => {
    const open = el.userDropdown.classList.contains("hidden");
    closeUserMenu();
    if (open) {
      el.userDropdown.classList.remove("hidden");
      el.userMenuButton.setAttribute("aria-expanded", "true");
    }
  });
  el.switchUserButton.addEventListener("click", onSwitchUser);
  el.signOutButton.addEventListener("click", onLogout);
  el.mobileSearchToggle.addEventListener("click", toggleMobileSearch);
  el.linkForm.addEventListener("submit", onSaveLink);
  el.cancelEditButton.addEventListener("click", () => {
    returnToPreviewId = null;
    resetComposer();
  });
  el.toastUndo.addEventListener("click", undoFavoriteChange);

  // Reveal expanded fields when URL input is focused
  el.urlInput.addEventListener("focus", expandComposer);
  el.urlInput.addEventListener("input", onComposerUrlInput);
  el.extrasToggle.addEventListener("click", () => {
    if (el.composerExtra.classList.contains("hidden")) expandComposer();
    else collapseComposer();
  });
  el.tagEntryInput.addEventListener("keydown", onTagEntryKeydown);
  el.tagEntryInput.addEventListener("input", renderTagSuggestions);
  el.tagEntryInput.addEventListener("focus", renderTagSuggestions);
  el.tagChipList.addEventListener("click", onTagChipClick);
  el.tagSuggestions.addEventListener("click", onTagSuggestionClick);

  // Delegate edit / delete clicks on the feed
  el.linkFeed.addEventListener("click", onFeedClick);
  el.linkFeed.addEventListener("auxclick", onFeedAuxClick);
  el.linkFeed.addEventListener("keydown", onFeedKeydown);
  el.linkFeed.addEventListener("pointerover", onFeedPointerOver);
  el.linkFeed.addEventListener("pointerout", onFeedPointerOut);
  el.clearFiltersButton.addEventListener("click", clearFilters);
  el.linkPeek.addEventListener("pointerenter", cancelPeekClose);
  el.linkPeek.addEventListener("pointerleave", schedulePeekClose);
  el.previewClose.addEventListener("click", () => closePreview());
  el.previewBackdrop.addEventListener("click", (event) => {
    if (event.target === el.previewBackdrop) closePreview();
  });
  el.previewPanel.addEventListener("click", onPreviewPanelClick);
  el.filterChips.addEventListener("click", (event) => {
    const tagChip = event.target.closest("[data-tag-filter]");
    if (tagChip) {
      hideToast();
      activeTag = activeTag === tagChip.dataset.tagFilter ? null : tagChip.dataset.tagFilter;
      activeFilter = "all";
      renderFeed();
      return;
    }
    const chip = event.target.closest("[data-filter]");
    if (!chip) return;
    hideToast();
    activeFilter = chip.dataset.filter;
    activeTag = null;
    renderFeed();
  });
  el.searchInput.addEventListener("input", () => {
    hideToast();
    renderFeed();
  });
  document.addEventListener("keydown", onGlobalKeydown);
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".link-menu-wrap")) closeLinkMenus();
    if (!event.target.closest(".user-menu-wrap")) closeUserMenu();
    if (window.matchMedia("(max-width: 599px)").matches && !event.target.closest(".header-search")) {
      closeMobileSearch();
    }
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
  closeUserMenu();
  closePreview({ restoreFocus: false });
  closePeek();
  localStorage.removeItem("sl.session");
  session.name  = "";
  session.code  = "";
  session.links = [];
  activeFilter = "all";
  activeTag = null;
  el.searchInput.value = "";
  el.filterChips.textContent = "";
  favoriteRevisions.clear();
  persistedFavorites.clear();
  for (const timer of favoriteRemovalTimers.values()) window.clearTimeout(timer);
  favoriteRemovalTimers.clear();
  hideToast();
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

function onSwitchUser() {
  const sharedCode = session.code;
  onLogout();
  el.coupleCode.value = sharedCode;
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
  el.userAvatar.textContent = session.name.trim().charAt(0).toLocaleUpperCase() || "?";
  el.userAvatar.style.setProperty("--person-color", personColorFor(session.name));
}

function closeUserMenu() {
  el.userDropdown.classList.add("hidden");
  el.userMenuButton.setAttribute("aria-expanded", "false");
}

function openMobileSearch() {
  el.headerSearch.classList.add("is-open");
  el.mobileSearchToggle.setAttribute("aria-expanded", "true");
  el.mobileSearchToggle.setAttribute("aria-label", "Close search");
}

function closeMobileSearch() {
  el.headerSearch.classList.remove("is-open");
  el.mobileSearchToggle.setAttribute("aria-expanded", "false");
  el.mobileSearchToggle.setAttribute("aria-label", "Open search");
}

function toggleMobileSearch() {
  if (el.headerSearch.classList.contains("is-open")) {
    closeMobileSearch();
  } else {
    openMobileSearch();
    el.searchInput.focus();
  }
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
  persistedFavorites.clear();
  favoriteRevisions.clear();
  for (const link of session.links) persistedFavorites.set(link.id, Boolean(link.isFavorite));
  hideSkeleton();
  renderFeed();
}

function renderFeed() {
  closePeek();
  el.linkFeed.textContent = "";
  renderFilterChips();
  el.emptyState.classList.toggle("hidden", session.links.length > 0);
  const query = el.searchInput.value.trim().toLocaleLowerCase();
  const visibleLinks = session.links.filter((link) => {
    if (activeFilter === "mine" && link.saverName !== session.name) return false;
    if (activeFilter === "favorites" && !link.isFavorite) return false;
    if (activeFilter.startsWith("person:") && link.saverName !== activeFilter.slice(7)) return false;
    if (activeTag && !(Array.isArray(link.tags) ? link.tags : []).includes(activeTag)) return false;
    if (!query) return true;
    const searchable = [
      link.title, link.url, link.note, link.description, link.siteName,
      ...(Array.isArray(link.tags) ? link.tags : []),
    ].filter(Boolean).join(" ").toLocaleLowerCase();
    return searchable.includes(query);
  });
  el.noResults.classList.toggle("hidden", session.links.length === 0 || visibleLinks.length > 0);
  if (session.links.length > 0 && visibleLinks.length === 0) {
    el.noResults.querySelector("span").textContent = "No links match. Clear filters";
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
    heading.querySelector(".day-title").textContent = label;
    heading.querySelector(".day-count").textContent = `${links.length} ${links.length === 1 ? "link" : "links"}`;
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

function renderFilterChips() {
  const people = [...new Set(session.links.map((link) => link.saverName))];
  const mineCount = session.links.filter((link) => link.saverName === session.name).length;
  const filters = [
    { key: "all", label: "All", count: session.links.length },
    { key: "mine", label: "Mine", count: mineCount },
    ...people.filter((name) => name !== session.name).map((name) => ({
      key: `person:${name}`,
      label: name,
      count: session.links.filter((link) => link.saverName === name).length,
    })),
    { key: "favorites", label: "★ Favorites", count: session.links.filter((link) => link.isFavorite).length },
  ];
  const tags = [...new Set(session.links.flatMap((link) => Array.isArray(link.tags) ? link.tags : []))]
    .sort((a, b) => a.localeCompare(b));
  el.filterChips.textContent = "";
  for (const filter of filters) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "filter-chip";
    button.dataset.filter = filter.key;
    button.setAttribute("aria-pressed", String(!activeTag && activeFilter === filter.key));
    button.append(document.createTextNode(filter.label));
    const count = document.createElement("span");
    count.className = "filter-count";
    count.textContent = String(filter.count);
    button.append(count);
    el.filterChips.append(button);
  }
  for (const tag of tags) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "filter-chip tag-filter-chip";
    button.dataset.tagFilter = tag;
    button.setAttribute("aria-pressed", String(activeTag === tag));
    button.append(document.createTextNode(`# ${tag}`));
    const count = document.createElement("span");
    count.className = "filter-count";
    count.textContent = String(session.links.filter((link) => (link.tags || []).includes(tag)).length);
    button.append(count);
    el.filterChips.append(button);
  }
}

function buildLinkItem(link, index = 0) {
  const frag  = el.tplLink.content.cloneNode(true);
  const item  = frag.querySelector(".link-item");
  const faviconTile = frag.querySelector(".favicon-tile");
  const favicon = frag.querySelector(".site-favicon");
  const title = frag.querySelector(".link-title");
  const note  = frag.querySelector(".link-note");
  const meta  = frag.querySelector(".link-meta");
  const faviconLetter = frag.querySelector(".favicon-letter");
  const editTitleBtn = frag.querySelector(".edit-title-link");
  const editDetailsBtn = frag.querySelector(".edit-details-link");
  const deleteBtn = frag.querySelector(".delete-link");
  const favoriteBtn = frag.querySelector(".favorite-link");
  const tags = frag.querySelector(".link-tags");

  item.dataset.id = link.id;
  const displayTitle = displayTitleFor(link);
  item.setAttribute("aria-label", `Open ${displayTitle}`);

  // Stagger entrance animation
  item.style.animationDelay = `${Math.min(index * 40, 280)}ms`;

  // Use the site's own favicon with a local link glyph if it has no icon.
  favicon.src = link.faviconUrl || new URL("/favicon.ico", link.url).href;
  faviconLetter.textContent = domainOf(link.url).charAt(0).toLocaleUpperCase() || "↗";
  favicon.addEventListener("error", () => {
    faviconTile.classList.add("is-fallback");
    favicon.classList.add("hidden");
    faviconLetter.classList.remove("hidden");
  }, { once: true });

  // Link content
  title.textContent = displayTitle;

  const linkTags = Array.isArray(link.tags) ? link.tags : [];
  if (linkTags.length) {
    tags.classList.remove("hidden");
    for (const tag of linkTags) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "tag-chip";
      chip.dataset.tagFilter = tag;
      chip.setAttribute("aria-label", `Filter by tag ${tag}`);
      chip.textContent = tag;
      tags.append(chip);
    }
  }

  if (link.note) {
    note.textContent = link.note;
  } else {
    note.remove();
  }

  // Compact metadata: "domain · author · time"
  const domainSpan = document.createElement("a");
  domainSpan.className = "link-domain-open";
  domainSpan.href = link.url;
  domainSpan.target = "_blank";
  domainSpan.rel = "noopener noreferrer";
  domainSpan.textContent = domainOf(link.url);
  const openIcon = document.createElement("span");
  openIcon.setAttribute("aria-hidden", "true");
  openIcon.textContent = " ↗";
  domainSpan.append(openIcon);
  const saverSpan = document.createElement("span");
  saverSpan.className = "author-dot";
  saverSpan.style.setProperty("--person-color", personColorFor(link.saverName));
  saverSpan.textContent = link.saverName;

  const timeSpan = document.createElement("time");
  timeSpan.dateTime = link.createdAt;
  timeSpan.textContent = formatTime(link.createdAt);

  for (const [index, part] of [domainSpan, saverSpan, timeSpan].entries()) {
    if (index) {
      const sep = document.createElement("span");
      sep.className = "meta-sep";
      sep.setAttribute("aria-hidden", "true");
      meta.append(sep);
    }
    meta.append(part);
  }

  // Editing and deletion stay limited to the original saver.
  const isMine = link.saverName === session.name;
  favoriteBtn.textContent = link.isFavorite ? "★" : "☆";
  favoriteBtn.setAttribute("aria-pressed", String(Boolean(link.isFavorite)));
  favoriteBtn.setAttribute("aria-label", link.isFavorite ? "Remove from favorites" : "Add to favorites");
  favoriteBtn.title = link.isFavorite ? "Remove from favorites" : "Add to favorites";
  editTitleBtn?.classList.toggle("hidden", !isMine);
  editDetailsBtn?.classList.toggle("hidden", !isMine);
  deleteBtn?.classList.toggle("hidden", !isMine);

  return frag;
}

/* ══════════════════════════════════════════════════════════════════════
   FEED INTERACTION
══════════════════════════════════════════════════════════════════════ */
async function onFeedClick(e) {
  const menuToggle = e.target.closest(".menu-toggle");
  const previewBtn = e.target.closest(".preview-link");
  const editTitleBtn = e.target.closest(".edit-title-link");
  const editDetailsBtn = e.target.closest(".edit-details-link");
  const deleteBtn = e.target.closest(".delete-link");
  const favoriteBtn = e.target.closest(".favorite-link");
  const copyBtn = e.target.closest(".copy-link");
  const tagButton = e.target.closest("[data-tag-filter]");
  const item    = e.target.closest(".link-item");

  if (!item) return;

  const link = session.links.find((l) => l.id === Number(item.dataset.id));
  if (!link) return;

  if (tagButton) {
    e.preventDefault();
    hideToast();
    activeFilter = "all";
    activeTag = tagButton.dataset.tagFilter;
    renderFeed();
    return;
  }

  if (e.target.closest("a")) return;
  if ((e.ctrlKey || e.metaKey) && !e.target.closest("button, input, textarea, select")) {
    e.preventDefault();
    window.open(link.url, "_blank", "noopener,noreferrer");
    return;
  }

  if (menuToggle) {
    const menu = item.querySelector(".link-menu");
    const opening = menu.classList.contains("hidden");
    closeLinkMenus();
    menu.classList.toggle("hidden", !opening);
    menuToggle.setAttribute("aria-expanded", String(opening));
    return;
  }

  if (copyBtn) {
    try {
      await navigator.clipboard.writeText(link.url);
      setStatus("Link copied.");
    } catch {
      showStatusError("Could not copy this link.");
    }
    return;
  }

  if (favoriteBtn) {
    const previousFavorite = Boolean(link.isFavorite);
    setFavorite(link, !previousFavorite, { showToast: true, previousFavorite });
    return;
  }

  if (previewBtn) {
    closeLinkMenus();
    openPreview(link, item);
    return;
  }

  if (editTitleBtn || editDetailsBtn) {
    closeLinkMenus();
    startEdit(link, editTitleBtn ? "title" : "note");
    return;
  }

  if (deleteBtn) {
    closeLinkMenus();
    const confirmed = await showConfirm(`"${displayTitleFor(link)}" will be removed from your shared space.`);
    if (!confirmed) return;
    try {
      await api(`/api/links/${link.id}`, { method: "DELETE" });
      await loadLinks();
    } catch (error) {
      showStatusError(error.message || "Could not delete. Please try again.");
    }
    return;
  }

  window.open(link.url, "_blank", "noopener,noreferrer");
}

function onFeedAuxClick(event) {
  if (event.button !== 1) return;
  const item = event.target.closest(".link-item");
  if (!item || event.target.closest("a, button")) return;
  const link = session.links.find((entry) => entry.id === Number(item.dataset.id));
  if (!link) return;
  event.preventDefault();
  window.open(link.url, "_blank", "noopener,noreferrer");
}

function onFeedKeydown(event) {
  const item = event.target.closest(".link-item");
  if (!item || event.target !== item || !["Enter", " "].includes(event.key)) return;
  event.preventDefault();
  const link = session.links.find((entry) => entry.id === Number(item.dataset.id));
  if (link) openPreview(link, item);
}

function onGlobalKeydown(event) {
  if (activePreviewId !== null) {
    if (event.key === "Escape") {
      event.preventDefault();
      closePreview();
      closeLinkMenus();
      if (el.searchInput.value) {
        el.searchInput.value = "";
        renderFeed();
      }
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      movePreview(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Tab") trapPreviewFocus(event);
    return;
  }

  if (event.key === "Escape") {
    if (activePeekId !== null) closePeek();
    closeLinkMenus();
    const userMenuWasOpen = !el.userDropdown.classList.contains("hidden");
    closeUserMenu();
    if (userMenuWasOpen) el.userMenuButton.focus();
    if (el.searchInput.value) {
      el.searchInput.value = "";
      renderFeed();
    }
    const mobileSearchWasOpen = el.headerSearch.classList.contains("is-open");
    closeMobileSearch();
    if (mobileSearchWasOpen) el.mobileSearchToggle.focus();
  }
  if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    if (window.matchMedia("(max-width: 599px)").matches) openMobileSearch();
    el.searchInput.focus();
  }
}

function openPreview(link, opener, { focus = true } = {}) {
  closePeek();
  const isAlreadyOpen = !el.previewBackdrop.classList.contains("hidden");
  activePreviewId = link.id;
  if (!isAlreadyOpen) previewOpener = opener;
  el.previewBackdrop.classList.remove("hidden");
  document.body.classList.add("preview-open");
  renderPreviewPanel(link);
  if (!link.metadataFetchedAt) ensurePreviewMetadata(link);
  if (focus && !isAlreadyOpen) requestAnimationFrame(() => el.previewPanel.focus());
}

function closePreview({ restoreFocus = true } = {}) {
  if (el.previewBackdrop.classList.contains("hidden")) return;
  el.previewBackdrop.classList.add("hidden");
  document.body.classList.remove("preview-open");
  activePreviewId = null;
  const opener = previewOpener;
  if (restoreFocus) requestAnimationFrame(() => opener?.isConnected ? opener.focus() : el.searchInput.focus());
  previewOpener = null;
}

function renderPreviewPanel(link) {
  el.previewTitle.textContent = displayTitleFor(link);
  el.previewMeta.textContent = `${domainOf(link.url)} · ${link.saverName} · ${formatTime(link.createdAt)}`;
  el.previewOpenSite.href = link.url;
  el.previewDescription.textContent = link.description || "";
  el.previewDescription.classList.toggle("hidden", !link.description);
  el.previewNote.textContent = link.note || "";
  el.previewNote.classList.toggle("hidden", !link.note);
  el.previewSkeleton.classList.toggle("hidden", Boolean(link.metadataFetchedAt));
  el.previewLoadingLines.classList.toggle("hidden", Boolean(link.metadataFetchedAt));
  setImageFrame(
    el.previewImage,
    el.previewImageFallback,
    el.previewFavicon,
    el.previewFallbackGlyph,
    el.previewFallbackDomain,
    link.previewImage,
    link.faviconUrl || faviconFor(link.url),
    domainOf(link.url),
  );

  el.previewTags.textContent = "";
  const tags = Array.isArray(link.tags) ? link.tags : [];
  el.previewTags.classList.toggle("hidden", !tags.length);
  for (const tag of tags) {
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.textContent = tag;
    el.previewTags.append(chip);
  }

  const isMine = link.saverName === session.name;
  el.previewFavorite.textContent = link.isFavorite ? "★ Favorited" : "☆ Favorite";
  el.previewFavorite.setAttribute("aria-pressed", String(Boolean(link.isFavorite)));
  el.previewFavorite.setAttribute("aria-label", link.isFavorite ? "Remove from favorites" : "Add to favorites");
  el.previewPanel.querySelector('[data-panel-action="edit"]').classList.toggle("hidden", !isMine);
  el.previewPanel.querySelector('[data-panel-action="delete"]').classList.toggle("hidden", !isMine);
}

function ensurePreviewMetadata(link) {
  if (link.metadataFetchedAt || metadataLoads.has(link.id)) return metadataLoads.get(link.id);
  const request = api(`/api/links/${link.id}/metadata`, { method: "POST" })
    .then(({ link: updated }) => {
      Object.assign(link, {
        ogTitle: updated.ogTitle,
        previewImage: updated.previewImage,
        description: updated.description,
        siteName: updated.siteName,
        faviconUrl: updated.faviconUrl,
        metadataFetchedAt: updated.metadataFetchedAt,
      });
      if (activePreviewId === link.id) renderPreviewPanel(link);
    })
    .catch(() => {
      // Leave the saved title and domain visible if the metadata service is unavailable.
      link.metadataFetchedAt = new Date().toISOString();
      if (activePreviewId === link.id) renderPreviewPanel(link);
    })
    .finally(() => metadataLoads.delete(link.id));
  metadataLoads.set(link.id, request);
  return request;
}

function displayTitleFor(link) {
  const fetchedTitle = link.ogTitle || link.title;
  const title = link.title && link.title !== link.url && link.title !== fetchedTitle ? link.title : fetchedTitle;
  if (!title || title === link.url || title.trim().length < 4 || /^(home|homepage|untitled|website)$/i.test(title.trim())) return domainOf(link.url);
  return title;
}

function faviconFor(url) {
  try { return new URL("/favicon.ico", url).href; } catch { return ""; }
}

function setImageFrame(image, fallback, favicon, fallbackGlyph, domainLabel, imageUrl, faviconUrl, domain) {
  image.onerror = () => {
    image.classList.add("hidden");
    fallback.classList.remove("hidden");
  };
  image.onload = () => fallback.classList.add("hidden");
  favicon.onerror = () => {
    favicon.classList.add("hidden");
    fallbackGlyph.classList.remove("hidden");
  };
  favicon.onload = () => {
    favicon.classList.remove("hidden");
    fallbackGlyph.classList.add("hidden");
  };
  favicon.classList.remove("hidden");
  fallbackGlyph.classList.add("hidden");
  favicon.src = faviconUrl || "";
  domainLabel.textContent = domain;
  if (imageUrl) {
    image.src = imageUrl;
    image.classList.remove("hidden");
    fallback.classList.add("hidden");
  } else {
    image.removeAttribute("src");
    image.classList.add("hidden");
    fallback.classList.remove("hidden");
  }
}

function movePreview(direction) {
  const rows = [...el.linkFeed.querySelectorAll(".link-item")];
  const currentIndex = rows.findIndex((row) => Number(row.dataset.id) === activePreviewId);
  const nextRow = rows[currentIndex + direction];
  if (!nextRow) return;
  const nextLink = session.links.find((link) => link.id === Number(nextRow.dataset.id));
  if (nextLink) openPreview(nextLink, nextRow, { focus: false });
}

function trapPreviewFocus(event) {
  const focusables = [...el.previewPanel.querySelectorAll('a[href], button:not(:disabled), [tabindex]:not([tabindex="-1"])')]
    .filter((element) => !element.classList.contains("hidden") && element.getClientRects().length);
  if (!focusables.length) {
    event.preventDefault();
    el.previewPanel.focus();
    return;
  }
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && (document.activeElement === first || !el.previewPanel.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || !el.previewPanel.contains(document.activeElement))) {
    event.preventDefault();
    first.focus();
  }
}

function onPreviewPanelClick(event) {
  const button = event.target.closest("[data-panel-action]");
  if (!button) return;
  const link = session.links.find((entry) => entry.id === activePreviewId);
  if (!link) return;
  const action = button.dataset.panelAction;
  if (action === "favorite") {
    setFavorite(link, !link.isFavorite, { showToast: true, previousFavorite: link.isFavorite });
  } else if (action === "copy") {
    navigator.clipboard.writeText(link.url)
      .then(() => showToast("Link copied."))
      .catch(() => showToast("Could not copy this link.", null, true));
  } else if (action === "edit") {
    returnToPreviewId = link.id;
    closePreview({ restoreFocus: false });
    startEdit(link);
  } else if (action === "delete") {
    deleteLinkFromPreview(link);
  }
}

async function deleteLinkFromPreview(link) {
  const confirmed = await showConfirm(`"${displayTitleFor(link)}" will be removed from your shared space.`);
  if (!confirmed) return;
  try {
    await api(`/api/links/${link.id}`, { method: "DELETE" });
    closePreview({ restoreFocus: false });
    await loadLinks();
    const firstRow = el.linkFeed.querySelector(".link-item");
    (firstRow || el.searchInput).focus();
  } catch (error) {
    showToast(error.message || "Could not delete. Please try again.", null, true);
  }
}

function onFeedPointerOver(event) {
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  const row = event.target.closest(".link-item");
  if (!row || (event.relatedTarget instanceof Node && row.contains(event.relatedTarget))) return;
  const link = session.links.find((entry) => entry.id === Number(row.dataset.id));
  if (!link || activePeekId === link.id) return;
  window.clearTimeout(peekCloseTimer);
  window.clearTimeout(peekTimer);
  peekTimer = window.setTimeout(() => showPeek(link, row), 400);
}

function onFeedPointerOut(event) {
  const row = event.target.closest(".link-item");
  if (!row || (event.relatedTarget instanceof Node && row.contains(event.relatedTarget))) return;
  if (event.relatedTarget && el.linkPeek.contains(event.relatedTarget)) return;
  schedulePeekClose();
}

function showPeek(link, row) {
  if (activePreviewId !== null) return;
  activePeekId = link.id;
  activePeekRow = row;
  el.peekTitle.textContent = displayTitleFor(link);
  el.peekDescription.textContent = link.description || "";
  el.peekDescription.classList.toggle("hidden", !link.description);
  el.peekDomain.textContent = domainOf(link.url);
  setImageFrame(
    el.peekImage,
    el.peekImageFallback,
    el.peekFavicon,
    el.peekFallbackGlyph,
    el.peekFallbackDomain,
    link.previewImage,
    link.faviconUrl || faviconFor(link.url),
    domainOf(link.url),
  );
  el.linkPeek.classList.remove("hidden");
  el.linkPeek.setAttribute("aria-hidden", "false");

  const rowRect = row.getBoundingClientRect();
  const peekRect = el.linkPeek.getBoundingClientRect();
  const width = 320;
  const gap = 12;
  const right = rowRect.right + gap;
  const left = right + width <= window.innerWidth - 12
    ? right
    : Math.max(12, rowRect.left - width - gap);
  const top = Math.max(12, Math.min(rowRect.top, window.innerHeight - peekRect.height - 12));
  el.linkPeek.style.left = `${left}px`;
  el.linkPeek.style.top = `${top}px`;
}

function cancelPeekClose() {
  window.clearTimeout(peekCloseTimer);
}

function schedulePeekClose() {
  window.clearTimeout(peekTimer);
  cancelPeekClose();
  peekCloseTimer = window.setTimeout(closePeek, 150);
}

function closePeek() {
  window.clearTimeout(peekTimer);
  window.clearTimeout(peekCloseTimer);
  peekTimer = 0;
  peekCloseTimer = 0;
  activePeekId = null;
  activePeekRow = null;
  el.linkPeek.classList.add("hidden");
  el.linkPeek.setAttribute("aria-hidden", "true");
}

function closeLinkMenus() {
  document.querySelectorAll(".link-menu").forEach((menu) => menu.classList.add("hidden"));
  document.querySelectorAll(".menu-toggle").forEach((button) => button.setAttribute("aria-expanded", "false"));
}

function setFavorite(link, isFavorite, { showToast: shouldShowToast = false, previousFavorite = link.isFavorite } = {}) {
  if (Boolean(link.isFavorite) === isFavorite) return;

  link.isFavorite = isFavorite;
  const revision = (favoriteRevisions.get(link.id) ?? 0) + 1;
  favoriteRevisions.set(link.id, revision);
  const row = updateFavoriteRow(link);

  const isRemovingFromFavorites = activeFilter === "favorites" && !isFavorite;
  if (row) row.classList.toggle("favorite-pending-removal", isRemovingFromFavorites && shouldShowToast);
  if (isFavorite || !isRemovingFromFavorites || !shouldShowToast) clearFavoriteRemovalTimer(link.id);

  if (shouldShowToast && isFavorite) {
    showToast("Added to favorites", {
      type: "added",
      linkId: link.id,
      previousFavorite,
    });
  } else if (shouldShowToast && isRemovingFromFavorites) {
    showToast("Removed from favorites", {
      type: "removed",
      linkId: link.id,
      previousFavorite,
    });
    scheduleFavoriteRemoval(link.id);
  } else if (!isFavorite && activeFilter === "favorites") {
    hideToast();
    removeFavoriteRow(link.id);
  }

  persistFavorite(link, isFavorite, revision, previousFavorite);
}

function updateFavoriteRow(link) {
  const row = el.linkFeed.querySelector(`[data-id="${link.id}"]`);
  const button = row?.querySelector(".favorite-link");
  if (button) {
    button.textContent = link.isFavorite ? "★" : "☆";
    button.setAttribute("aria-pressed", String(Boolean(link.isFavorite)));
    button.setAttribute("aria-label", link.isFavorite ? "Remove from favorites" : "Add to favorites");
    button.title = link.isFavorite ? "Remove from favorites" : "Add to favorites";
  }
  updateFavoritesCount();
  if (activePreviewId === link.id) updatePreviewFavorite(link);
  return row;
}

function updatePreviewFavorite(link) {
  el.previewFavorite.textContent = link.isFavorite ? "★ Favorited" : "☆ Favorite";
  el.previewFavorite.setAttribute("aria-pressed", String(Boolean(link.isFavorite)));
  el.previewFavorite.setAttribute("aria-label", link.isFavorite ? "Remove from favorites" : "Add to favorites");
}

function updateFavoritesCount() {
  const chip = el.filterChips.querySelector('[data-filter="favorites"] .filter-count');
  if (chip) chip.textContent = String(session.links.filter((link) => link.isFavorite).length);
}

function persistFavorite(link, isFavorite, revision, previousFavorite) {
  const priorSave = favoriteSaveQueues.get(link.id) ?? Promise.resolve();
  const requestHeaders = {
    "x-partner-name": session.name,
    "x-couple-code": session.code,
    "x-sharelink-action": "favorite",
    "x-sharelink-favorite": String(isFavorite),
  };
  const save = priorSave.catch(() => {}).then(async () => {
    await api(`/api/links/${link.id}`, {
      method: "PATCH",
      headers: requestHeaders,
      includeAuth: false,
    });
    persistedFavorites.set(link.id, isFavorite);
  }).catch((error) => {
    if (favoriteRevisions.get(link.id) !== revision) return;
    link.isFavorite = persistedFavorites.get(link.id) ?? previousFavorite;
    const row = updateFavoriteRow(link);
    const remainsPending = !link.isFavorite && activeFilter === "favorites";
    if (row) row.classList.toggle("favorite-pending-removal", remainsPending);
    hideToast();
    showToast(error.message || "Could not update favorite.", remainsPending
      ? { type: "removed", linkId: link.id, undo: false }
      : null, true);
    if (remainsPending) scheduleFavoriteRemoval(link.id);
  }).finally(() => {
    if (favoriteSaveQueues.get(link.id) === save) favoriteSaveQueues.delete(link.id);
    if (!link.isFavorite && activeFilter === "favorites" && rowIsPendingRemoval(link.id) && activeFavoriteToast?.linkId !== link.id) {
      removeFavoriteRow(link.id);
    }
  });
  favoriteSaveQueues.set(link.id, save);
}

function rowIsPendingRemoval(linkId) {
  return Boolean(el.linkFeed.querySelector(`[data-id="${linkId}"].favorite-pending-removal`));
}

function showToast(message, favoriteAction = null, isError = false) {
  window.clearTimeout(toastTimer);
  activeFavoriteToast = favoriteAction;
  el.toastMessage.textContent = message;
  const hasUndo = Boolean(favoriteAction && favoriteAction.undo !== false);
  el.toastUndo.classList.toggle("hidden", !hasUndo);
  el.toastSeparator.classList.toggle("hidden", !hasUndo);
  el.toast.classList.toggle("is-error", isError);
  el.toast.classList.remove("hidden");
  toastTimer = window.setTimeout(() => {
    hideToast();
  }, 5000);
}

function scheduleFavoriteRemoval(linkId) {
  clearFavoriteRemovalTimer(linkId);
  favoriteRemovalTimers.set(linkId, window.setTimeout(() => {
    favoriteRemovalTimers.delete(linkId);
    expireFavoriteRemoval(linkId);
  }, 5000));
}

function clearFavoriteRemovalTimer(linkId) {
  const timer = favoriteRemovalTimers.get(linkId);
  if (timer) window.clearTimeout(timer);
  favoriteRemovalTimers.delete(linkId);
}

function hideToast() {
  window.clearTimeout(toastTimer);
  toastTimer = 0;
  activeFavoriteToast = null;
  el.toast.classList.add("hidden");
  el.toast.classList.remove("is-error");
}

function undoFavoriteChange() {
  const action = activeFavoriteToast;
  if (!action) return;
  hideToast();
  const link = session.links.find((entry) => entry.id === action.linkId);
  if (link) setFavorite(link, action.previousFavorite, { showToast: false });
}

function expireFavoriteRemoval(linkId) {
  const removeIfStillPending = () => {
    const link = session.links.find((entry) => entry.id === linkId);
    if (activeFilter === "favorites" && link && !link.isFavorite && rowIsPendingRemoval(linkId)) {
      removeFavoriteRow(linkId);
    }
  };
  const save = favoriteSaveQueues.get(linkId);
  if (save) save.then(removeIfStillPending);
  else removeIfStillPending();
}

function removeFavoriteRow(linkId) {
  const row = el.linkFeed.querySelector(`[data-id="${linkId}"]`);
  if (!row) return;
  const group = row.closest(".day-group");
  row.remove();
  if (group && !group.querySelector(".link-item")) group.remove();
  if (activeFilter === "favorites" && !el.linkFeed.querySelector(".link-item")) {
    el.noResults.querySelector("span").textContent = "No links match. Clear filters";
    el.noResults.classList.remove("hidden");
  }
}

/* ══════════════════════════════════════════════════════════════════════
   COMPOSER
══════════════════════════════════════════════════════════════════════ */
function expandComposer() {
  el.composerExtra.classList.remove("hidden");
  el.extrasToggle.setAttribute("aria-expanded", "true");
  el.extrasToggle.innerHTML = 'Hide note or tags <span aria-hidden="true">−</span>';
}

function collapseComposer() {
  el.composerExtra.classList.add("hidden");
  el.extrasToggle.setAttribute("aria-expanded", "false");
  el.extrasToggle.innerHTML = 'Add note or tags <span aria-hidden="true">+</span>';
}

function onComposerUrlInput() {
  const rawUrl = el.urlInput.value.trim();
  if (el.titleInput.value === autoFetchedTitle) el.titleInput.value = "";
  autoFetchedTitle = "";
  const revision = ++metadataPreviewRevision;
  window.clearTimeout(metadataPreviewTimer);
  if (!rawUrl) {
    el.composerPreview.classList.add("hidden");
    el.composerPreviewLoading.classList.add("hidden");
    autoFetchedTitle = "";
    return;
  }

  let url;
  try {
    url = new URL(rawUrl);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname) throw new Error("Invalid URL");
  } catch {
    el.composerPreview.classList.add("hidden");
    return;
  }

  expandComposer();
  el.composerPreview.classList.remove("hidden");
  el.composerDomain.textContent = url.hostname.replace(/^www\./, "");
  el.composerPreviewLoading.classList.remove("hidden");
  el.composerFavicon.classList.remove("hidden");
  el.composerFaviconLetter.classList.add("hidden");
  el.composerFaviconLetter.textContent = url.hostname.charAt(0).toLocaleUpperCase();
  el.composerFavicon.src = faviconFor(url.toString());
  el.composerFavicon.onerror = () => {
    el.composerFavicon.classList.add("hidden");
    el.composerFaviconLetter.classList.remove("hidden");
  };
  el.composerFavicon.onload = () => {
    el.composerFavicon.classList.remove("hidden");
    el.composerFaviconLetter.classList.add("hidden");
  };
  metadataPreviewTimer = window.setTimeout(async () => {
    try {
      const { metadata } = await api("/api/preview-metadata", { method: "POST", body: { url: url.toString() } });
      if (revision !== metadataPreviewRevision || el.urlInput.value.trim() !== rawUrl) return;
      el.composerDomain.textContent = url.hostname.replace(/^www\./, "");
      if (metadata.favicon) {
        el.composerFavicon.classList.remove("hidden");
        el.composerFavicon.src = metadata.favicon;
      }
      const rawTitle = metadata.title || "";
      const nextTitle = !rawTitle || rawTitle.trim().length < 4 || /^(home|homepage|untitled|website)$/i.test(rawTitle.trim())
        ? url.hostname.replace(/^www\./, "")
        : rawTitle;
      if (nextTitle && (!el.titleInput.value.trim() || el.titleInput.value === autoFetchedTitle)) {
        el.titleInput.value = nextTitle;
        autoFetchedTitle = nextTitle;
      }
    } catch {
      // The URL and domain remain useful when a site blocks metadata requests.
    } finally {
      if (revision === metadataPreviewRevision) el.composerPreviewLoading.classList.add("hidden");
    }
  }, 360);
}

function tagValues() {
  return el.tagsInput.value.split(",").map((tag) => tag.trim()).filter(Boolean);
}

function setTagValues(values) {
  const unique = [];
  for (const value of values) {
    const tag = String(value).trim().replace(/,/g, "").slice(0, 24);
    if (tag && !unique.some((existing) => existing.toLocaleLowerCase() === tag.toLocaleLowerCase()) && unique.length < 10) unique.push(tag);
  }
  el.tagsInput.value = unique.join(", ");
  el.tagChipList.textContent = "";
  for (const tag of unique) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "tag-entry-chip";
    chip.dataset.removeTag = tag;
    chip.setAttribute("aria-label", `Remove tag ${tag}`);
    chip.append(document.createTextNode(`${tag} `));
    const removeMark = document.createElement("span");
    removeMark.setAttribute("aria-hidden", "true");
    removeMark.textContent = "×";
    chip.append(removeMark);
    el.tagChipList.append(chip);
  }
  renderTagSuggestions();
}

function addTag(value) {
  const values = tagValues();
  values.push(value);
  setTagValues(values);
  el.tagEntryInput.value = "";
  el.tagEntryInput.focus();
}

function onTagEntryKeydown(event) {
  if (event.key === "Enter" || event.key === ",") {
    event.preventDefault();
    if (el.tagEntryInput.value.trim()) addTag(el.tagEntryInput.value);
  } else if (event.key === "Backspace" && !el.tagEntryInput.value && tagValues().length) {
    const values = tagValues();
    values.pop();
    setTagValues(values);
  }
}

function onTagChipClick(event) {
  const chip = event.target.closest("[data-remove-tag]");
  if (!chip) return;
  setTagValues(tagValues().filter((tag) => tag !== chip.dataset.removeTag));
}

function renderTagSuggestions() {
  if (!el.tagSuggestions) return;
  const query = el.tagEntryInput.value.trim().toLocaleLowerCase();
  const selected = new Set(tagValues().map((tag) => tag.toLocaleLowerCase()));
  const tags = [...new Set(session.links.flatMap((link) => Array.isArray(link.tags) ? link.tags : []))]
    .filter((tag) => !selected.has(tag.toLocaleLowerCase()) && (!query || tag.toLocaleLowerCase().includes(query)))
    .slice(0, 6);
  el.tagSuggestions.textContent = "";
  for (const tag of tags) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tag-suggestion";
    button.dataset.tagSuggestion = tag;
    button.textContent = tag;
    el.tagSuggestions.append(button);
  }
  el.tagSuggestions.classList.toggle("hidden", !tags.length);
}

function onTagSuggestionClick(event) {
  const button = event.target.closest("[data-tag-suggestion]");
  if (button) addTag(button.dataset.tagSuggestion);
}

function clearFilters() {
  hideToast();
  activeFilter = "all";
  activeTag = null;
  el.searchInput.value = "";
  renderFeed();
  if (window.matchMedia("(max-width: 599px)").matches) openMobileSearch();
  el.searchInput.focus();
}

function personColorFor(name) {
  const colors = ["#86a995", "#8a9dc0", "#bf8c9c", "#c1a76f", "#84aeb0", "#a397c4"];
  let hash = 0;
  for (const char of String(name)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return colors[hash % colors.length];
}

async function onSaveLink(e) {
  e.preventDefault();
  clearError(el.linkError);
  setInputInvalid(el.urlInput, false);

  const body = {
    url:   el.urlInput.value.trim(),
    title: el.titleInput.value.trim(),
    note:  el.noteInput.value.trim(),
    tags:  tagValues(),
  };

  const editingId = el.editingId.value;

  if (!body.url && !editingId) {
    setInputInvalid(el.urlInput, true);
    showError(el.linkError, "Paste a URL first.");
    el.urlInput.focus();
    return;
  }

  if (!editingId) {
    const duplicate = session.links.find((link) => canonicalUrlForDuplicate(link.url) === canonicalUrlForDuplicate(body.url));
    if (duplicate) {
      showError(el.linkError, duplicateNotice(duplicate));
      setInputInvalid(el.urlInput, true);
      return;
    }
  }

  const path   = editingId ? `/api/links/${editingId}` : "/api/links";
  const method = editingId ? "PATCH" : "POST";

  // Show fetching hint when no custom title
  if (!editingId && !body.title) {
    setStatus("Fetching website preview…", true);
  }

  await withBusy(el.saveButton, async () => {
    const result = await api(path, { method, body });
    if (result.duplicate) {
      showError(el.linkError, duplicateNotice(result.link));
      setInputInvalid(el.urlInput, true);
      return;
    }
    const previewAfterSave = returnToPreviewId === Number(editingId) ? Number(editingId) : null;
    const newLinkId = !editingId ? result.link?.id : null;
    resetComposer();
    if (newLinkId !== null) {
      activeFilter = "all";
      activeTag = null;
      el.searchInput.value = "";
    }
    await loadLinks();
    if (newLinkId !== null) {
      const newRow = el.linkFeed.querySelector(`[data-id="${newLinkId}"]`);
      newRow?.classList.add("saved-highlight");
      newRow?.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => newRow?.classList.remove("saved-highlight"), 1600);
      showToast("Saved");
    }
    if (previewAfterSave !== null) {
      returnToPreviewId = null;
      const updated = session.links.find((link) => link.id === previewAfterSave);
      const row = el.linkFeed.querySelector(`[data-id="${previewAfterSave}"]`);
      if (updated && row) openPreview(updated, row);
    }
    clearStatus();
  }, el.linkError);

  clearStatus();
}

function startEdit(link, focusField = "title") {
  el.editingId.value  = link.id;
  el.urlInput.value   = link.url;
  el.titleInput.value = displayTitleFor(link);
  autoFetchedTitle = "";
  el.noteInput.value  = link.note ?? "";
  setTagValues(Array.isArray(link.tags) ? link.tags : []);
  el.composerPreview.classList.remove("hidden");
  el.composerDomain.textContent = domainOf(link.url);
  el.composerFavicon.src = link.faviconUrl || faviconFor(link.url);
  el.composerFavicon.classList.remove("hidden");
  el.composerFaviconLetter.textContent = domainOf(link.url).charAt(0).toLocaleUpperCase();
  el.composerFaviconLetter.classList.add("hidden");
  el.composerFavicon.onerror = () => {
    el.composerFavicon.classList.add("hidden");
    el.composerFaviconLetter.classList.remove("hidden");
  };
  el.saveBtnLabel.textContent = "Save changes";
  el.cancelEditButton.classList.remove("hidden");
  expandComposer();
  window.scrollTo({ top: 0, behavior: "smooth" });
  requestAnimationFrame(() => (focusField === "note" ? el.noteInput : focusField === "tags" ? el.tagEntryInput : el.titleInput).focus());
}

function resetComposer() {
  el.linkForm.reset();
  el.editingId.value = "";
  el.saveBtnLabel.textContent = "Save";
  el.cancelEditButton.classList.add("hidden");
  collapseComposer();
  el.composerPreview.classList.add("hidden");
  el.composerPreviewLoading.classList.add("hidden");
  el.tagSuggestions.classList.add("hidden");
  setTagValues([]);
  autoFetchedTitle = "";
  metadataPreviewRevision++;
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
  const headers = { "content-type": "application/json", ...(opts.headers ?? {}) };

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

  if (sameDay(d, today))     return "TODAY";
  if (sameDay(d, yesterday)) return "YESTERDAY";

  // Within this calendar year: "Wednesday, October 8"
  // Older: "October 8, 2024"
  const sameYear = d.getFullYear() === today.getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    weekday: sameYear ? "short" : undefined,
    month:   "short",
    day:     "numeric",
    year:    sameYear ? undefined : "numeric",
  }).format(d).toLocaleUpperCase();
}

function formatTime(value) {
  const d = isoToDate(value);
  return new Intl.DateTimeFormat(undefined, {
    hour:   "numeric",
    minute: "2-digit",
  }).format(d);
}

function formatShortDate(value) {
  if (!value) return "today";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(isoToDate(value));
}

function duplicateNotice(link) {
  const sender = link?.saverName || "someone";
  return `Already shared by ${sender} on ${formatShortDate(link?.createdAt)}`;
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

function canonicalUrlForDuplicate(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || ["fbclid", "gclid", "mc_cid", "mc_eid"].includes(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim().toLowerCase();
  }
}
