/* Coordinate transform utilities for Yummy or Not.
   wgs84ToGcj02: WGS-84 (GPS/standard) → GCJ-02 (China offset-corrected).
   isInsideChina: coarse bounding-box check used to select the AMap provider.

   Algorithm is the standard "eviltransform" / wgs2gcj formula, public domain. */

const a = 6378245.0;
const ee = 0.00669342162296594323;

function transformLat(x: number, y: number): number {
  let ret =
    -100.0 +
    2.0 * x +
    3.0 * y +
    0.2 * y * y +
    0.1 * x * y +
    0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

function transformLng(x: number, y: number): number {
  let ret =
    300.0 +
    x +
    2.0 * y +
    0.1 * x * x +
    0.1 * x * y +
    0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0;
  return ret;
}

/** Coarse bounding-box check: is the WGS-84 point roughly inside mainland China?
 *  Used to select the AMap geocoder vs Nominatim. */
export function isInsideChina(lat: number, lng: number): boolean {
  return lat >= 3.86 && lat <= 53.55 && lng >= 73.66 && lng <= 135.05;
}

/** Convert a WGS-84 coordinate to GCJ-02 (China Mars coordinate).
 *  Returns the input unchanged if the point is outside China. */
export function wgs84ToGcj02(lat: number, lng: number): { lat: number; lng: number } {
  if (!isInsideChina(lat, lng)) return { lat, lng };

  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);

  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);

  dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI);
  dLng = (dLng * 180.0) / ((a / sqrtMagic) * Math.cos(radLat) * Math.PI);

  return { lat: lat + dLat, lng: lng + dLng };
}
