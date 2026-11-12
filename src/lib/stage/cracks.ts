/** Deterministic "cracked glass" SVG paths for the BUSTED moment. */

export interface Cracks {
  /** Main cracks */
  main: string;
  /** Branches and rings */
  fine: string;
  w: number;
  h: number;
}

export function crackPaths(w: number, h: number, ox: number, oy: number, seed: number): Cracks {
  let a = (seed * 2654435761) >>> 0 || 1;
  const rnd = () => {
    a ^= a << 13;
    a >>>= 0;
    a ^= a >>> 17;
    a ^= a << 5;
    a >>>= 0;
    return a / 4294967296;
  };
  const f = (n: number) => n.toFixed(1);
  const span = Math.max(w, h);
  const rays = 10;
  let main = '';
  let fine = '';
  const ringA: [number, number][] = [];
  const ringB: [number, number][] = [];
  for (let i = 0; i < rays; i++) {
    let ang = (i / rays) * Math.PI * 2 + (rnd() - 0.5) * 0.45;
    const len = span * (0.32 + rnd() * 0.42);
    const steps = 9;
    const seg = len / steps;
    let x = ox;
    let y = oy;
    main += `M${f(x)} ${f(y)}`;
    let branches = 0;
    for (let s = 0; s < steps; s++) {
      ang += (rnd() - 0.5) * 0.55;
      x += Math.cos(ang) * seg * (0.7 + rnd() * 0.6);
      y += Math.sin(ang) * seg * (0.7 + rnd() * 0.6);
      main += `L${f(x)} ${f(y)}`;
      if (s === 0) ringA.push([x, y]);
      if (s === 1) ringB.push([x, y]);
      if (s > 0 && branches < 2 && rnd() < 0.32) {
        branches++;
        let bx = x;
        let by = y;
        let ba = ang + (rnd() < 0.5 ? -1 : 1) * (0.45 + rnd() * 0.5);
        fine += `M${f(bx)} ${f(by)}`;
        const bl = seg * (0.5 + rnd() * 0.6);
        for (let k = 0; k < 4; k++) {
          ba += (rnd() - 0.5) * 0.6;
          bx += Math.cos(ba) * bl;
          by += Math.sin(ba) * bl;
          fine += `L${f(bx)} ${f(by)}`;
        }
      }
    }
  }
  for (const ring of [ringA, ringB]) {
    if (ring.length < 3) continue;
    fine += `M${f(ring[0][0])} ${f(ring[0][1])}`;
    for (let i = 1; i <= ring.length; i++) {
      const [px, py] = ring[i % ring.length];
      if (rnd() < 0.2) fine += `M${f(px)} ${f(py)}`;
      else fine += `L${f(px)} ${f(py)}`;
    }
  }
  return { main, fine, w, h };
}
