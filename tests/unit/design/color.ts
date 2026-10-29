/**
 * Just enough colour science to compute WCAG 2.x contrast for the tokens in
 * app/globals.css, which are written in oklch().
 *
 * oklch -> oklab -> linear sRGB (Björn Ottosson's matrices) -> gamut clip ->
 * relative luminance. Alpha is composited over the surface in gamma-encoded
 * sRGB, which is what browsers do.
 */

export interface Rgba {
  r: number; // gamma-encoded sRGB, 0..1
  g: number;
  b: number;
  a: number;
}

const OKLCH =
  /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+%?))?\s*\)$/;

function pct(v: string): number {
  return v.endsWith('%') ? Number(v.slice(0, -1)) / 100 : Number(v);
}

function encode(linear: number): number {
  const c = Math.min(1, Math.max(0, linear));
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

function decode(encoded: number): number {
  return encoded <= 0.04045
    ? encoded / 12.92
    : ((encoded + 0.055) / 1.055) ** 2.4;
}

export function parseOklch(value: string): Rgba {
  const m = OKLCH.exec(value.trim());
  if (!m) throw new Error(`Not an oklch() colour: ${value}`);
  const [, lRaw, cRaw, hRaw, aRaw] = m as unknown as [
    string,
    string,
    string,
    string,
    string | undefined,
  ];
  const L = pct(lRaw);
  const C = Number(cRaw);
  const h = (Number(hRaw) * Math.PI) / 180;
  const A = C * Math.cos(h);
  const B = C * Math.sin(h);

  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const mm = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;

  return {
    r: encode(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s),
    g: encode(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s),
    b: encode(-0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s),
    a: aRaw === undefined ? 1 : pct(aRaw),
  };
}

/** Composite a (possibly translucent) colour over an opaque surface. */
export function over(top: Rgba, surface: Rgba): Rgba {
  const mix = (t: number, s: number) => t * top.a + s * (1 - top.a);
  return {
    r: mix(top.r, surface.r),
    g: mix(top.g, surface.g),
    b: mix(top.b, surface.b),
    a: 1,
  };
}

function luminance({ r, g, b }: Rgba): number {
  return 0.2126 * decode(r) + 0.7152 * decode(g) + 0.0722 * decode(b);
}

export function contrast(fg: Rgba, bg: Rgba): number {
  const a = luminance(over(fg, bg));
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** `--name: value;` declarations inside the first `selector { ... }` block. */
export function tokensIn(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`No "${selector} {" block in CSS`);
  const end = css.indexOf('}', start);
  const out = new Map<string, string>();
  for (const m of css.slice(start, end).matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    out.set(m[1]!, m[2]!.trim());
  }
  return out;
}
