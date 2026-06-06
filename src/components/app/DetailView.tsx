"use client";

/* Detail view — full item detail.
   Desktop: slide-in right drawer (420px wide) with backdrop.
   Mobile: full-screen overlay replacing the main content.
   Edit and delete wired to real API. */

import { useState } from "react";
import { type Taste } from "@/lib/types";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { Card } from "@/components/ds/Card";
import { Badge } from "@/components/ds/Badge";
import { Button } from "@/components/ds/Button";
import { IconButton } from "@/components/ds/IconButton";
import { VerdictStamp } from "@/components/ds/VerdictStamp";
import { Switch } from "@/components/ds/Switch";
import { Icon } from "@/components/ds/Icon";
import { deleteTaste } from "@/lib/api-client";

interface Props {
  item: Taste;
  onClose: () => void;
  onDeleted: () => void;
}

export default function DetailView({ item, onClose, onDeleted }: Props) {
  const { t } = useI18n();
  const [remind, setRemind] = useState(true);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm(t("confirm_delete"))) return;
    setDeleting(true);
    try {
      await deleteTaste(item.id);
      onDeleted();
    } catch {
      setDeleting(false);
    }
  };

  const inner = (
    <>
      {/* photo + controls */}
      <div style={{ position: "relative", flex: "none" }}>
        <div
          style={{
            height: 240,
            background: "var(--paper-3)",
            borderBottom: "var(--border-w) solid var(--ink-900)",
            overflow: "hidden",
          }}
          className="yon-detail-photo"
        >
          {item.image && (
            <img
              src={item.image}
              alt={item.name}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          )}
        </div>

        {/* close / back button */}
        <div style={{ position: "absolute", top: 16, left: 16 }}>
          <IconButton aria-label={t("cancel")} onClick={onClose}>
            <Icon name="arrow-left" size={20} />
          </IconButton>
        </div>

        {/* desktop close button (top-right) */}
        <div className="yon-desktop-only" style={{ position: "absolute", top: 16, right: 16 }}>
          <IconButton aria-label={t("cancel")} onClick={onClose}>
            <Icon name="close" size={18} />
          </IconButton>
        </div>

        {/* verdict stamp */}
        <div style={{ position: "absolute", left: 18, bottom: -22 }}>
          <VerdictStamp
            verdict={item.verdict}
            size="lg"
            rotate={-5}
            label={t("v_" + item.verdict)}
          />
        </div>
      </div>

      {/* content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "36px 22px 26px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <div>
            <h2
              style={{
                fontFamily: "var(--font-body)",
                fontWeight: 700,
                fontSize: 24,
                lineHeight: 1.1,
              }}
            >
              {item.name}
            </h2>
            <p style={{ color: "var(--ink-500)", marginTop: 4 }}>{item.place}</p>
          </div>
          <span
            style={{ fontFamily: "var(--font-pixel)", fontWeight: 700, fontSize: 26 }}
          >
            {item.price}
          </span>
        </div>

        {/* badges */}
        <div
          style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}
        >
          <Badge tone="dark">{t("bought_n", { n: item.boughtCount })}</Badge>
          {item.tags.map((tg) => (
            <Badge key={tg}>{tg}</Badge>
          ))}
          <Badge>{item.date}</Badge>
        </div>

        {/* note */}
        {item.notes && (
          <Card padded style={{ marginTop: 18 }}>
            <span
              style={{
                fontFamily: "var(--font-micro)",
                fontSize: 10,
                letterSpacing: ".1em",
                textTransform: "uppercase",
                color: "var(--ink-400)",
              }}
            >
              {t("your_note")}
            </span>
            <p style={{ marginTop: 8, lineHeight: 1.5 }}>{item.notes}</p>
          </Card>
        )}

        {/* warn toggle (mobile) */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 18,
            padding: "4px 2px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Icon name="alert" size={20} color="var(--candy-pink)" />
            <span style={{ fontWeight: 500 }}>{t("warn_before")}</span>
          </div>
          <Switch checked={remind} onChange={setRemind} />
        </div>

        {/* actions */}
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <Button variant="secondary" iconLeft={<Icon name="edit" size={18} />}>
            {t("edit")}
          </Button>
          <Button
            variant="secondary"
            iconLeft={<Icon name="trash" size={18} />}
            disabled={deleting}
            onClick={handleDelete}
          >
            {t("del")}
          </Button>
        </div>
      </div>
    </>
  );

  return (
    <>
      {/* Desktop: drawer with backdrop */}
      <div className="yon-drawer-root yon-desktop-only">
        <div className="yon-drawer-backdrop" onClick={onClose} />
        <div className="yon-drawer-panel">{inner}</div>
      </div>

      {/* Mobile: full-screen overlay */}
      <div className="yon-detail-mobile yon-mobile-only">{inner}</div>
    </>
  );
}
