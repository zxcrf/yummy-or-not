import { wgs84ToGcj02, isInsideChina } from "../geo";

describe("isInsideChina", () => {
  it("returns true for Beijing", () => {
    expect(isInsideChina(39.9087, 116.3975)).toBe(true);
  });

  it("returns false for Perth, Australia", () => {
    expect(isInsideChina(-31.9523, 115.8613)).toBe(false);
  });

  it("returns false for New York", () => {
    expect(isInsideChina(40.7128, -74.006)).toBe(false);
  });
});

describe("wgs84ToGcj02", () => {
  it("transforms a Beijing WGS-84 point to GCJ-02 with ~hundreds-of-meters offset", () => {
    const wgs = { lat: 39.9087, lng: 116.3975 };
    const gcj = wgs84ToGcj02(wgs.lat, wgs.lng);

    // Should differ from input
    expect(gcj.lat).not.toBeCloseTo(wgs.lat, 4);
    // Offset magnitude should be in the range ~1e-4 to ~1e-2 degrees (hundreds of metres)
    const dLat = Math.abs(gcj.lat - wgs.lat);
    const dLng = Math.abs(gcj.lng - wgs.lng);
    expect(dLat).toBeGreaterThan(1e-4);
    expect(dLng).toBeGreaterThan(1e-4);
    expect(dLat).toBeLessThan(0.1);
    expect(dLng).toBeLessThan(0.1);
    // Pin offset direction: GCJ-02 Beijing is north-east of WGS-84
    expect(gcj.lat).toBeGreaterThan(wgs.lat);
    expect(gcj.lng).toBeGreaterThan(wgs.lng);
  });

  it("returns the input unchanged for an overseas point", () => {
    const overseas = { lat: -31.9523, lng: 115.8613 };
    const result = wgs84ToGcj02(overseas.lat, overseas.lng);
    expect(result.lat).toBe(overseas.lat);
    expect(result.lng).toBe(overseas.lng);
  });
});
