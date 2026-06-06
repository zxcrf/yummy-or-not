"use client";

/* AppGate — decides between the signed-out AuthScreen and the signed-in app.
   While the session is being resolved it shows a minimal splash so we don't
   flash the login screen for already-authenticated users. */

import { useAuth } from "@/lib/auth-context";
import { Icon } from "@/components/ds/Icon";
import AppShell from "./AppShell";
import AuthScreen from "./AuthScreen";

export default function AppGate() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--paper)",
        }}
      >
        <Icon name="grid" size={32} color="var(--ink-300)" />
      </div>
    );
  }

  return user ? <AppShell /> : <AuthScreen />;
}
