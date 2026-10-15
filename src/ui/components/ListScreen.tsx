import React, { useState, useEffect, useCallback } from "react";
import { fetchLinks, saveLink } from "../api.js";
import { PartnerBadge } from "./PartnerBadge.js";
import type { Link, UserSession } from "../types.js";

interface ListScreenProps {
  session: UserSession;
  onSelectLink: (linkId: number) => void;
  onLogout: () => void;
}

function formatDisplayDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
    }).format(d);
  } catch {
    return "";
  }
}

function extractHostname(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return urlStr;
  }
}

export const ListScreen: React.FC<ListScreenProps> = ({ session, onSelectLink, onLogout }) => {
  const [links, setLinks] = useState<Link[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Minimal composer state
  const [urlInput, setUrlInput] = useState("");
  const [titleInput, setTitleInput] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);

  const loadLinks = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await fetchLinks(session);
      setLinks(data);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage("Failed to load links.");
      }
    } finally {
      setIsLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void loadLinks();
  }, [loadLinks]);

  const handleAddLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setComposerError(null);

    const trimmedUrl = urlInput.trim();
    if (!trimmedUrl) {
      setComposerError("Please enter a web address.");
      return;
    }

    setIsSubmitting(true);
    try {
      const newLink = await saveLink(session, {
        url: trimmedUrl,
        title: titleInput.trim() || undefined,
        note: noteInput.trim() || undefined,
      });

      setLinks((prev) => [newLink, ...prev]);
      setUrlInput("");
      setTitleInput("");
      setNoteInput("");
      setIsComposerOpen(false);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setComposerError(err.message);
      } else {
        setComposerError("Failed to save link.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="list-screen">
      {/* ── Editorial Header ───────────────────────────────────── */}
      <header className="app-header">
        <div className="app-header-inner">
          <div className="header-brand">
            <span className="brand-wordmark">
              Share<em>Link</em>
            </span>
            <span className="header-user">
              <PartnerBadge name={session.partnerName} size="sm" />
              <span className="header-username">{session.partnerName}</span>
            </span>
          </div>

          <button
            type="button"
            className="btn-text btn-switch"
            onClick={onLogout}
            title="Sign out or switch space"
          >
            Switch
          </button>
        </div>
      </header>

      {/* ── Main Feed Content ─────────────────────────────────── */}
      <main className="feed-container">
        {/* ── Minimal Composer ───────────────────────────────── */}
        <section className="composer-section" aria-label="Save a new link">
          <form onSubmit={handleAddLink} className="composer-form">
            <div className="composer-input-row">
              <input
                type="url"
                className="form-input composer-url-input"
                placeholder="Paste a link to save together…"
                value={urlInput}
                onChange={(e) => {
                  setUrlInput(e.target.value);
                  if (!isComposerOpen && e.target.value.length > 0) {
                    setIsComposerOpen(true);
                  }
                }}
                onFocus={() => setIsComposerOpen(true)}
                disabled={isSubmitting}
                aria-label="URL to save"
              />

              <button
                type="submit"
                className="btn-primary composer-submit"
                disabled={isSubmitting || !urlInput.trim()}
              >
                {isSubmitting ? "Saving…" : "Save"}
              </button>
            </div>

            {isComposerOpen && (
              <div className="composer-expandable">
                <div className="composer-fields">
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Title (optional, fetched automatically if empty)"
                    value={titleInput}
                    onChange={(e) => setTitleInput(e.target.value)}
                    disabled={isSubmitting}
                    maxLength={140}
                  />
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Short note or thought for your partner (optional)"
                    value={noteInput}
                    onChange={(e) => setNoteInput(e.target.value)}
                    disabled={isSubmitting}
                    maxLength={600}
                  />
                </div>
                <div className="composer-actions">
                  <button
                    type="button"
                    className="btn-text"
                    onClick={() => {
                      setIsComposerOpen(false);
                      setComposerError(null);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {composerError && (
              <div className="form-error composer-error" role="alert">
                <span>{composerError}</span>
              </div>
            )}
          </form>
        </section>

        {/* ── Loading Skeleton State ─────────────────────────── */}
        {isLoading && (
          <div className="feed-skeleton" aria-label="Loading links" aria-busy="true">
            {[1, 2, 3].map((n) => (
              <div key={n} className="skeleton-item">
                <div className="skeleton-badge" />
                <div className="skeleton-text-group">
                  <div className="skeleton-line skeleton-line--title" />
                  <div className="skeleton-line skeleton-line--sub" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Error State ────────────────────────────────────── */}
        {!isLoading && errorMessage && (
          <div className="feed-error" role="alert">
            <p className="feed-error-text">{errorMessage}</p>
            <button type="button" className="btn-secondary" onClick={() => void loadLinks()}>
              Try again
            </button>
          </div>
        )}

        {/* ── Empty State ────────────────────────────────────── */}
        {!isLoading && !errorMessage && links.length === 0 && (
          <div className="feed-empty" role="region" aria-label="Empty link list">
            <span className="empty-glyph" aria-hidden="true">✦</span>
            <h2 className="empty-heading">Nothing here yet</h2>
            <p className="empty-message">
              Paste your first link above to start collecting stories, recipes, or ideas together.
            </p>
          </div>
        )}

        {/* ── Loaded Links State ─────────────────────────────── */}
        {!isLoading && !errorMessage && links.length > 0 && (
          <div className="feed-list" role="feed" aria-label="Shared links">
            {links.map((link) => (
              <article
                key={link.id}
                className="link-row"
                onClick={() => onSelectLink(link.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectLink(link.id);
                  }
                }}
                aria-label={`View details for ${link.title || link.url}`}
              >
                <div className="link-row-author">
                  <PartnerBadge name={link.saverName} size="md" />
                </div>

                <div className="link-row-body">
                  <div className="link-row-headline">
                    <h2 className="link-row-title">{link.title || link.url}</h2>
                    {link.createdAt && (
                      <time className="link-row-date" dateTime={link.createdAt}>
                        {formatDisplayDate(link.createdAt)}
                      </time>
                    )}
                  </div>

                  <div className="link-row-meta">
                    <span className="link-row-domain">{extractHostname(link.url)}</span>
                    {link.note && <span className="link-row-note-preview">· {link.note}</span>}
                  </div>
                </div>

                <span className="link-row-arrow" aria-hidden="true">
                  →
                </span>
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};
