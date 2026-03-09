"use client";

import React, { createContext, useContext, useState, useEffect } from "react";

type DemoUserContextType = {
  isDemoUser: boolean;
  userName: string;
  enableDemoMode: () => void;
  disableDemoMode: () => void;
};

const DemoUserContext = createContext<DemoUserContextType | undefined>(undefined);

export function DemoUserProvider({ children }: { children: React.ReactNode }) {
  const [isDemoUser, setIsDemoUser] = useState(false);
  
  // Try to load state from localStorage on mount
  useEffect(() => {
    const savedState = localStorage.getItem("oirte_demo_mode");
    if (savedState === "true") {
      setIsDemoUser(true);
    }
  }, []);

  const enableDemoMode = () => {
    setIsDemoUser(true);
    localStorage.setItem("oirte_demo_mode", "true");
  };

  const disableDemoMode = () => {
    setIsDemoUser(false);
    localStorage.setItem("oirte_demo_mode", "false");
    localStorage.removeItem("oirte_chat_history"); // clear cache if turning off
  };

  return (
    <DemoUserContext.Provider
      value={{
        isDemoUser,
        userName: isDemoUser ? "ARMIN SALAZAR" : "Invitado",
        enableDemoMode,
        disableDemoMode,
      }}
    >
      {children}
    </DemoUserContext.Provider>
  );
}

export function useDemoUser() {
  const context = useContext(DemoUserContext);
  if (context === undefined) {
    throw new Error("useDemoUser must be used within a DemoUserProvider");
  }
  return context;
}
