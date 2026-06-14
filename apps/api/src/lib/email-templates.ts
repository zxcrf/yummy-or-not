// Email bodies for transactional mail. Pure string builders — no provider, no
// network, no deps — so they unit-test trivially and stay portable across any
// mailer wired into the reset-request route.
//
// i18n: the reset-request endpoint receives only { email } and has NO locale
// signal (no Accept-Language read, no per-user locale in the body), so the
// reset email is BILINGUAL (中文 + English), the two primary audiences. Do not
// pull the client i18n bundle into the API for this.

/** Minutes a reset token stays valid — mirror of PW_RESET_TTL_MS for copy. */
const RESET_TTL_MIN = 30;

export interface ResetEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * Body of the password-reset email.
 *
 * @param token raw 256-bit hex reset token (shown copyable for the manual /
 *   cross-device paste path — desktop mail can't open the app deep link).
 * @param link  the `yummyornot://reset-password?token=…` deep link (tappable on
 *   the phone to open the app straight to the new-password step).
 */
export function resetEmail({ token, link }: { token: string; link: string }): ResetEmail {
  const subject = "重置你的密码 / Reset your password";

  // Plaintext fallback — every mail client renders this.
  const text = [
    "【Yummy or Not】重置密码",
    "",
    "在手机上点击以下链接，直接打开 App 重置密码：",
    link,
    "",
    "在电脑上查看邮件？复制下面的验证码，在 App 的「重置密码」里粘贴：",
    token,
    "",
    `链接与验证码 ${RESET_TTL_MIN} 分钟内有效。若非本人操作，请忽略此邮件。`,
    "",
    "──────────",
    "",
    "[Yummy or Not] Reset your password",
    "",
    "On your phone, tap this link to open the app and reset your password:",
    link,
    "",
    "Reading this on a computer? Copy the code below and paste it into",
    '"Reset password" in the app:',
    token,
    "",
    `The link and code expire in ${RESET_TTL_MIN} minutes. If you didn't request this, ignore this email.`,
  ].join("\n");

  // Minimal inline-styled HTML — no external assets, no tracking pixels.
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#fff6e6;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#191017;">
    <div style="max-width:480px;margin:0 auto;background:#fff;border:3px solid #191017;border-radius:16px;padding:24px;">
      <h1 style="font-size:20px;margin:0 0 16px;">重置你的密码 / Reset your password</h1>
      <p style="font-size:14px;line-height:1.6;margin:0 0 16px;">
        在手机上点击下面的按钮直接重置；在电脑上请复制验证码到 App 粘贴。<br/>
        On your phone tap the button; on a computer copy the code into the app.
      </p>
      <p style="text-align:center;margin:0 0 20px;">
        <a href="${link}" style="display:inline-block;background:#ffd24a;color:#191017;text-decoration:none;font-weight:700;border:3px solid #191017;border-radius:12px;padding:12px 24px;">
          重置密码 / Reset password
        </a>
      </p>
      <p style="font-size:13px;margin:0 0 8px;color:#5b5159;">按钮无效？复制验证码 / Button not working? Copy the code:</p>
      <pre style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;background:#fff6e6;border:2px solid #191017;border-radius:8px;padding:12px;margin:0 0 20px;white-space:pre-wrap;word-break:break-all;">${token}</pre>
      <p style="font-size:12px;line-height:1.6;color:#8f8189;margin:0;">
        链接与验证码 ${RESET_TTL_MIN} 分钟内有效。若非本人操作，请忽略此邮件。<br/>
        The link and code expire in ${RESET_TTL_MIN} minutes. If you didn't request this, you can safely ignore this email.
      </p>
    </div>
  </body>
</html>`;

  return { subject, text, html };
}
