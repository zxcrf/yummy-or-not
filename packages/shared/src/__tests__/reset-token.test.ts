/* extractResetToken — the cross-device bridge parser.

   Pins the contract both mobile entry points (deep-link URL + clipboard
   paste) rely on: a real token (URL or bare) is recovered, and arbitrary
   text is rejected so the app never acts on unrelated clipboard contents. */
import { extractResetToken, resetDeepLink, RESET_PATH } from "../reset-token";

const HEX64 = "a".repeat(64);
const HEX64_MIXED = "A1b2C3d4".repeat(8); // 64 chars, mixed case

describe("extractResetToken", () => {
  it("recovers the token from the app deep link", () => {
    expect(extractResetToken(`yummyornot://${RESET_PATH}?token=${HEX64}`)).toBe(HEX64);
  });

  it("recovers the token from a web URL form", () => {
    expect(extractResetToken(`https://yon.baobao.click/${RESET_PATH}?token=${HEX64}`)).toBe(HEX64);
  });

  it("recovers a token that is not the first/only query param", () => {
    expect(extractResetToken(`yummyornot://${RESET_PATH}?lang=en&token=${HEX64}`)).toBe(HEX64);
    expect(extractResetToken(`yummyornot://${RESET_PATH}?token=${HEX64}&x=1`)).toBe(HEX64);
  });

  it("accepts a bare 64-hex token (mixed case) pasted directly", () => {
    expect(extractResetToken(HEX64_MIXED)).toBe(HEX64_MIXED);
    expect(extractResetToken(`  ${HEX64}  `)).toBe(HEX64); // trims surrounding whitespace
  });

  it("rejects arbitrary clipboard text so the app never acts on it", () => {
    expect(extractResetToken("hello world")).toBeNull();
    expect(extractResetToken("")).toBeNull();
    expect(extractResetToken(null)).toBeNull();
    expect(extractResetToken(undefined)).toBeNull();
    // a non-reset deep link must not yield a token
    expect(extractResetToken(`yummyornot://import/${HEX64}`)).toBeNull();
    // wrong length is not a token
    expect(extractResetToken("abc123")).toBeNull();
    expect(extractResetToken(`yummyornot://${RESET_PATH}?token=tooShort`)).toBeNull();
    // a foreign link that merely MENTIONS reset-password in a param value must
    // NOT match — reset-password must be the actual path segment.
    expect(extractResetToken(`yummyornot://import?next=reset-password&token=${HEX64}`)).toBeNull();
    expect(extractResetToken(`https://evil.example/x?reset-password=1&token=${HEX64}`)).toBeNull();
  });

  it("round-trips with resetDeepLink (the email link builder)", () => {
    expect(extractResetToken(resetDeepLink(HEX64))).toBe(HEX64);
  });
});
