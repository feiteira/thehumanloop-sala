export const MIN_PASSPHRASE = 10;

/** A rough strength estimate for the meter: 0 weak … 3 strong. Length matters most. */
export function strength(p: string): 0 | 1 | 2 | 3 {
  if (p.length < MIN_PASSPHRASE) return 0;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/, /\s/].filter((r) => r.test(p)).length;
  const words = p.trim().split(/\s+/).length;
  const score = p.length / 6 + classes * 0.6 + (words >= 3 ? 1 : 0) + (words >= 4 ? 1 : 0);
  if (score >= 6) return 3;
  if (score >= 4.2) return 2;
  return 1;
}

/** Picks three distinct word positions (1-based) to confirm. */
export function pickCheckPositions(random: () => number = Math.random): number[] {
  const all = Array.from({ length: 12 }, (_, i) => i + 1);
  const out: number[] = [];
  while (out.length < 3) {
    const [n] = all.splice(Math.floor(random() * all.length), 1);
    out.push(n!);
  }
  return out.sort((a, b) => a - b);
}
