export interface LightningEffect {
  setEnabled(enabled: boolean): void;
  destroy(): void;
}

/** Decorative screen-space lightning, independent of GPS/weather data and map style. */
export function createLightningEffect(container: HTMLElement): LightningEffect {
  const doc = container.ownerDocument;
  const win = doc.defaultView!;
  const reducedMotion = win.matchMedia('(prefers-reduced-motion: reduce)');
  const overlay = doc.createElement('div');
  overlay.dataset.weatherEffect = 'lightning';
  overlay.setAttribute('aria-hidden', 'true');
  Object.assign(overlay.style, {
    position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden',
    zIndex: '1', opacity: '0', display: 'none',
    background: 'radial-gradient(ellipse at 65% 0%, #b5cbff26, transparent 75%)',
  });
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 1000 700');
  svg.setAttribute('preserveAspectRatio', 'none');
  Object.assign(svg.style, { width: '100%', height: '100%', overflow: 'visible' });
  overlay.append(svg); container.append(overlay);
  let enabled = false;
  let destroyed = false;
  let next: number | undefined;
  let fade: number | undefined;
  let hide: number | undefined;
  const clear = () => {
    win.clearTimeout(next); win.clearTimeout(fade); win.clearTimeout(hide);
    overlay.style.transition = 'none'; overlay.style.opacity = '0'; overlay.style.display = 'none';
    svg.replaceChildren();
  };
  const canAnimate = () => enabled && !destroyed && !doc.hidden && !reducedMotion.matches;
  const strike = () => {
    if (!canAnimate()) return;
    let x = 400 + Math.random() * 450;
    const points: [number, number][] = [[x, -10]];
    for (let step = 1; step <= 9; step++) {
      x += (Math.random() - 0.5) * 90;
      points.push([x, step * 37]);
    }
    let path = points.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py}`).join(' ');
    for (const index of [3, 5, 7]) {
      const [px, py] = points[index]!;
      const side = Math.random() > 0.5 ? 1 : -1;
      path += ` M${px},${py} l${side * 35},25 l${side * -12},22 l${side * 48},32`;
    }
    svg.replaceChildren();
    for (const [width, color] of [[9, '#91b5ff35'], [4, '#b8d6ffc0'], [1.4, '#f2f7ff']] as const) {
      const bolt = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
      bolt.setAttribute('d', path); bolt.setAttribute('fill', 'none');
      bolt.setAttribute('stroke', color); bolt.setAttribute('stroke-width', String(width));
      bolt.setAttribute('stroke-linejoin', 'round'); svg.append(bolt);
    }
    overlay.style.display = 'block'; overlay.style.transition = 'none'; overlay.style.opacity = '0.85';
    // One gradual pulse, never a rapid sequence of full-screen flashes.
    fade = win.setTimeout(() => { overlay.style.transition = 'opacity 900ms ease-out'; overlay.style.opacity = '0'; }, 100);
    hide = win.setTimeout(() => { overlay.style.display = 'none'; svg.replaceChildren(); }, 1050);
    next = win.setTimeout(strike, 5500 + Math.random() * 5000);
  };
  const synchronize = () => {
    clear();
    if (canAnimate()) next = win.setTimeout(strike, 800);
  };
  doc.addEventListener('visibilitychange', synchronize);
  reducedMotion.addEventListener('change', synchronize);
  return {
    setEnabled(value) {
      if (destroyed || enabled === value) return;
      enabled = value; synchronize();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true; enabled = false; clear();
      doc.removeEventListener('visibilitychange', synchronize);
      reducedMotion.removeEventListener('change', synchronize);
      overlay.remove();
    },
  };
}
