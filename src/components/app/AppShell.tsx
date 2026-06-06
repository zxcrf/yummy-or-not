"use client";

/* AppShell — responsive one-page app.
   ≥ 900px: web sidebar layout (236px sidebar + main content area).
   < 900px: mobile chrome — top bar + fixed bottom tab bar with center FAB.
   Both layouts share the same view components. */

import { useEffect, useState } from "react";
import { type Taste } from "@/lib/types";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { useAuth } from "@/lib/auth-context";
import { listTastes } from "@/lib/api-client";

import { Button } from "@/components/ds/Button";
import { LangSwitcher } from "@/components/ds/LangSwitcher";
import { Avatar } from "@/components/ds/Avatar";
import { Icon } from "@/components/ds/Icon";
import { LANGS } from "@/lib/i18n";

import LibraryView from "./LibraryView";
import RecallView from "./RecallView";
import StatsView from "./StatsView";
import YouView from "./YouView";
import AddModal from "./AddModal";
import DetailView from "./DetailView";

type View = "library" | "recall" | "stats" | "you";

/* ------------------------------------------------------------------ */
/*  Sidebar (desktop)                                                   */
/* ------------------------------------------------------------------ */
function Sidebar({
  view,
  setView,
  onAdd,
}: {
  view: View;
  setView: (v: View) => void;
  onAdd: () => void;
}) {
  const { t, lang, setLang } = useI18n();
  const { user, signOut } = useAuth();

  const navItem = (key: View, icon: string, label: string) => {
    const on = view === key;
    return (
      <button
        onClick={() => setView(key)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          width: "100%",
          textAlign: "left",
          cursor: "pointer",
          padding: "11px 14px",
          borderRadius: "var(--radius-md)",
          border: on
            ? "var(--border-w) solid var(--ink-900)"
            : "var(--border-w) solid transparent",
          background: on ? "var(--candy-yellow)" : "transparent",
          boxShadow: on ? "var(--shadow-pop-sm)" : "none",
          fontFamily: "var(--font-body)",
          fontWeight: 600,
          fontSize: 15,
          color: "var(--ink-900)",
        }}
      >
        <Icon name={icon} size={20} color="var(--ink-900)" />
        {label}
      </button>
    );
  };

  return (
    <aside
      style={{
        width: 236,
        flex: "none",
        background: "var(--white)",
        borderRight: "var(--border-w) solid var(--ink-900)",
        display: "flex",
        flexDirection: "column",
        padding: 18,
        gap: 6,
      }}
    >
      {/* logo */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "4px 6px 14px",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/logo-mark.svg" width="34" height="34" alt="" />
        <span
          style={{
            fontFamily: "var(--font-pixel)",
            fontWeight: 700,
            fontSize: 19,
            lineHeight: 1,
          }}
        >
          yummy <span style={{ color: "var(--candy-pink)" }}>or</span> not
        </span>
      </div>

      {/* lang switcher */}
      <div style={{ padding: "0 2px 14px" }}>
        <LangSwitcher
          value={lang}
          onChange={setLang as (code: string) => void}
          languages={LANGS}
          align="left"
          tone="var(--candy-pink)"
        />
      </div>

      {/* nav */}
      {navItem("library", "grid", t("your_tastes"))}
      {navItem("recall", "search", t("nav_recall"))}
      {navItem("stats", "chart-bar", t("nav_stats"))}

      <div style={{ flex: 1 }} />

      {/* log a taste CTA */}
      <Button
        variant="primary"
        block
        onClick={onAdd}
        iconLeft={<Icon name="plus" size={18} color="#fff" />}
      >
        {t("log_taste")}
      </Button>

      {/* user footer */}
      {(() => {
        const displayName =
          user?.displayName || user?.email || user?.phone || "—";
        return (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginTop: 14,
              padding: "10px 6px 2px",
              borderTop: "2px dotted var(--ink-200)",
            }}
          >
            <Avatar name={displayName} src={user?.avatar || undefined} size="sm" />
            <div style={{ lineHeight: 1.2, flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 14,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {displayName}
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-500)" }}>
                {user?.plan === "pro" ? t("pro_plan") : t("free_plan")}
              </div>
            </div>
            <button
              onClick={signOut}
              aria-label={t("auth_signout")}
              title={t("auth_signout")}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 4,
                flex: "none",
              }}
            >
              <Icon name="arrow-right" size={18} color="var(--ink-400)" />
            </button>
          </div>
        );
      })()}
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/*  TopBar (mobile)                                                     */
/* ------------------------------------------------------------------ */
function TopBar() {
  const { lang, setLang } = useI18n();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        padding: "12px 16px",
        background: "var(--paper)",
        borderBottom: "var(--border-w) solid var(--ink-900)",
        flex: "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/logo-mark.svg" width="30" height="30" alt="" />
        <span
          style={{
            fontFamily: "var(--font-pixel)",
            fontWeight: 700,
            fontSize: 20,
            lineHeight: 1,
          }}
        >
          yummy <span style={{ color: "var(--candy-pink)" }}>or</span> not
        </span>
      </div>
      <LangSwitcher
        value={lang}
        onChange={setLang}
        languages={LANGS}
        align="right"
        tone="var(--candy-pink)"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  TabBar (mobile)                                                     */
/* ------------------------------------------------------------------ */
function TabBar({
  view,
  setView,
  onAdd,
}: {
  view: View;
  setView: (v: View) => void;
  onAdd: () => void;
}) {
  const { t } = useI18n();

  const tabItem = (key: View, icon: string, label: string) => {
    const on = view === key;
    return (
      <button
        onClick={() => setView(key)}
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 3,
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "6px 0",
          fontFamily: "var(--font-micro)",
          fontSize: 9,
          letterSpacing: ".06em",
          textTransform: "uppercase",
          color: on ? "var(--candy-pink)" : "var(--ink-400)",
        }}
      >
        <Icon
          name={icon}
          size={24}
          color={on ? "var(--candy-pink)" : "var(--ink-400)"}
        />
        {label}
      </button>
    );
  };

  return (
    <div
      style={{
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: 4,
        borderTop: "var(--border-w) solid var(--ink-900)",
        background: "var(--white)",
        padding: "6px 8px 26px",
        position: "relative",
      }}
    >
      {tabItem("library", "grid", t("your_tastes"))}
      {tabItem("recall", "search", t("nav_recall"))}

      {/* center FAB */}
      <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
        <button
          onClick={onAdd}
          aria-label={t("log_taste")}
          style={{
            width: 58,
            height: 58,
            marginTop: -34,
            borderRadius: "var(--radius-pill)",
            background: "var(--candy-pink)",
            color: "#fff",
            border: "var(--border-thick, 3px) solid var(--ink-900)",
            boxShadow: "var(--shadow-pop)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="plus" size={28} color="#fff" />
        </button>
      </div>

      {tabItem("stats", "chart-bar", t("nav_stats"))}
      {tabItem("you", "user", t("nav_you"))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  AppShell                                                            */
/* ------------------------------------------------------------------ */
export default function AppShell() {
  const [view, setView] = useState<View>("library");
  const [items, setItems] = useState<Taste[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);

  const selectedItem = items.find((it) => it.id === selectedId) ?? null;

  const loadTastes = () => {
    setLoading(true);
    listTastes()
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadTastes();
  }, []);

  const handleAdd = () => setAdding(true);
  const handleOpen = (id: string) => setSelectedId(id);
  const handleClose = () => setSelectedId(null);
  const handleSaved = () => {
    setAdding(false);
    setView("library");
    loadTastes();
  };
  const handleDeleted = () => {
    setSelectedId(null);
    loadTastes();
  };

  const mainView = () => {
    if (view === "recall")
      return (
        <RecallView items={items} onOpen={handleOpen} onAdd={handleAdd} />
      );
    if (view === "stats") return <StatsView items={items} />;
    if (view === "you") return <YouView items={items} />;
    return (
      <LibraryView
        items={items}
        query={query}
        setQuery={setQuery}
        filter={filter}
        setFilter={setFilter}
        onOpen={handleOpen}
      />
    );
  };

  return (
    <>
      {/* ---- Desktop layout (≥ 900px) ---- */}
      <div className="yon-desktop-shell">
        <Sidebar view={view} setView={setView} onAdd={handleAdd} />
        <main className="yon-desktop-main">
          {loading ? (
            <div className="yon-loading">
              <Icon name="grid" size={32} color="var(--ink-300)" />
            </div>
          ) : (
            mainView()
          )}
        </main>

        {/* detail drawer */}
        {selectedItem && (
          <DetailView
            item={selectedItem}
            onClose={handleClose}
            onDeleted={handleDeleted}
          />
        )}
      </div>

      {/* ---- Mobile layout (< 900px) ---- */}
      <div className="yon-mobile-shell">
        {/* only show TopBar and TabBar when no full-screen overlay is open */}
        {!selectedItem && !adding && <TopBar />}

        <div className="yon-mobile-content">
          {selectedItem ? (
            <DetailView
              item={selectedItem}
              onClose={handleClose}
              onDeleted={handleDeleted}
            />
          ) : adding ? (
            <AddModal onClose={() => setAdding(false)} onSaved={handleSaved} />
          ) : loading ? (
            <div className="yon-loading">
              <Icon name="grid" size={32} color="var(--ink-300)" />
            </div>
          ) : (
            mainView()
          )}
        </div>

        {!selectedItem && !adding && (
          <TabBar view={view} setView={setView} onAdd={handleAdd} />
        )}
      </div>

      {/* ---- Desktop add modal (rendered outside shell so it layers above drawer) ---- */}
      {adding && (
        <div className="yon-desktop-add-modal">
          <AddModal onClose={() => setAdding(false)} onSaved={handleSaved} />
        </div>
      )}
    </>
  );
}
