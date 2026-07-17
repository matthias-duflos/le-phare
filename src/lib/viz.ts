// LE PHARE — shared dataviz theme for Observable Plot / D3.
// Colors resolve from CSS custom properties so charts follow the active theme.
// Categorical order is CVD-validated; never cycle or generate hues.

export type VizTheme = {
  series: string[]; // fixed categorical order
  hero: string; // single highlighted series
  context: string; // de-emphasised context series
  grid: string;
  axis: string;
  ink: string;
  ink2: string;
  ink3: string;
  bg1: string;
  accent: string;
  risk: string;
  fontSans: string;
  fontMono: string;
};

const cssVar = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function readTheme(): VizTheme {
  return {
    series: [1, 2, 3, 4, 5, 6].map((i) => cssVar(`--viz-${i}`)),
    hero: cssVar("--viz-hero"),
    context: cssVar("--viz-context"),
    grid: cssVar("--viz-grid"),
    axis: cssVar("--viz-axis"),
    ink: cssVar("--ink"),
    ink2: cssVar("--ink-2"),
    ink3: cssVar("--ink-3"),
    bg1: cssVar("--bg-1"),
    accent: cssVar("--accent"),
    risk: cssVar("--risk"),
    fontSans: cssVar("--font-sans"),
    fontMono: cssVar("--font-mono"),
  };
}

/** Base Plot options shared by every chart on the site. */
export function plotDefaults(t: VizTheme) {
  return {
    style: {
      background: "transparent",
      color: t.ink2,
      fontFamily: t.fontSans,
      fontSize: "12px",
      overflow: "visible",
    } as Partial<CSSStyleDeclaration>,
    x: { line: false as const, tickSize: 0, label: null },
    y: { tickSize: 0, grid: false },
  };
}

/** Export the Plot SVG inside `container` as a 2x PNG on the page background.
    Marks must use resolved colors (not var() strings) to survive serialization. */
export function exportPlotPNG(container: HTMLElement | null, filename: string) {
  const svg = container?.querySelector("svg");
  if (!svg) return;
  const xml = new XMLSerializer().serializeToString(svg);
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = svg.clientWidth * 2;
    c.height = svg.clientHeight * 2;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--bg-0");
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0);
    const a = document.createElement("a");
    a.download = filename;
    a.href = c.toDataURL("image/png");
    a.click();
  };
  img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(xml)));
}

/** Re-run a render function whenever the site theme flips. */
export function onThemeChange(render: () => void): () => void {
  const mo = new MutationObserver((muts) => {
    if (muts.some((m) => m.attributeName === "data-theme")) render();
  });
  mo.observe(document.documentElement, { attributes: true });
  return () => mo.disconnect();
}
