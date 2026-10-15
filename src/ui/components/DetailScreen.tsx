import React, { useState, useEffect } from "react";
import { fetchLink } from "../api.js";
import { PartnerBadge } from "./PartnerBadge.js";
import type { Link, UserSession } from "../types.js";

interface DetailScreenProps {
  session: UserSession;
  linkId: number;
  onBack: () => void;
  cachedLink?: Link;
}

function formatFullDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(d);
  } catch {
    return dateStr;
  }
}

export const DetailScreen: React.FC<DetailScreenProps> = ({
  session,
  linkId,
  onBack,
  cachedLink,
}) => {
  const [link, setLink] = useState<Link | null>(cachedLink || null);
  const [isLoading, setIsLoading] = useState<boolean>(!cachedLink);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadDetail() {
      // If we don't already have cachedLink, fetch from API
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const fetched = await fetchLink(session, linkId);
        if (isMounted) {
          setLink(fetched);
        }
      } catch (err: unknown) {
        if (isMounted) {
          if (err instanceof Error) {
            setErrorMessage(err.message);
          } else {
            setErrorMessage("Failed to load link details.");
          }
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadDetail();

    return () => {
      isMounted = false;
    };
  }, [session, linkId]);

  return (
    <div className="detail-screen">
      {/* ── Top Navigation Bar ───────────────────────────────── */}
      <header className="detail-header">
        <div className="detail-header-inner">
          <button
            type="button"
            className="btn-back"
            onClick={onBack}
            aria-label="Back to link list"
          >
            <span aria-hidden="true" className="back-arrow">←</span>
            <span>All links</span>
          </button>
        </div>
      </header>

      {/* ── Main Detail Content ──────────────────────────────── */}
      <main className="detail-container">
        {/* Loading State */}
        {isLoading && (
          <div className="detail-skeleton" aria-label="Loading link detail" aria-busy="true">
            <div className="skeleton-line skeleton-line--heading" />
            <div className="skeleton-line skeleton-line--meta" />
            <div className="skeleton-line skeleton-line--paragraph" />
          </div>
        )}

        {/* Error State */}
        {!isLoading && errorMessage && (
          <div className="detail-error" role="alert">
            <h2 className="detail-error-title">Unable to display link</h2>
            <p className="detail-error-message">{errorMessage}</p>
            <button type="button" className="btn-secondary" onClick={onBack}>
              Return to all links
            </button>
          </div>
        )}

        {/* Loaded State */}
        {!isLoading && !errorMessage && link && (
          <article className="detail-article">
            <div className="detail-author-row">
              <PartnerBadge name={link.saverName} size="md" />
              <div className="detail-author-info">
                <span className="detail-author-name">{link.saverName}</span>
                {link.createdAt && (
                  <time className="detail-timestamp" dateTime={link.createdAt}>
                    Saved {formatFullDate(link.createdAt)}
                  </time>
                )}
              </div>
            </div>

            <h1 className="detail-title">{link.title || link.url}</h1>

            <div className="detail-url-box">
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="detail-url-link"
              >
                <span className="url-text">{link.url}</span>
                <span className="url-icon" aria-hidden="true">↗</span>
              </a>
            </div>

            {link.note && (
              <div className="detail-note-card">
                <span className="detail-note-label">Note from {link.saverName}</span>
                <p className="detail-note-body">{link.note}</p>
              </div>
            )}
          </article>
        )}
      </main>
    </div>
  );
};
