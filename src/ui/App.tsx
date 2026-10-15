import React, { useState, useEffect } from "react";
import { LoginScreen } from "./components/LoginScreen.js";
import { ListScreen } from "./components/ListScreen.js";
import { DetailScreen } from "./components/DetailScreen.js";
import type { UserSession, ScreenType } from "./types.js";

const SESSION_STORAGE_KEY = "sharelink_session";

interface AppProps {
  initialSession?: UserSession | null;
  initialScreen?: ScreenType;
  initialLinkId?: number;
}

export const App: React.FC<AppProps> = ({
  initialSession = null,
  initialScreen = "login",
  initialLinkId,
}) => {
  const [session, setSession] = useState<UserSession | null>(() => {
    if (initialSession !== null) return initialSession;
    try {
      const stored = localStorage.getItem(SESSION_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as UserSession;
        if (parsed?.partnerName && parsed?.coupleCode) {
          return parsed;
        }
      }
    } catch {
      // Fallback if localStorage unavailable
    }
    return null;
  });

  const [currentScreen, setCurrentScreen] = useState<ScreenType>(() => {
    if (!session && initialSession === null) return "login";
    return initialScreen;
  });

  const [selectedLinkId, setSelectedLinkId] = useState<number | undefined>(initialLinkId);

  // Sync state with window hash on mount and hashchange
  useEffect(() => {
    function handleHashChange() {
      const hash = window.location.hash;
      if (hash.startsWith("#link-")) {
        const id = Number(hash.replace("#link-", ""));
        if (!isNaN(id) && id > 0) {
          setSelectedLinkId(id);
          setCurrentScreen("detail");
          return;
        }
      }
      if (hash === "#list") {
        setCurrentScreen("list");
        setSelectedLinkId(undefined);
      } else if (hash === "#login") {
        setCurrentScreen("login");
      }
    }

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const handleLoginSuccess = (newSession: UserSession) => {
    setSession(newSession);
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(newSession));
    } catch {
      // Ignore storage errors
    }
    setCurrentScreen("list");
    window.location.hash = "#list";
  };

  const handleLogout = () => {
    setSession(null);
    try {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
    setSelectedLinkId(undefined);
    setCurrentScreen("login");
    window.location.hash = "#login";
  };

  const handleSelectLink = (linkId: number) => {
    setSelectedLinkId(linkId);
    setCurrentScreen("detail");
    window.location.hash = `#link-${linkId}`;
  };

  const handleBackToList = () => {
    setSelectedLinkId(undefined);
    setCurrentScreen("list");
    window.location.hash = "#list";
  };

  // If not logged in, always render LoginScreen
  if (!session || currentScreen === "login") {
    return <LoginScreen onSuccess={handleLoginSuccess} initialName={session?.partnerName} />;
  }

  // Detail screen
  if (currentScreen === "detail" && selectedLinkId !== undefined) {
    return (
      <DetailScreen
        session={session}
        linkId={selectedLinkId}
        onBack={handleBackToList}
      />
    );
  }

  // Default to List screen
  return (
    <ListScreen
      session={session}
      onSelectLink={handleSelectLink}
      onLogout={handleLogout}
    />
  );
};
