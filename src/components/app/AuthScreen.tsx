"use client";

/* AuthScreen — the signed-out gate.
   Two onboarding habits side by side:
     • Phone + SMS code  (domestic / China default)
     • Email + password  (international)
   Plus social logins (WeChat / Google / Apple) when configured server-side.
   On success it calls useAuth().refresh() and the gate swaps in the app. */

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { useAuth } from "@/lib/auth-context";
import { LANGS } from "@/lib/i18n";
import {
  requestOtp,
  verifyOtp,
  loginEmail,
  registerEmail,
  oauthStartUrl,
  type ProviderStatus,
} from "@/lib/api-client";

import { Button } from "@/components/ds/Button";
import { Input } from "@/components/ds/Input";
import { Icon } from "@/components/ds/Icon";
import { LangSwitcher } from "@/components/ds/LangSwitcher";

type Method = "phone" | "email";

/** Map a server error code → an i18n key. */
function errKey(code: string): string {
  const map: Record<string, string> = {
    invalid_phone: "auth_err_invalid_phone",
    bad_code: "auth_err_bad_code",
    invalid_input: "auth_err_bad_code",
    invalid_email: "auth_err_invalid_email",
    weak_password: "auth_err_weak_password",
    email_taken: "auth_err_email_taken",
    invalid_credentials: "auth_err_invalid_credentials",
    provider_unavailable: "auth_err_provider_unavailable",
  };
  return map[code] ?? "auth_err_generic";
}

export default function AuthScreen() {
  const { t, lang, setLang } = useI18n();
  const { providers, refresh } = useAuth();

  const [method, setMethod] = useState<Method>("phone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Surface an OAuth redirect error (?auth_error=…) once on mount.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("auth_error");
    if (code) {
      setError(t(errKey(code)));
      window.history.replaceState({}, "", window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        background: "var(--paper)",
      }}
    >
      <div style={{ width: "100%", maxWidth: 380 }}>
        {/* lang switcher */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
          <LangSwitcher
            value={lang}
            onChange={setLang}
            languages={LANGS}
            align="right"
            tone="var(--candy-pink)"
          />
        </div>

        {/* brand */}
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/logo-mark.svg" width="48" height="48" alt="" />
          <div
            style={{
              fontFamily: "var(--font-pixel)",
              fontWeight: 700,
              fontSize: 26,
              marginTop: 8,
            }}
          >
            yummy <span style={{ color: "var(--candy-pink)" }}>or</span> not
          </div>
          <div style={{ color: "var(--ink-500)", fontSize: 14, marginTop: 6 }}>
            {t("auth_tagline")}
          </div>
        </div>

        {/* card */}
        <div
          className="yon-card"
          style={{ padding: 20, marginTop: 18, background: "var(--white)" }}
        >
          {/* method toggle */}
          <div
            style={{
              display: "flex",
              gap: 6,
              marginBottom: 18,
              background: "var(--paper)",
              border: "var(--border-w) solid var(--ink-900)",
              borderRadius: "var(--radius-md)",
              padding: 4,
            }}
          >
            <MethodTab
              active={method === "phone"}
              onClick={() => { setMethod("phone"); setError(null); }}
              label={t("auth_phone_tab")}
            />
            <MethodTab
              active={method === "email"}
              onClick={() => { setMethod("email"); setError(null); }}
              label={t("auth_email_tab")}
            />
          </div>

          {method === "phone" ? (
            <PhoneForm busy={busy} setBusy={setBusy} setError={setError} onDone={refresh} />
          ) : (
            <EmailForm busy={busy} setBusy={setBusy} setError={setError} onDone={refresh} />
          )}

          {error && (
            <div
              style={{
                marginTop: 14,
                padding: "10px 12px",
                borderRadius: "var(--radius-md)",
                background: "var(--verdict-nah, #ffe3e3)",
                border: "var(--border-w) solid var(--ink-900)",
                color: "#fff",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {error}
            </div>
          )}

          {/* social logins */}
          <SocialButtons providers={providers} method={method} t={t} setError={setError} />
        </div>
      </div>
    </div>
  );
}

/* ── tab ─────────────────────────────────────────────────────────────────── */
function MethodTab({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        cursor: "pointer",
        padding: "9px 0",
        borderRadius: "var(--radius-sm)",
        border: "none",
        background: active ? "var(--candy-yellow)" : "transparent",
        fontFamily: "var(--font-body)",
        fontWeight: 700,
        fontSize: 14,
        color: "var(--ink-900)",
      }}
    >
      {label}
    </button>
  );
}

/* ── phone (domestic) ──────────────────────────────────────────────────────── */
function PhoneForm({
  busy,
  setBusy,
  setError,
  onDone,
}: {
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
  onDone: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);

  const send = async () => {
    setError(null);
    setBusy(true);
    try {
      const { devCode } = await requestOtp(phone);
      setSent(true);
      setDevCode(devCode ?? null);
    } catch (e) {
      setError(t(errKey((e as Error).message)));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setError(null);
    setBusy(true);
    try {
      await verifyOtp(phone, code);
      await onDone();
    } catch (e) {
      setError(t(errKey((e as Error).message)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Input
        label={t("auth_phone_label")}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder={t("auth_phone_ph")}
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />
      {sent && (
        <>
          <Input
            label={t("auth_code_label")}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder={t("auth_code_ph")}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            hint={devCode ? t("auth_dev_code", { code: devCode }) : undefined}
          />
        </>
      )}
      {!sent ? (
        <Button block onClick={send} disabled={busy || !phone}>
          {t("auth_send_code")}
        </Button>
      ) : (
        <>
          <Button block onClick={verify} disabled={busy || code.length < 6}>
            {t("auth_verify")}
          </Button>
          <button
            onClick={send}
            disabled={busy}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--candy-pink)",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {t("auth_resend")}
          </button>
        </>
      )}
    </div>
  );
}

/* ── email (international) ──────────────────────────────────────────────────── */
function EmailForm({
  busy,
  setBusy,
  setError,
  onDone,
}: {
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
  onDone: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      if (mode === "register") {
        await registerEmail({ email, password, displayName: name });
      } else {
        await loginEmail({ email, password });
      }
      await onDone();
    } catch (e) {
      setError(t(errKey((e as Error).message)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {mode === "register" && (
        <Input
          label={t("auth_name_label")}
          autoComplete="name"
          placeholder={t("auth_name_ph")}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      )}
      <Input
        label={t("auth_email_label")}
        type="email"
        autoComplete="email"
        placeholder={t("auth_email_ph")}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Input
        label={t("auth_password_label")}
        type="password"
        autoComplete={mode === "register" ? "new-password" : "current-password"}
        placeholder={t("auth_password_ph")}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <Button block onClick={submit} disabled={busy || !email || !password}>
        {mode === "login" ? t("auth_login") : t("auth_register")}
      </Button>
      <button
        onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--candy-pink)",
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        {mode === "login" ? t("auth_to_register") : t("auth_to_login")}
      </button>
    </div>
  );
}

/* ── social buttons ────────────────────────────────────────────────────────── */
function SocialButtons({
  providers,
  method,
  t,
  setError,
}: {
  providers: ProviderStatus[];
  method: Method;
  t: (k: string, v?: Record<string, string | number>) => string;
  setError: (e: string | null) => void;
}) {
  // Surface the providers that match the current habit first; fall back to all.
  const audience = method === "phone" ? "domestic" : "international";
  const shown = providers.filter((p) => p.audience === audience);
  if (shown.length === 0) return null;

  return (
    <div style={{ marginTop: 18 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          margin: "4px 0 14px",
          color: "var(--ink-400)",
          fontSize: 12,
          fontFamily: "var(--font-micro)",
          letterSpacing: ".08em",
          textTransform: "uppercase",
        }}
      >
        <span style={{ flex: 1, height: 2, background: "var(--ink-200)" }} />
        {t("auth_or")}
        <span style={{ flex: 1, height: 2, background: "var(--ink-200)" }} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {shown.map((p) => {
          const label = t("auth_continue_with", { p: p.label });
          if (!p.configured) {
            return (
              <Button
                key={p.id}
                variant="secondary"
                block
                onClick={() => setError(t("auth_err_provider_unavailable", { p: p.label }))}
                iconLeft={<Icon name="lock" size={16} color="var(--ink-400)" />}
                style={{ opacity: 0.6 }}
              >
                {label}
              </Button>
            );
          }
          return (
            <a key={p.id} href={oauthStartUrl(p.id)} style={{ textDecoration: "none" }}>
              <Button
                variant="secondary"
                block
                iconLeft={<Icon name="user" size={16} color="var(--ink-700)" />}
              >
                {label}
              </Button>
            </a>
          );
        })}
      </div>
    </div>
  );
}
