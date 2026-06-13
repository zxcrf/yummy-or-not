// Tests for the S3a 可导入 (淘口令) share-token codec (share-token.ts — NOT yet
// implemented, so these FAIL now and PASS once the patch lands).
//
//   encodeShareToken(importCode) → a delimited, collision-resistant 口令 string
//                                  that wraps the EXISTING mintShare importCode.
//   parseShareToken(text)        → importCode | null — extracts the wrapped code
//                                  from arbitrary clipboard/share text, or null
//                                  when no 口令 pattern is present.
//
// Why this matters: the 口令 is what the share writes to the clipboard + share
// text, and what foreground auto-detect parses back out of whatever the user
// copied. It MUST round-trip, MUST ignore unrelated clipboard noise (privacy:
// only act on a real match), and MUST tolerate surrounding chatter (WeChat /
// 小红书 wrap pasted text with extra words). It reuses the importCode space —
// it does NOT mint a new code.

import { encodeShareToken, parseShareToken } from '../share-token';

const CODE = 'AB12CD';

describe('encodeShareToken', () => {
  it('wraps the importCode in collision-resistant delimiters that contain the code', () => {
    const token = encodeShareToken(CODE);
    // The encoded 口令 must literally contain the wrapped importCode so it can be
    // read off the card / share text by a human as a last resort.
    expect(token).toContain(CODE);
    // It must NOT be the bare code — a bare code is indistinguishable from random
    // clipboard text and would defeat the privacy "only act on a real match" rule.
    expect(token).not.toBe(CODE);
    // Delimited wrapper (collision-resistant marker present on both sides).
    expect(token.length).toBeGreaterThan(CODE.length);
  });

  it('reuses the importCode verbatim — does not transform / re-encode the code itself', () => {
    // The token space is the existing mintShare importCode; encode must not
    // invent a new code or mangle the one it was given.
    const token = encodeShareToken(CODE);
    expect(parseShareToken(token)).toBe(CODE);
  });
});

describe('parseShareToken round-trip', () => {
  it('round-trips: parse(encode(code)) === code', () => {
    expect(parseShareToken(encodeShareToken(CODE))).toBe(CODE);
  });

  it('round-trips a different code', () => {
    const other = 'Z9Y8X7';
    expect(parseShareToken(encodeShareToken(other))).toBe(other);
  });
});

describe('parseShareToken extracts from text with surrounding words', () => {
  it('finds the code when the 口令 is embedded in chatty share text', () => {
    const token = encodeShareToken(CODE);
    const pasted = `朋友给你分享了一家店 ${token} 复制后打开 Yummy or Not 即可导入`;
    expect(parseShareToken(pasted)).toBe(CODE);
  });

  it('tolerates leading/trailing whitespace and newlines around the token', () => {
    const token = encodeShareToken(CODE);
    expect(parseShareToken(`\n\n   ${token}   \n`)).toBe(CODE);
  });

  it('extracts the code even when other text directly abuts the delimiters', () => {
    const token = encodeShareToken(CODE);
    expect(parseShareToken(`xxx${token}yyy`)).toBe(CODE);
  });
});

describe('parseShareToken ignores noise / returns null on non-token clipboard', () => {
  it('returns null for empty string', () => {
    expect(parseShareToken('')).toBeNull();
  });

  it('returns null for ordinary clipboard text with no 口令', () => {
    expect(parseShareToken('https://example.com/some/article?utm=foo')).toBeNull();
  });

  it('returns null for a bare code with no wrapper (privacy: never act on a bare token)', () => {
    // A raw 6-char code copied by chance must NOT trigger an import — only the
    // delimited 口令 counts as a real share.
    expect(parseShareToken(CODE)).toBeNull();
  });

  it('returns null when only one delimiter is present (malformed)', () => {
    const token = encodeShareToken(CODE);
    // Slice off the trailing half of the wrapper → no valid closing delimiter.
    const half = token.slice(0, Math.floor(token.length / 2));
    expect(parseShareToken(half)).toBeNull();
  });
});
