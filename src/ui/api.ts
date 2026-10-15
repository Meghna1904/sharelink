import type { Link, UserSession } from "./types.js";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function getAuthHeaders(session: UserSession): HeadersInit {
  return {
    "x-partner-name": session.partnerName,
    "x-couple-code": session.coupleCode,
  };
}

export async function login(name: string, code: string): Promise<{ partnerName: string }> {
  const trimmedName = name.trim();
  const trimmedCode = code.trim();

  if (!trimmedName) {
    throw new ApiError("Please enter your name.", 400);
  }
  if (!trimmedCode) {
    throw new ApiError("Please enter your shared code.", 400);
  }

  const res = await fetch("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: trimmedName, code: trimmedCode }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(data?.error || "Unable to enter shared space. Please try again.", res.status);
  }

  return { partnerName: data.partnerName || trimmedName };
}

export async function fetchLinks(session: UserSession): Promise<Link[]> {
  const res = await fetch("/api/links", {
    method: "GET",
    headers: getAuthHeaders(session),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(data?.error || "Could not load links. Please try again.", res.status);
  }

  return Array.isArray(data.links) ? data.links : [];
}

export async function fetchLink(session: UserSession, id: number): Promise<Link> {
  const res = await fetch(`/api/links/${id}`, {
    method: "GET",
    headers: getAuthHeaders(session),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(data?.error || "Link not found or failed to load.", res.status);
  }

  if (!data.link) {
    throw new ApiError("Link not found.", 404);
  }

  return data.link;
}

export async function saveLink(
  session: UserSession,
  payload: { url: string; title?: string; note?: string }
): Promise<Link> {
  const res = await fetch("/api/links", {
    method: "POST",
    headers: {
      ...getAuthHeaders(session),
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(data?.error || "Failed to save link.", res.status);
  }

  return data.link;
}
