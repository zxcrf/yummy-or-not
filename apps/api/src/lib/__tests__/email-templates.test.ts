/* resetEmail — the password-reset email body builder.

   Pins the user-facing payload that must reach the inbox: the copyable
   token (the cross-device paste path depends on it), the tappable deep
   link, the 30-minute expiry, and the anti-phishing line. A regression
   that drops the token or link from the body would silently break reset
   for anyone whose mail client can't open the deep link. */
import { resetEmail } from '../email-templates';

const TOKEN = 'a'.repeat(64);
const LINK = `yummyornot://reset-password?token=${TOKEN}`;

describe('resetEmail', () => {
  const { subject, text, html } = resetEmail({ token: TOKEN, link: LINK });

  it('has a bilingual subject (API has no per-user locale signal)', () => {
    expect(subject).toContain('重置');
    expect(subject.toLowerCase()).toContain('reset');
  });

  it('carries the copyable token in BOTH text and html (manual/cross-device paste)', () => {
    expect(text).toContain(TOKEN);
    expect(html).toContain(TOKEN);
  });

  it('carries the tappable deep link in BOTH text and html', () => {
    expect(text).toContain(LINK);
    expect(html).toContain(`href="${LINK}"`);
  });

  it('states the 30-minute expiry and an anti-phishing line', () => {
    expect(text).toContain('30');
    expect(html).toContain('30');
    expect(text.toLowerCase()).toContain("didn't request");
    expect(text).toContain('若非本人操作');
  });

  it('embeds no external assets or tracking pixels', () => {
    expect(html).not.toMatch(/<img\b/i);
    expect(html).not.toMatch(/https?:\/\/(?!yon\.)/i); // no third-party http(s) resources
  });
});
