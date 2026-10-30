/* Latitude/longitude <-> UTM on GRS80 (NAD83(CSRS)), Krüger series to n³: better than 1 mm inside a zone. */
const a = 6378137, f = 1 / 298.257222101, k0 = 0.9996, n = f / (2 - f);
const A = a / (1 + n) * (1 + n * n / 4 + n ** 4 / 64);
const alpha = [n / 2 - 2 * n * n / 3 + 5 * n ** 3 / 16, 13 * n * n / 48 - 3 * n ** 3 / 5, 61 * n ** 3 / 240];
const beta = [n / 2 - 2 * n * n / 3 + 37 * n ** 3 / 96, n * n / 48 + n ** 3 / 15, 17 * n ** 3 / 480];
const delta = [2 * n - 2 * n * n / 3 - 2 * n ** 3, 7 * n * n / 3 - 8 * n ** 3 / 5, 56 * n ** 3 / 15];
const rad = Math.PI / 180;

export const centralMeridian = (zone: number) => zone * 6 - 183;
export const zoneOf = (lon: number) => Math.floor((lon + 180) / 6) + 1;

/** [easting, northing] in metres, northern hemisphere. */
export function llToUtm(lat: number, lon: number, zone: number): [number, number] {
  const ph = lat * rad, dl = (lon - centralMeridian(zone)) * rad, c = 2 * Math.sqrt(n) / (1 + n);
  const t = Math.sinh(Math.atanh(Math.sin(ph)) - c * Math.atanh(c * Math.sin(ph)));
  const xi = Math.atan(t / Math.cos(dl)), eta = Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
  let E = eta, N = xi;
  alpha.forEach((v, j) => { E += v * Math.cos(2 * (j + 1) * xi) * Math.sinh(2 * (j + 1) * eta); N += v * Math.sin(2 * (j + 1) * xi) * Math.cosh(2 * (j + 1) * eta); });
  return [500000 + k0 * A * E, k0 * A * N];
}

/** [latitude, longitude] in degrees. */
export function utmToLl(E: number, N: number, zone: number): [number, number] {
  const xi = N / (k0 * A), eta = (E - 500000) / (k0 * A);
  let xp = xi, ep = eta;
  beta.forEach((v, j) => { xp -= v * Math.sin(2 * (j + 1) * xi) * Math.cosh(2 * (j + 1) * eta); ep -= v * Math.cos(2 * (j + 1) * xi) * Math.sinh(2 * (j + 1) * eta); });
  const chi = Math.asin(Math.sin(xp) / Math.cosh(ep));
  let ph = chi; delta.forEach((v, j) => { ph += v * Math.sin(2 * (j + 1) * chi); });
  return [ph / rad, centralMeridian(zone) + Math.atan(Math.sinh(ep) / Math.cos(xp)) / rad];
}

/** The UTM zone named in a coordinate-system label such as "UTM NAD83(CSRS) Zone 12". */
export const zoneFromCrs = (crs?: string): number | null => { const m = /zone\s*(\d{1,2})/i.exec(crs || ''); return m ? +m[1]! : null; };
