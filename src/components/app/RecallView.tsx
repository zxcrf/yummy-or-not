"use client";

/* Recall view — "tasted it before?" search.
   Shows verdict-on-file card or no-record empty state. */

import { useState } from "react";
import { type Taste } from "@/lib/types";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { Card } from "@/components/ds/Card";
import { Button } from "@/components/ds/Button";
import { VerdictStamp } from "@/components/ds/VerdictStamp";
import { Icon } from "@/components/ds/Icon";

const ACCENT: Record<string, string> = {
  yum: "var(--verdict-yum)",
  meh: "var(--verdict-meh)",
  nah: "var(--verdict-nah)",
};

interface Props {
  items: Taste[];
  onOpen: (id: string) => void;
  onAdd: () => void;
}

function RecallRow({
  item,
  onClick,
  flat,
}: {
  item: Taste;
  onClick: () => void;
  flat?: boolean;
}) {
  const { t } = useI18n();
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        width: "100%",
        textAlign: "left",
        cursor: "pointer",
        background: flat ? "transparent" : "var(--white)",
        border: flat ? "none" : "var(--border-w) solid var(--ink-900)",
        borderRadius: "var(--radius-md)",
        boxShadow: flat ? "none" : "var(--shadow-pop-sm)",
        padding: flat ? 0 : 10,
      }}
    >
      <div
        style={{
          width: 54,
          height: 54,
          borderRadius: "var(--radius-sm)",
          border: "2px solid var(--ink-900)",
          background: "var(--paper-3)",
          overflow: "hidden",
          flex: "none",
        }}
      >
        {item.image && (
          <img
            src={item.image}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: "var(--font-body)",
            fontWeight: 700,
            fontSize: 16,
          }}
        >
          {item.name}
        </div>
        <div style={{ color: "var(--ink-500)", fontSize: 13 }}>
          {item.place} · {item.date}
        </div>
      </div>
      <VerdictStamp
        verdict={item.verdict}
        size="sm"
        label={t("v_" + item.verdict)}
      />
    </button>
  );
}

export default function RecallView({ items, onOpen, onAdd }: Props) {
  const { t } = useI18n();
  const [q, setQ] = useState("");

  const VERDICT_KEY: Record<string, string> = {
    yum: "loved_it",
    meh: "soso",
    nah: "skip_it",
  };

  const match = q
    ? items.find((it) => it.name.toLowerCase().includes(q.toLowerCase()))
    : null;

  return (
    <div className="yon-recall-view">
      <div className="yon-recall-header">
        <h1
          style={{
            fontFamily: "var(--font-pixel)",
            fontSize: "clamp(28px, 5vw, 44px)",
            lineHeight: 1.02,
          }}
        >
          {t("recall_title")}
        </h1>
        <p style={{ color: "var(--ink-500)", marginTop: 10, fontSize: 17 }}>
          {t("recall_sub")}
        </p>
        <div style={{ position: "relative", marginTop: 18 }}>
          <span
            style={{
              position: "absolute",
              left: 14,
              top: "50%",
              transform: "translateY(-50%)",
              zIndex: 1,
            }}
          >
            <Icon name="search" size={22} color="var(--ink-400)" />
          </span>
          <input
            name="search"
            aria-label={t("recall_placeholder")}
            className="yon-input"
            placeholder={t("recall_placeholder")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ paddingLeft: 46, fontSize: 18, padding: "16px 16px 16px 46px" }}
            autoFocus
          />
        </div>
      </div>

      <div className="yon-recall-results">
        {!q && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <span
              style={{
                fontFamily: "var(--font-micro)",
                fontSize: 10,
                letterSpacing: ".1em",
                textTransform: "uppercase",
                color: "var(--ink-400)",
              }}
            >
              {t("recently_recalled")}
            </span>
            {items.slice(0, 4).map((it) => (
              <RecallRow key={it.id} item={it} onClick={() => onOpen(it.id)} />
            ))}
          </div>
        )}

        {q && match && (
          <Card variant="raised" style={{ overflow: "hidden" }}>
            <div
              style={{
                background: ACCENT[match.verdict],
                padding: "22px 22px 20px",
                color: match.verdict === "meh" ? "var(--ink-900)" : "#fff",
                borderBottom: "var(--border-w) solid var(--ink-900)",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-micro)",
                  fontSize: 11,
                  letterSpacing: ".12em",
                  textTransform: "uppercase",
                  opacity: 0.9,
                }}
              >
                {t("verdict_on_file")}
              </span>
              <div
                style={{
                  fontFamily: "var(--font-pixel)",
                  fontWeight: 700,
                  fontSize: 46,
                  marginTop: 6,
                }}
              >
                {t(VERDICT_KEY[match.verdict])}
              </div>
            </div>
            <div style={{ padding: 18 }}>
              <RecallRow
                item={match}
                onClick={() => onOpen(match.id)}
                flat
              />
            </div>
          </Card>
        )}

        {q && !match && (
          <Card padded style={{ textAlign: "center", padding: "40px" }}>
            <Icon name="info-box" size={40} color="var(--ink-300)" />
            <p style={{ marginTop: 12, fontWeight: 600, fontSize: 18 }}>
              {t("no_record", { q })}
            </p>
            <p style={{ color: "var(--ink-500)", marginTop: 4 }}>
              {t("try_then_log")}
            </p>
            <Button
              variant="primary"
              style={{ marginTop: 16 }}
              onClick={onAdd}
              iconLeft={<Icon name="plus" size={18} color="#fff" />}
            >
              {t("log_it_now")}
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
}
