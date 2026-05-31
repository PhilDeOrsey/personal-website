// Hand-rolled SVG line chart. Zero dependencies. Theme-aware via CSS variables
// (it reads `currentColor` and the page's custom properties through CSS, so it
// follows light/dark automatically).

import { money, moneyShort } from './format';

export interface Point {
  x: number; // age
  y: number; // dollars
}

export interface Series {
  label: string;
  color: string;
  points: Point[];
  /** Render as a dashed reference line (e.g. the FI number). */
  dashed?: boolean;
}

export interface ChartOptions {
  width?: number;
  height?: number;
  xLabel?: string;
  yLabel?: string;
}

const PAD = { top: 16, right: 16, bottom: 36, left: 64 };

const niceCeil = (v: number): number => {
  if (v <= 0) return 0;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
};

/**
 * Render the chart into `target`. Returns nothing; attaches a hover tooltip
 * that tracks the nearest x (age) across all series.
 */
export const renderChart = (
  target: HTMLElement,
  series: Series[],
  opts: ChartOptions = {},
): void => {
  const width = opts.width ?? 720;
  const height = opts.height ?? 380;
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;

  const all = series.flatMap((s) => s.points);
  if (all.length === 0) {
    target.innerHTML = '<p class="chart-empty">No data.</p>';
    return;
  }

  const xs = all.map((p) => p.x);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMax = niceCeil(Math.max(...all.map((p) => p.y), 1));
  const xSpan = Math.max(1, xMax - xMin);

  const sx = (x: number): number => PAD.left + ((x - xMin) / xSpan) * plotW;
  const sy = (y: number): number => PAD.top + plotH - (y / yMax) * plotH;

  // Y gridlines + labels.
  const yTicks = 5;
  let grid = '';
  let yLabels = '';
  for (let i = 0; i <= yTicks; i++) {
    const v = (yMax / yTicks) * i;
    const y = sy(v);
    grid += `<line class="grid" x1="${PAD.left}" y1="${y}" x2="${PAD.left + plotW}" y2="${y}" />`;
    yLabels += `<text class="axis-label y" x="${PAD.left - 8}" y="${y + 4}" text-anchor="end">${moneyShort(v)}</text>`;
  }

  // X labels (ages) — about 6 evenly spaced ticks on whole ages.
  let xLabels = '';
  const xTickCount = Math.min(6, xMax - xMin);
  for (let i = 0; i <= xTickCount; i++) {
    const age = Math.round(xMin + (xSpan / Math.max(1, xTickCount)) * i);
    const x = sx(age);
    xLabels += `<text class="axis-label x" x="${x}" y="${height - PAD.bottom + 20}" text-anchor="middle">${age}</text>`;
  }

  const paths = series
    .map((s) => {
      if (s.points.length === 0) return '';
      const d = s.points
        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`)
        .join(' ');
      const dash = s.dashed ? ' stroke-dasharray="4 4"' : '';
      return `<path class="series-line" d="${d}" fill="none" stroke="${s.color}" stroke-width="2"${dash} />`;
    })
    .join('');

  const legend = series
    .map(
      (s) =>
        `<span class="legend-item"><span class="swatch" style="background:${s.color}${
          s.dashed ? ';opacity:.6' : ''
        }"></span>${s.label}</span>`,
    )
    .join('');

  target.innerHTML = `
    <svg class="fire-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img">
      <g>${grid}</g>
      <line class="axis" x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${PAD.top + plotH}" />
      <line class="axis" x1="${PAD.left}" y1="${PAD.top + plotH}" x2="${PAD.left + plotW}" y2="${PAD.top + plotH}" />
      ${yLabels}
      ${xLabels}
      <text class="axis-title" x="${PAD.left + plotW / 2}" y="${height - 2}" text-anchor="middle">${opts.xLabel ?? 'Age'}</text>
      ${paths}
      <line class="cursor-line" x1="0" y1="${PAD.top}" x2="0" y2="${PAD.top + plotH}" style="display:none" />
      <rect class="hit" x="${PAD.left}" y="${PAD.top}" width="${plotW}" height="${plotH}" fill="transparent" />
    </svg>
    <div class="chart-legend">${legend}</div>
    <div class="chart-tooltip" style="display:none"></div>`;

  attachTooltip(target, series, { sx, sy, xMin, xMax, plotLeft: PAD.left, plotW });
};

interface HoverGeom {
  sx: (x: number) => number;
  sy: (y: number) => number;
  xMin: number;
  xMax: number;
  plotLeft: number;
  plotW: number;
}

const attachTooltip = (target: HTMLElement, series: Series[], g: HoverGeom): void => {
  const svg = target.querySelector<SVGSVGElement>('svg.fire-chart');
  const hit = target.querySelector<SVGRectElement>('rect.hit');
  const cursor = target.querySelector<SVGLineElement>('line.cursor-line');
  const tip = target.querySelector<HTMLElement>('.chart-tooltip');
  if (!svg || !hit || !cursor || !tip) return;

  const move = (evt: PointerEvent): void => {
    const rect = svg.getBoundingClientRect();
    const viewW = svg.viewBox.baseVal.width;
    // Map screen px → viewBox px.
    const vx = ((evt.clientX - rect.left) / rect.width) * viewW;
    const frac = (vx - g.plotLeft) / g.plotW;
    const age = Math.round(g.xMin + frac * (g.xMax - g.xMin));
    const clamped = Math.max(g.xMin, Math.min(g.xMax, age));

    const px = g.sx(clamped);
    cursor.setAttribute('x1', String(px));
    cursor.setAttribute('x2', String(px));
    cursor.style.display = '';

    const lines = series
      .map((s) => {
        const pt = s.points.find((p) => p.x === clamped);
        if (!pt) return '';
        return `<div class="tip-row"><span class="swatch" style="background:${s.color}"></span>${s.label}: <strong>${money(pt.y)}</strong></div>`;
      })
      .join('');

    tip.innerHTML = `<div class="tip-age">Age ${clamped}</div>${lines}`;
    tip.style.display = '';
    // Position relative to the container.
    const leftPct = (px / viewW) * 100;
    tip.style.left = `${leftPct}%`;
  };

  hit.addEventListener('pointermove', move as EventListener);
  hit.addEventListener('pointerleave', () => {
    cursor.style.display = 'none';
    tip.style.display = 'none';
  });
};
