import { wgs84ToGcj02, isInsideChina, haversineMeters, formatDistance } from "../geo";

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

describe("haversineMeters", () => {
  it("returns 0 for the same point", () => {
    expect(haversineMeters(35.0, 139.0, 35.0, 139.0)).toBe(0);
  });

  it("~111 km per 1° latitude at the equator", () => {
    // 0°N,0°E → 1°N,0°E — longitude cosine = 1, purely latitude change
    const d = haversineMeters(0, 0, 1, 0);
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });

  it("cross-equator: 1°S to 1°N along prime meridian is ~222 km", () => {
    const d = haversineMeters(-1, 0, 1, 0);
    expect(d).toBeGreaterThan(220_000);
    expect(d).toBeLessThan(224_000);
  });

  it("non-equator longitude: cos(lat) shrink — 1° lng at 60°N is ~half of equatorial", () => {
    // At 60°N, cos(60°)=0.5, so 1° longitude ≈ 55.7 km
    const d = haversineMeters(60, 0, 60, 1);
    expect(d).toBeGreaterThan(54_000);
    expect(d).toBeLessThan(57_000);
  });
});

describe("formatDistance", () => {
  it("999 m → '999 m'", () => {
    expect(formatDistance(999)).toBe("999 m");
  });

  it("1000 m → '1.0 km'", () => {
    expect(formatDistance(1000)).toBe("1.0 km");
  });

  it("1400 m → '1.4 km'", () => {
    expect(formatDistance(1400)).toBe("1.4 km");
  });

  it("500 m → '500 m'", () => {
    expect(formatDistance(500)).toBe("500 m");
  });
});
