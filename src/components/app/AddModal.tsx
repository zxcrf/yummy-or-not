"use client";

/* Add / log a taste — modal on desktop, full-screen on mobile.
   Handles photo upload via multipart FormData (field `photo`)
   or plain JSON when no file is chosen. */

import { useRef, useState } from "react";
import { TAG_CHOICES, type Verdict } from "@/lib/types";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { Button } from "@/components/ds/Button";
import { IconButton } from "@/components/ds/IconButton";
import { Input } from "@/components/ds/Input";
import { Textarea } from "@/components/ds/Textarea";
import { VerdictPicker } from "@/components/ds/VerdictPicker";
import { Tag } from "@/components/ds/Tag";
import { Icon } from "@/components/ds/Icon";
import { createTaste } from "@/lib/api-client";

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

const kicker: React.CSSProperties = {
  fontFamily: "var(--font-micro)",
  fontSize: 11,
  letterSpacing: ".12em",
  textTransform: "uppercase",
  color: "var(--ink-700)",
  marginBottom: 8,
};

export default function AddModal({ onClose, onSaved }: Props) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    name: "",
    place: "",
    price: "",
    notes: "",
  });
  const [verdict, setVerdict] = useState<Verdict | undefined>(undefined);
  const [picked, setPicked] = useState<string[]>([]);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const toggle = (tg: string) =>
    setPicked((p) =>
      p.includes(tg) ? p.filter((x) => x !== tg) : [...p, tg]
    );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setPhotoFile(file);
    if (file) {
      const url = URL.createObjectURL(file);
      setPhotoPreview(url);
    } else {
      setPhotoPreview(null);
    }
  };

  const ready = !!form.name && !!verdict;

  const handleSave = async () => {
    if (!ready || !verdict) return;
    setSaving(true);
    setError(null);
    try {
      await createTaste(
        {
          name: form.name,
          place: form.place || undefined,
          price: form.price || undefined,
          verdict,
          tags: picked.length ? picked : undefined,
          notes: form.notes || undefined,
        },
        photoFile
      );
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setSaving(false);
    }
  };

  return (
    /* Overlay backdrop */
    <div className="yon-modal-overlay" onClick={onClose}>
      {/* Modal / sheet content — stop propagation so clicking inside doesn't close */}
      <div
        className="yon-modal-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        {/* sticky header */}
        <div className="yon-modal-header">
          <h2 style={{ fontFamily: "var(--font-pixel)", fontSize: 24 }}>
            {t("log_taste")}
          </h2>
          <IconButton aria-label={t("cancel")} onClick={onClose}>
            <Icon name="close" size={18} />
          </IconButton>
        </div>

        {/* scrollable body */}
        <div className="yon-modal-body">
          {/* photo + basic fields row (desktop-style side-by-side; stacks on mobile) */}
          <div className="yon-add-top-row">
            {/* photo dropzone */}
            <div
              className="yon-photo-dropzone"
              onClick={() => fileRef.current?.click()}
              style={{
                backgroundImage: photoPreview
                  ? `url(${photoPreview})`
                  : undefined,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            >
              {!photoPreview && (
                <>
                  <Icon name="camera" size={32} color="var(--ink-400)" />
                  <span
                    style={{
                      fontFamily: "var(--font-micro)",
                      fontSize: 9,
                      letterSpacing: ".1em",
                      textTransform: "uppercase",
                      color: "var(--ink-500)",
                    }}
                  >
                    {t("add_photo")}
                  </span>
                </>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleFileChange}
              />
            </div>

            {/* text fields */}
            <div className="yon-add-fields">
              <Input
                label={t("f_what")}
                placeholder="Brown sugar boba"
                value={form.name}
                onChange={set("name")}
              />
              <Input
                label={t("f_where")}
                placeholder="Tiger Sugar · Hongdae"
                value={form.place}
                onChange={set("place")}
              />
              <Input
                label={t("f_price")}
                placeholder="$5.80"
                value={form.price}
                onChange={set("price")}
              />
            </div>
          </div>

          {/* verdict picker */}
          <div>
            <div style={kicker}>{t("how_was_it")}</div>
            <VerdictPicker
              value={verdict}
              onChange={setVerdict}
              labels={{
                yum: t("v_yum"),
                meh: t("v_meh"),
                nah: t("v_nah"),
              }}
            />
          </div>

          {/* tag chips */}
          <div>
            <div style={kicker}>{t("tags")}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {TAG_CHOICES.map((tg) => (
                <Tag
                  key={tg}
                  active={picked.includes(tg)}
                  onClick={() => toggle(tg)}
                >
                  {tg}
                </Tag>
              ))}
            </div>
          </div>

          {/* notes */}
          <Textarea
            label={t("your_take")}
            placeholder="Too sweet, but the texture was perfect…"
            rows={3}
            value={form.notes}
            onChange={set("notes")}
          />

          {error && (
            <p style={{ color: "var(--verdict-nah)", fontSize: 14 }}>{error}</p>
          )}

          {/* actions */}
          <div className="yon-modal-actions">
            <Button variant="ghost" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button
              variant="primary"
              disabled={!ready || saving}
              iconLeft={<Icon name="check" size={18} color="#fff" />}
              onClick={handleSave}
            >
              {t("save_taste_web")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
