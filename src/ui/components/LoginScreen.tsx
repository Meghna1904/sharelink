import React, { useState } from "react";
import { login } from "../api.js";
import type { UserSession } from "../types.js";

interface LoginScreenProps {
  onSuccess: (session: UserSession) => void;
  initialName?: string;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onSuccess, initialName = "" }) => {
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const trimmedName = name.trim();
    const trimmedCode = code.trim();

    if (!trimmedName) {
      setErrorMessage("Please enter your name.");
      return;
    }

    if (!trimmedCode) {
      setErrorMessage("Please enter the shared couple code.");
      return;
    }

    setIsLoading(true);
    try {
      const res = await login(trimmedName, trimmedCode);
      onSuccess({
        partnerName: res.partnerName,
        coupleCode: trimmedCode,
      });
    } catch (err: unknown) {
      if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage("An unexpected error occurred. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="login-screen" aria-label="Sign in to your shared space">
      <div className="login-card">
        <header className="login-header">
          <h1 className="login-wordmark">
            Share<em>Link</em>
          </h1>
          <p className="login-tagline">A quiet place to collect things together.</p>
        </header>

        <form onSubmit={handleSubmit} className="login-form" noValidate>
          <div className="form-field">
            <label htmlFor="login-name" className="form-label">
              Your name
            </label>
            <input
              id="login-name"
              type="text"
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Alex"
              disabled={isLoading}
              autoComplete="given-name"
              autoFocus
            />
          </div>

          <div className="form-field">
            <label htmlFor="login-code" className="form-label">
              Shared code
            </label>
            <input
              id="login-code"
              type="password"
              className="form-input"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Your secret word or phrase"
              disabled={isLoading}
              autoComplete="current-password"
            />
            <span className="field-hint">
              Both of you use the exact same code to enter the space.
            </span>
          </div>

          {errorMessage && (
            <div className="form-error" role="alert" aria-live="assertive">
              <span className="error-icon" aria-hidden="true">⚠</span>
              <span>{errorMessage}</span>
            </div>
          )}

          <button
            type="submit"
            className="btn-primary btn-submit"
            disabled={isLoading}
            aria-busy={isLoading}
          >
            {isLoading ? (
              <span className="btn-loading">
                <span className="spinner" aria-hidden="true" />
                <span>Entering space…</span>
              </span>
            ) : (
              "Open space"
            )}
          </button>
        </form>
      </div>
    </main>
  );
};
