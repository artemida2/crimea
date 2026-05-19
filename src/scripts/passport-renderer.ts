/**
 * Crimean Passport — canvas renderer.
 *
 * Two output sizes:
 *   - 1080×1080 (Instagram пост)
 *   - 1080×1920 (Instagram Stories)
 *
 * Палитра — из global.css:
 *   navy    #0E1B3A
 *   cream   #FAF6EE
 *   burgundy #7A1F2B
 */

export type PassportData = {
  name: string;
  cities: string[]; // city names (already resolved from codes)
  favBeach: string;
  favCity: string;
  favDish: string;
  archetype: {
    name: string;
    emoji: string;
    tagline: string;
  };
  rank: {
    title: string;
    subtitle: string;
  };
  photoDataUrl?: string | null;
  issuedAt: string; // ISO yyyy-mm-dd
  serial: string; // e.g. "82-14 № 295 471"
};

export type Variant = "post" | "stories";

const PALETTE = {
  navy: "#0E1B3A",
  navySoft: "#1a2750",
  cream: "#FAF6EE",
  creamDeep: "#F2EBDD",
  burgundy: "#7A1F2B",
  burgundyBright: "#9C2A38",
  text: "#1A1A1A",
  textMuted: "#6b6b6b",
  line: "rgba(14, 27, 58, 0.18)",
  lineSoft: "rgba(14, 27, 58, 0.10)",
};

const SERIF = '"Cormorant Garamond", Georgia, "Times New Roman", serif';
const SANS = '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

/** Wait for the document fonts to be ready so canvas picks up real Cormorant/Inter. */
export async function waitForFonts(): Promise<void> {
  if (typeof document === "undefined") return;
  // @ts-ignore — document.fonts is well-supported in modern browsers
  const fontsApi = document.fonts;
  if (!fontsApi) return;
  try {
    await Promise.all([
      fontsApi.load('600 1.5rem "Cormorant Garamond"'),
      fontsApi.load('italic 600 1.5rem "Cormorant Garamond"'),
      fontsApi.load('600 1rem "Inter"'),
      fontsApi.load('400 1rem "Inter"'),
    ]);
    await fontsApi.ready;
  } catch {
    /* ignore */
  }
}

/** Make a fake passport serial. Looks like Russian internal passport. */
export function makeSerial(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const a = String((h % 9000) + 1000);
  const b = String(((h >>> 8) % 90) + 10);
  const c = String(((h >>> 16) % 900000) + 100000);
  return `${a}-${b} № ${c}`;
}

/** Render the passport into a given canvas. Returns the same canvas. */
export async function renderPassport(
  canvas: HTMLCanvasElement,
  data: PassportData,
  variant: Variant = "post",
): Promise<HTMLCanvasElement> {
  const W = 1080;
  const H = variant === "stories" ? 1920 : 1080;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  // ────── background ──────
  ctx.fillStyle = PALETTE.cream;
  ctx.fillRect(0, 0, W, H);
  drawPaperTexture(ctx, W, H);

  // outer frame
  ctx.strokeStyle = PALETTE.navy;
  ctx.lineWidth = 4;
  ctx.strokeRect(40, 40, W - 80, H - 80);
  // inner thin frame
  ctx.strokeStyle = PALETTE.burgundy;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(56, 56, W - 112, H - 112);

  // ────── HEADER ──────
  const headerTop = variant === "stories" ? 130 : 88;
  ctx.fillStyle = PALETTE.navy;
  ctx.font = `600 20px ${SANS}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("WELCOMECRIMEA.RU", W / 2, headerTop);

  // serial top-right
  ctx.font = `500 16px ${SANS}`;
  ctx.fillStyle = PALETTE.burgundy;
  ctx.textAlign = "right";
  ctx.fillText(`Серия ${data.serial}`, W - 90, headerTop);

  // title
  ctx.font = `italic 600 ${variant === "stories" ? 88 : 60}px ${SERIF}`;
  ctx.fillStyle = PALETTE.burgundy;
  ctx.textAlign = "center";
  ctx.fillText("Крымский паспорт", W / 2, headerTop + (variant === "stories" ? 84 : 58));

  ctx.font = `400 17px ${SANS}`;
  ctx.fillStyle = PALETTE.textMuted;
  ctx.fillText(
    "официальный документ путешественника",
    W / 2,
    headerTop + (variant === "stories" ? 120 : 84),
  );

  // crest (только в сторис — в посте бережём вертикаль)
  if (variant === "stories") {
    drawCrest(ctx, W / 2, headerTop + 210, 64);
  } else {
    // орнаментальный разделитель под сабтайтлом
    drawOrnament(ctx, W / 2, headerTop + 110);
  }

  // ────── PHOTO + NAME ROW ──────
  const photoY = variant === "stories" ? 440 : 232;
  const photoX = 100;
  const photoW = variant === "stories" ? 220 : 170;
  const photoH = variant === "stories" ? 280 : 220;
  await drawPhoto(ctx, photoX, photoY, photoW, photoH, data.photoDataUrl);

  const textX = photoX + photoW + 50;
  ctx.textAlign = "left";
  ctx.fillStyle = PALETTE.textMuted;
  ctx.font = `500 16px ${SANS}`;
  ctx.fillText("ФАМИЛИЯ, ИМЯ", textX, photoY + 22);

  ctx.fillStyle = PALETTE.text;
  const baseSize = variant === "stories" ? 60 : 44;
  const safeName = (data.name || "Путешественник").slice(0, 26).toUpperCase();
  // авто-уменьшение, если имя не влезает
  const maxNameW = W - textX - 90;
  let nameSize = baseSize;
  ctx.font = `600 ${nameSize}px ${SERIF}`;
  while (ctx.measureText(safeName).width > maxNameW && nameSize > 20) {
    nameSize -= 2;
    ctx.font = `600 ${nameSize}px ${SERIF}`;
  }
  ctx.fillText(safeName, textX, photoY + 68);

  ctx.fillStyle = PALETTE.textMuted;
  ctx.font = `500 16px ${SANS}`;
  ctx.fillText("СТИЛЬ ПУТЕШЕСТВЕННИКА", textX, photoY + 116);

  ctx.fillStyle = PALETTE.burgundy;
  ctx.font = `italic 600 ${variant === "stories" ? 38 : 30}px ${SERIF}`;
  ctx.fillText(`${data.archetype.emoji}  ${data.archetype.name}`, textX, photoY + 154);

  ctx.fillStyle = PALETTE.text;
  ctx.font = `400 ${variant === "stories" ? 20 : 17}px ${SANS}`;
  wrapText(
    ctx,
    `«${data.archetype.tagline}»`,
    textX,
    photoY + (variant === "stories" ? 196 : 186),
    W - textX - 90,
    variant === "stories" ? 28 : 24,
  );

  // ────── BURGUNDY BAR + RANK ──────
  const barY = photoY + photoH + (variant === "stories" ? 60 : 24);
  ctx.fillStyle = PALETTE.burgundy;
  ctx.fillRect(90, barY, W - 180, 6);

  ctx.fillStyle = PALETTE.textMuted;
  ctx.font = `500 15px ${SANS}`;
  ctx.textAlign = "left";
  ctx.fillText("ЗВАНИЕ", 100, barY + 34);

  ctx.fillStyle = PALETTE.navy;
  ctx.font = `600 ${variant === "stories" ? 56 : 36}px ${SERIF}`;
  ctx.fillText(data.rank.title, 100, barY + (variant === "stories" ? 78 : 70));

  ctx.fillStyle = PALETTE.textMuted;
  ctx.font = `italic 400 ${variant === "stories" ? 24 : 18}px ${SERIF}`;
  ctx.fillText(
    `— ${data.rank.subtitle}`,
    100,
    barY + (variant === "stories" ? 108 : 95),
  );

  // ────── STATS GRID (2 col on post, stacked on stories) ──────
  const statsY = barY + (variant === "stories" ? 170 : 130);
  if (variant === "stories") {
    drawStat(ctx, "ПОСЕТИЛ ГОРОДОВ", `${data.cities.length} из 12`, 100, statsY, W - 200);
    drawStat(ctx, "ЛЮБИМЫЙ ПЛЯЖ", data.favBeach || "—", 100, statsY + 110, W - 200);
    drawStat(ctx, "ЛЮБИМЫЙ ГОРОД", data.favCity || "—", 100, statsY + 220, W - 200);
    drawStat(ctx, "ТОП-БЛЮДО", data.favDish || "—", 100, statsY + 330, W - 200);
  } else {
    const colW = (W - 200 - 40) / 2;
    drawStat(ctx, "ПОСЕТИЛ ГОРОДОВ", `${data.cities.length} из 12`, 100, statsY, colW);
    drawStat(ctx, "ЛЮБИМЫЙ ПЛЯЖ", data.favBeach || "—", 100 + colW + 40, statsY, colW);
    drawStat(ctx, "ЛЮБИМЫЙ ГОРОД", data.favCity || "—", 100, statsY + 88, colW);
    drawStat(ctx, "ТОП-БЛЮДО", data.favDish || "—", 100 + colW + 40, statsY + 88, colW);
  }

  // ────── STAMPS GRID ──────
  const stampsY = variant === "stories"
    ? statsY + 460
    : statsY + 180;
  ctx.fillStyle = PALETTE.textMuted;
  ctx.font = `500 14px ${SANS}`;
  ctx.textAlign = "left";
  ctx.fillText("ПЕЧАТИ ПОСЕЩЁННЫХ ГОРОДОВ", 100, stampsY);

  drawStamps(ctx, data.cities, 100, stampsY + 18, W - 200, variant);

  // ────── FOOTER ──────
  ctx.fillStyle = PALETTE.navy;
  ctx.font = `600 15px ${SANS}`;
  ctx.textAlign = "center";
  ctx.fillText("#крымскийпаспорт  ·  #welcomecrimea", W / 2, H - 88);

  ctx.fillStyle = PALETTE.textMuted;
  ctx.font = `500 13px ${SANS}`;
  ctx.fillText(`выдан welcomecrimea.ru · ${data.issuedAt}`, W / 2, H - 66);

  return canvas;
}

// ────────────────────────── helpers ──────────────────────────

function drawPaperTexture(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const off = document.createElement("canvas");
  off.width = 256;
  off.height = 256;
  const octx = off.getContext("2d");
  if (!octx) return;
  const img = octx.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (Math.random() * 16) | 0;
    img.data[i] = 250 - v;
    img.data[i + 1] = 246 - v;
    img.data[i + 2] = 238 - v;
    img.data[i + 3] = 60;
  }
  octx.putImageData(img, 0, 0);
  const pattern = ctx.createPattern(off, "repeat");
  if (pattern) {
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, w, h);
  }
}

function drawOrnament(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
) {
  ctx.save();
  ctx.strokeStyle = PALETTE.burgundy;
  ctx.lineWidth = 1.5;
  // левая линия
  ctx.beginPath();
  ctx.moveTo(cx - 240, cy);
  ctx.lineTo(cx - 30, cy);
  ctx.stroke();
  // правая линия
  ctx.beginPath();
  ctx.moveTo(cx + 30, cy);
  ctx.lineTo(cx + 240, cy);
  ctx.stroke();
  // ромб в центре
  ctx.fillStyle = PALETTE.burgundy;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 6);
  ctx.lineTo(cx + 6, cy);
  ctx.lineTo(cx, cy + 6);
  ctx.lineTo(cx - 6, cy);
  ctx.closePath();
  ctx.fill();
  // маленькие звёздочки по бокам
  ctx.fillStyle = PALETTE.burgundy;
  star(ctx, cx - 22, cy, 4);
  star(ctx, cx + 22, cy, 4);
  ctx.restore();
}

function drawCrest(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
) {
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, r * 0.85, r, 0, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.navy;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, cy, r * 0.78, r * 0.92, 0, 0, Math.PI * 2);
  ctx.strokeStyle = PALETTE.cream;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = PALETTE.cream;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${r * 1.1}px ${SERIF}`;
  ctx.fillText("К", cx, cy + r * 0.06);
  ctx.fillStyle = PALETTE.burgundyBright;
  star(ctx, cx - r * 1.15, cy, 6);
  star(ctx, cx + r * 1.15, cy, 6);
  ctx.restore();
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const spikes = 5;
  const outer = size;
  const inner = size * 0.45;
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / spikes) * i - Math.PI / 2;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

async function drawPhoto(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  dataUrl?: string | null,
) {
  ctx.save();
  ctx.fillStyle = PALETTE.creamDeep;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = PALETTE.navy;
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);

  if (dataUrl) {
    try {
      const img = await loadImage(dataUrl);
      const ar = img.width / img.height;
      const targetAr = w / h;
      let sx = 0,
        sy = 0,
        sw = img.width,
        sh = img.height;
      if (ar > targetAr) {
        sw = img.height * targetAr;
        sx = (img.width - sw) / 2;
      } else {
        sh = img.width / targetAr;
        sy = (img.height - sh) / 2;
      }
      ctx.drawImage(img, sx, sy, sw, sh, x + 2, y + 2, w - 4, h - 4);
    } catch {
      drawSilhouette(ctx, x, y, w, h);
    }
  } else {
    drawSilhouette(ctx, x, y, w, h);
  }
  ctx.restore();
}

function drawSilhouette(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  ctx.save();
  ctx.fillStyle = PALETTE.line;
  ctx.beginPath();
  ctx.arc(x + w / 2, y + h * 0.4, w * 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x + w * 0.2, y + h);
  ctx.quadraticCurveTo(x + w / 2, y + h * 0.6, x + w * 0.8, y + h);
  ctx.lineTo(x + w * 0.2, y + h);
  ctx.fill();
  ctx.restore();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

function drawStat(
  ctx: CanvasRenderingContext2D,
  label: string,
  value: string,
  x: number,
  y: number,
  maxW: number,
) {
  ctx.textAlign = "left";
  ctx.fillStyle = PALETTE.textMuted;
  ctx.font = `500 14px ${SANS}`;
  ctx.fillText(label, x, y);

  ctx.fillStyle = PALETTE.navy;
  ctx.font = `600 28px ${SERIF}`;
  // truncate to fit
  let txt = value;
  while (ctx.measureText(txt).width > maxW && txt.length > 4) {
    txt = txt.slice(0, -2);
  }
  if (txt !== value) txt = txt.replace(/[\s,.;:]+$/, "") + "…";
  ctx.fillText(txt, x, y + 38);

  ctx.strokeStyle = PALETTE.lineSoft;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y + 58);
  ctx.lineTo(x + maxW, y + 58);
  ctx.stroke();
}

function drawStamps(
  ctx: CanvasRenderingContext2D,
  cities: string[],
  x: number,
  y: number,
  maxW: number,
  variant: Variant,
) {
  const n = cities.length;
  if (n === 0) return;

  if (variant === "stories") {
    // фиксированный размер, многострочная сетка
    const stampR = 60;
    const gap = 26;
    const perRow = Math.max(1, Math.floor((maxW + gap) / (stampR * 2 + gap)));
    cities.forEach((c, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const cx = x + stampR + col * (stampR * 2 + gap);
      const cy = y + stampR + row * (stampR * 2 + 14);
      drawStamp(ctx, cx, cy, stampR, c);
    });
    return;
  }

  // post: уменьшаем размер штампов, чтобы все влезли в одну строку
  const gap = 12;
  let r = Math.floor((maxW - (n - 1) * gap) / (2 * n));
  r = Math.max(26, Math.min(46, r));
  // если r упёрся в минимум и n всё равно не влезает — допускаем перенос на 2 строки
  const perRow = Math.max(1, Math.floor((maxW + gap) / (r * 2 + gap)));
  cities.forEach((c, i) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const cx = x + r + col * (r * 2 + gap);
    const cy = y + r + row * (r * 2 + 10);
    drawStamp(ctx, cx, cy, r, c);
  });
}

function drawStamp(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  text: string,
) {
  ctx.save();
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  const rot = ((h % 14) - 7) * 0.012;
  ctx.translate(cx, cy);
  ctx.rotate(rot);

  ctx.strokeStyle = PALETTE.burgundy;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.setLineDash([5, 3]);
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.setLineDash([]);
  ctx.lineWidth = 1.5;
  ctx.arc(0, 0, r - 7, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = PALETTE.burgundy;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let size = Math.max(11, r * 0.26);
  ctx.font = `600 ${size}px ${SANS}`;
  // shrink text to fit inside the inner circle
  while (ctx.measureText(text).width > (r - 12) * 1.85 && size > 9) {
    size -= 1;
    ctx.font = `600 ${size}px ${SANS}`;
  }
  ctx.fillText(text, 0, -3);

  ctx.font = `500 ${Math.max(9, r * 0.18)}px ${SANS}`;
  ctx.fillText("ПОСЕЩЕНО", 0, r * 0.42);

  ctx.restore();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  lineH: number,
) {
  const words = text.split(/\s+/);
  let line = "";
  let cy = y;
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, cy);
      line = w;
      cy += lineH;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, cy);
}
