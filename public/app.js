const state = {
  name: "",
  code: "",
  links: []
};

const elements = {
  loginView: document.querySelector("#loginView"),
  appView: document.querySelector("#appView"),
  loginForm: document.querySelector("#loginForm"),
  loginError: document.querySelector("#loginError"),
  partnerName: document.querySelector("#partnerName"),
  coupleCode: document.querySelector("#coupleCode"),
  logoutButton: document.querySelector("#logoutButton"),
  spaceLabel: document.querySelector("#spaceLabel"),
  linkForm: document.querySelector("#linkForm"),
  editingId: document.querySelector("#editingId"),
  urlInput: document.querySelector("#urlInput"),
  titleInput: document.querySelector("#titleInput"),
  noteInput: document.querySelector("#noteInput"),
  linkError: document.querySelector("#linkError"),
  saveButton: document.querySelector("#saveButton"),
  cancelEditButton: document.querySelector("#cancelEditButton"),
  linkList: document.querySelector("#linkList"),
  linkCount: document.querySelector("#linkCount"),
  emptyState: document.querySelector("#emptyState"),
  linkTemplate: document.querySelector("#linkTemplate")
};

restoreSession();

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError(elements.loginError);

  const name = elements.partnerName.value.trim();
  const code = elements.coupleCode.value.trim();
  if (!name || !code) {
    showError(elements.loginError, "Enter your name and shared code.");
    return;
  }

  await withButton(elements.loginForm.querySelector("button"), "Opening...", async () => {
    const response = await api("/api/session", {
      method: "POST",
      body: { name, code },
      includeAuth: false
    });

    state.name = response.partnerName;
    state.code = code;
    localStorage.setItem("sharelink.session", JSON.stringify({ name: state.name, code }));
    showApp();
    await loadLinks();
  }, elements.loginError);
});

elements.logoutButton.addEventListener("click", () => {
  localStorage.removeItem("sharelink.session");
  state.name = "";
  state.code = "";
  state.links = [];
  elements.appView.classList.add("hidden");
  elements.loginView.classList.remove("hidden");
  elements.partnerName.focus();
});

elements.linkForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError(elements.linkError);

  const body = {
    url: elements.urlInput.value.trim(),
    title: elements.titleInput.value.trim(),
    note: elements.noteInput.value.trim()
  };

  const editingId = elements.editingId.value;
  const path = editingId ? `/api/links/${editingId}` : "/api/links";
  const method = editingId ? "PATCH" : "POST";

  await withButton(elements.saveButton, editingId ? "Saving..." : "Saving...", async () => {
    await api(path, { method, body });
    resetComposer();
    await loadLinks();
  }, elements.linkError);
});

elements.cancelEditButton.addEventListener("click", resetComposer);

elements.linkList.addEventListener("click", async (event) => {
  const editButton = event.target.closest(".edit-link");
  const deleteButton = event.target.closest(".delete-link");
  const card = event.target.closest(".link-card");
  if (!card) {
    return;
  }

  const link = state.links.find((item) => item.id === Number(card.dataset.id));
  if (!link) {
    return;
  }

  if (editButton) {
    startEdit(link);
  }

  if (deleteButton) {
    const ok = confirm(`Delete "${link.title}"?`);
    if (!ok) {
      return;
    }
    clearError(elements.linkError);
    try {
      await api(`/api/links/${link.id}`, { method: "DELETE" });
      await loadLinks();
    } catch (error) {
      showError(elements.linkError, error.message);
    }
  }
});

function restoreSession() {
  try {
    const saved = JSON.parse(localStorage.getItem("sharelink.session") ?? "null");
    if (saved?.name && saved?.code) {
      state.name = saved.name;
      state.code = saved.code;
      showApp();
      loadLinks().catch((error) => {
        localStorage.removeItem("sharelink.session");
        elements.appView.classList.add("hidden");
        elements.loginView.classList.remove("hidden");
        showError(elements.loginError, error.message);
      });
    }
  } catch {
    localStorage.removeItem("sharelink.session");
  }
}

function showApp() {
  elements.loginView.classList.add("hidden");
  elements.appView.classList.remove("hidden");
  elements.spaceLabel.textContent = `${state.name}'s shared space`;
  elements.urlInput.focus();
}

async function loadLinks() {
  const response = await api("/api/links");
  state.links = response.links;
  renderLinks();
}

function renderLinks() {
  elements.linkList.textContent = "";
  elements.linkCount.textContent = String(state.links.length);
  elements.emptyState.classList.toggle("hidden", state.links.length > 0);

  for (const link of state.links) {
    const fragment = elements.linkTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".link-card");
    const title = fragment.querySelector(".link-title");
    const open = fragment.querySelector(".open-link");
    const url = fragment.querySelector(".link-url");
    const note = fragment.querySelector(".link-note");
    const meta = fragment.querySelector(".link-meta");
    const edit = fragment.querySelector(".edit-link");
    const del = fragment.querySelector(".delete-link");

    card.dataset.id = link.id;
    title.href = link.url;
    title.textContent = link.title || link.url;
    open.href = link.url;
    url.textContent = compactUrl(link.url);
    note.textContent = link.note;
    meta.textContent = `${link.saverName} saved ${formatDate(link.createdAt)}`;

    const isMine = link.saverName === state.name;
    edit.classList.toggle("hidden", !isMine);
    del.classList.toggle("hidden", !isMine);

    elements.linkList.append(fragment);
  }
}

function startEdit(link) {
  elements.editingId.value = link.id;
  elements.urlInput.value = link.url;
  elements.titleInput.value = link.title;
  elements.noteInput.value = link.note;
  elements.saveButton.textContent = "Save changes";
  elements.cancelEditButton.classList.remove("hidden");
  elements.urlInput.focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetComposer() {
  elements.linkForm.reset();
  elements.editingId.value = "";
  elements.saveButton.textContent = "Save link";
  elements.cancelEditButton.classList.add("hidden");
  clearError(elements.linkError);
}

async function api(path, options = {}) {
  const headers = { "content-type": "application/json" };
  if (options.includeAuth !== false) {
    headers["x-partner-name"] = state.name;
    headers["x-couple-code"] = state.code;
  }

  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed.");
  }
  return payload;
}

async function withButton(button, busyText, action, errorEl) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = busyText;
  try {
    await action();
  } catch (error) {
    showError(errorEl, error.message);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function compactUrl(value) {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return value;
  }
}

function formatDate(value) {
  const date = new Date(value.endsWith("Z") ? value : `${value}Z`);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function showError(element, message) {
  element.textContent = message;
}

function clearError(element) {
  element.textContent = "";
}
