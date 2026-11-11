// Rovina ASCII dell'apertura e passaggio verso lo screenshot di Studio.
// Stesso effetto dello sfondo del DMG e dell'installer Windows (src-tauri/installer/ui/ruin.js):
// il pi e' fatto di caratteri colorati come la pietra sopra la foto scurita.
// Scorrendo nella sezione fissa: la foto si scioglie in caratteri, i caratteri diventano
// quelli dello screenshot e lo screenshot si sviluppa in pixel. Un solo orologio (rAF),
// fermo quando la sezione e' fuori vista.

const RAMP = ' .:-=+*#%@';
const HEAVY = '=+*#%@';
const OCHRE: [number, number, number] = [227, 192, 106];
const OCHRE_CSS = 'rgb(227 192 106)';
const GROUND = '#0e0e0c';
const CELL = 7;
// Stack letterale: nel canvas var(--font-mono) non viene risolto.
const FONT_STACK = "'Geist Mono', 'Cascadia Mono', Consolas, monospace";

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (t: number) => t * t * (3 - 2 * t);
function hash(a: number, b: number) {
	let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
	h ^= h >>> 15;
	h = Math.imul(h, 0x2c1b3c6d);
	return ((h ^ (h >>> 12)) >>> 0) / 4294967296;
}
const lumOf = (d: Uint8ClampedArray, p: number) => (0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]) / 255;

function load(src: string) {
	const { promise, resolve, reject } = Promise.withResolvers<HTMLImageElement>();
	const i = new Image();
	i.onload = () => resolve(i);
	i.onerror = () => reject(new Error(`immagine non caricata: ${src}`));
	i.src = src;
	return promise;
}
function canvas2d(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
	const c = document.createElement('canvas');
	c.width = w;
	c.height = h;
	return [c, c.getContext('2d', { willReadFrequently: true })!];
}
function color(r: number, g: number, b: number, toward?: number[], k = 0) {
	const peak = Math.max(r, g, b, 0.05);
	let c = [r, g, b].map((v) => Math.max((v / peak) * 0.98, v) * 255);
	if (toward) c = c.map((v, i) => v + (toward[i] - v) * k);
	return `rgb(${c[0] | 0} ${c[1] | 0} ${c[2] | 0})`;
}

interface Glyph {
	gx: number;
	gy: number;
	ch: string;
	color: string;
	bright: string;
	alpha: number;
}
interface Scene {
	dpr: number;
	cell: number;
	cols: number;
	rows: number;
	bg: HTMLCanvasElement;
	settled: HTMLCanvasElement;
	glyphs: Glyph[];
	index: Map<number, number>;
	font: string;
	pch: string[];
	pcol: string[];
	pal: Float32Array;
	order: Float32Array;
	isPi: Uint8Array;
	sch: string[];
	scol: string[];
	sord: Float32Array;
	scols: number;
	srows: number;
	sx0: number;
	sy0: number;
	CW: number;
	CH: number;
}

export interface RuinElements {
	canvas: HTMLCanvasElement;
	gate: HTMLElement;
	heroCopy: HTMLElement;
	scrim: HTMLElement;
	caption: HTMLElement;
}

export async function mountRuin(el: RuinElements, reduced: boolean): Promise<() => void> {
	const { canvas: cv, gate, heroCopy, scrim, caption } = el;
	const ctx = cv.getContext('2d')!;
	const [photo, mask, shot] = await Promise.all([load('/img/ruin.webp'), load('/img/ruin-mask.png'), load('/img/studio.webp')]);
	let S: Scene;
	const introStart = performance.now();
	let raf = 0;
	let visible = true;
	let disposed = false;
	const until = new Map<Glyph, number>();

	function build() {
		const dpr = Math.min(2, devicePixelRatio || 1);
		const W = cv.clientWidth;
		const H = cv.clientHeight;
		cv.width = Math.round(W * dpr);
		cv.height = Math.round(H * dpr);
		const CW = cv.width;
		const CH = cv.height;
		const iw = photo.naturalWidth;
		const ih = photo.naturalHeight;
		const s = Math.max(W / iw, H / ih);
		const sw = W / s;
		const sh = H / s;
		const x0 = (iw - sw) / 2;
		const y0 = (ih - sh) / 2;
		const [, px] = canvas2d(CW, CH);
		px.drawImage(photo, x0, y0, sw, sh, 0, 0, CW, CH);
		const [, mx] = canvas2d(CW, CH);
		mx.drawImage(mask, (x0 * mask.naturalWidth) / iw, (y0 * mask.naturalHeight) / ih, (sw * mask.naturalWidth) / iw, (sh * mask.naturalHeight) / ih, 0, 0, CW, CH);
		const img = px.getImageData(0, 0, CW, CH);
		const d = img.data;
		const M = mx.getImageData(0, 0, CW, CH).data;
		const raw = new Uint8ClampedArray(d);
		// Livelli di tono separati: sul solo pi per i caratteri della pietra, su tutta la foto per lo scioglimento.
		const piS: number[] = [];
		const allS: number[] = [];
		for (let p = 0; p < d.length; p += 32) {
			const l = lumOf(d, p);
			allS.push(l);
			if (M[p] > 127) piS.push(l);
		}
		piS.sort((a, b) => a - b);
		allS.sort((a, b) => a - b);
		const lo = piS[(piS.length * 0.02) | 0] || 0;
		const span = Math.max((piS[(piS.length * 0.98) | 0] || 1) - lo, 1e-3);
		const lo2 = allS[(allS.length * 0.02) | 0] || 0;
		const span2 = Math.max((allS[(allS.length * 0.98) | 0] || 1) - lo2, 1e-3);
		// Stampa scura: alone sulle luci e foto abbassata fuori dal pi, foto scurita sotto i caratteri.
		for (let p = 0; p < d.length; p += 4) {
			const l = lumOf(d, p);
			const halo = clamp((l - 0.7) / 0.3) * 0.3;
			const m = M[p] / 255;
			for (let k = 0; k < 3; k++) {
				const a = d[p + k] / 255;
				d[p + k] = ((1 - (1 - a) * (1 - halo)) * 0.62 * (1 - m) + a * 0.42 * m) * 255;
			}
		}
		const [bg, bx] = canvas2d(CW, CH);
		bx.putImageData(img, 0, 0);

		const cell = CELL * dpr;
		const cols = Math.ceil(CW / cell);
		const rows = Math.ceil(CH / cell);
		const N = cols * rows;
		const pch: string[] = new Array(N).fill('');
		const pcol: string[] = new Array(N).fill('');
		const pal = new Float32Array(N);
		const order = new Float32Array(N);
		const isPi = new Uint8Array(N);
		const glyphs: Glyph[] = [];
		const index = new Map<number, number>();
		for (let gy = 0; gy < rows; gy++)
			for (let gx = 0; gx < cols; gx++) {
				const i = gy * cols + gx;
				const cx = Math.min(CW - 1, Math.round((gx + 0.5) * cell));
				const cy = Math.min(CH - 1, Math.round((gy + 0.5) * cell));
				const p = (cy * CW + cx) * 4;
				const l = lumOf(raw, p);
				const pi = M[p] >= 128;
				const t = pi ? smooth(clamp((l - lo) / span)) : clamp((l - lo2) / span2);
				const k = Math.min(RAMP.length - 1, Math.floor(t * RAMP.length));
				order[i] = hash(gx, gy);
				if (!k) continue;
				const r = raw[p] / 255;
				const g = raw[p + 1] / 255;
				const b = raw[p + 2] / 255;
				pch[i] = RAMP[k];
				pcol[i] = color(r, g, b);
				pal[i] = clamp(0.5 + 1.1 * t) * (pi ? 1 : 0.85);
				isPi[i] = pi ? 1 : 0;
				if (pi) {
					index.set(i, glyphs.length);
					glyphs.push({ gx, gy, ch: RAMP[k], color: pcol[i], bright: color(r, g, b, OCHRE, 0.75), alpha: pal[i] });
				}
			}

		// Screenshot allineato alla stessa griglia: ogni cella ha anche il carattere di Studio.
		const fit = Math.min((W * 0.84) / shot.naturalWidth, (H * 0.6) / shot.naturalHeight);
		const scols = Math.floor((shot.naturalWidth * fit) / CELL);
		const srows = Math.floor((shot.naturalHeight * fit) / CELL);
		const sx0 = Math.round((cols - scols) / 2);
		const sy0 = Math.max(Math.ceil(72 / CELL), Math.round((rows - srows) / 2 - rows * 0.1));
		const [, gx2] = canvas2d(scols, srows);
		gx2.imageSmoothingQuality = 'high';
		gx2.drawImage(shot, 0, 0, scols, srows);
		const D = gx2.getImageData(0, 0, scols, srows).data;
		const sch: string[] = new Array(scols * srows);
		const scol: string[] = new Array(scols * srows);
		const sord = new Float32Array(scols * srows);
		for (let y = 0; y < srows; y++)
			for (let x = 0; x < scols; x++) {
				const j = y * scols + x;
				const p = j * 4;
				const l = lumOf(D, p);
				const k = Math.min(RAMP.length - 1, Math.floor(clamp((l - 0.12) / 0.7) * RAMP.length));
				sch[j] = RAMP[Math.max(k, l > 0.16 ? 1 : 0)];
				scol[j] = color(D[p] / 255, D[p + 1] / 255, D[p + 2] / 255);
				sord[j] = 0.62 * hash(x + 3, y) + 0.38 * (1 - y / srows);
			}

		const font = `600 ${Math.round(cell * 1.45)}px ${FONT_STACK}`;
		const [st, sx] = canvas2d(CW, CH);
		sx.drawImage(bg, 0, 0);
		sx.font = font;
		sx.textAlign = 'center';
		sx.textBaseline = 'middle';
		for (const g of glyphs) {
			sx.globalAlpha = g.alpha;
			sx.fillStyle = g.color;
			sx.fillText(g.ch, (g.gx + 0.5) * cell, (g.gy + 0.5) * cell);
		}
		S = { dpr, cell, cols, rows, bg, settled: st, glyphs, index, font, pch, pcol, pal, order, isPi, sch, scol, sord, scols, srows, sx0, sy0, CW, CH };
	}

	const scr = (a: number, b: number, now: number) => HEAVY[Math.floor(hash(a * 131 + b, Math.floor(now / 60)) * HEAVY.length)];
	const progress = () => {
		if (reduced) return 0;
		const r = gate.getBoundingClientRect();
		return clamp(-r.top / (r.height - innerHeight));
	};

	function drawHero(now: number) {
		const { cell, rows, bg, settled, glyphs } = S;
		const t = now - introStart;
		const intro = !reduced && t < 1500;
		ctx.drawImage(intro ? bg : settled, 0, 0);
		if (intro) {
			// La pietra si compone dal basso.
			for (const g of glyphs) {
				const start = 120 + (1 - g.gy / rows) * 650 + hash(g.gx, g.gy) * 300;
				const settle = start + 160 + hash(g.gy, g.gx) * 240;
				if (t < start) continue;
				const s = t < settle;
				ctx.globalAlpha = s ? 1 : g.alpha;
				ctx.fillStyle = s ? g.bright : g.color;
				ctx.fillText(s ? scr(g.gx, g.gy, now) : g.ch, (g.gx + 0.5) * cell, (g.gy + 0.5) * cell);
			}
		} else if (!reduced) {
			// Vita a riposo: qualche carattere si rimescola anche col puntatore fermo.
			if (Math.random() < 0.35 && glyphs.length) until.set(glyphs[(Math.random() * glyphs.length) | 0], now + 260);
			for (const [g, end] of until) {
				if (now > end) {
					until.delete(g);
					continue;
				}
				const x = g.gx * cell;
				const y = g.gy * cell;
				ctx.drawImage(bg, x, y, cell, cell, x, y, cell, cell);
				ctx.globalAlpha = 1;
				ctx.fillStyle = g.bright;
				ctx.fillText(scr(g.gx, g.gy, now), x + cell / 2, y + cell / 2);
			}
		}
	}

	function drawPassage(p: number, now: number) {
		const { cell, cols, rows, bg, pch, pcol, pal, order, isPi, sch, scol, sord, scols, srows, sx0, sy0, CW, CH } = S;
		const d1 = clamp(p / 0.3);
		const d2 = clamp((p - 0.3) / 0.25);
		const d3 = clamp((p - 0.6) / 0.25);
		ctx.globalAlpha = 1;
		ctx.fillStyle = GROUND;
		ctx.fillRect(0, 0, CW, CH);
		if (d1 < 1) {
			ctx.globalAlpha = 1 - smooth(d1);
			ctx.drawImage(bg, 0, 0);
		}
		const rx = sx0 * cell;
		const ry = sy0 * cell;
		const rw = scols * cell;
		const rh = srows * cell;
		if (d3 > 0) {
			ctx.globalAlpha = 1;
			ctx.drawImage(shot, rx, ry, rw, rh);
		}
		const tick = Math.floor(now / 70);
		for (let gy = 0; gy < rows; gy++)
			for (let gx = 0; gx < cols; gx++) {
				const i = gy * cols + gx;
				const x = gx * cell;
				const y = gy * cell;
				const sxI = gx - sx0;
				const syI = gy - sy0;
				const inShot = sxI >= 0 && sxI < scols && syI >= 0 && syI < srows;
				const j = syI * scols + sxI;
				if (inShot && d3 > 0) {
					const o = sord[j];
					// Le celle piu' tarde hanno ordine vicino a 1: la soglia supera 1 perche' a fine corsa non resti nulla.
					const dev = d3 * 1.06;
					if (o < dev - 0.035) continue;
					ctx.globalAlpha = 1;
					ctx.fillStyle = GROUND;
					ctx.fillRect(x, y, cell, cell);
					// Il bordo dello sviluppo scorre in ocra.
					if (o < dev + 0.02) {
						ctx.fillStyle = OCHRE_CSS;
						ctx.fillText(HEAVY[(hash(gx, gy + tick) * HEAVY.length) | 0], x + cell / 2, y + cell / 2);
						continue;
					}
				}
				const o = order[i];
				if (d2 > 0 && o < d2) {
					if (!inShot || sch[j] === ' ') continue;
					const edge = d2 - o < 0.04;
					ctx.globalAlpha = 1;
					ctx.fillStyle = edge ? OCHRE_CSS : scol[j];
					ctx.fillText(edge ? HEAVY[(hash(gx, gy + tick) * HEAVY.length) | 0] : sch[j], x + cell / 2, y + cell / 2);
					continue;
				}
				if (!pch[i]) continue;
				if (!isPi[i] && o > d1 * 1.15) continue;
				ctx.globalAlpha = isPi[i] ? pal[i] : pal[i] * Math.min(1, d1 * 1.6);
				ctx.fillStyle = pcol[i];
				ctx.fillText(pch[i], x + cell / 2, y + cell / 2);
			}
		if (d3 >= 1) {
			ctx.globalAlpha = 1;
			ctx.strokeStyle = 'rgb(242 240 234 / .18)';
			ctx.lineWidth = S.dpr;
			ctx.strokeRect(rx + 0.5, ry + 0.5, rw - 1, rh - 1);
		}
	}

	function frame(now: number) {
		raf = 0;
		if (disposed) return;
		const p = progress();
		ctx.font = S.font;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		if (p <= 0.001) drawHero(now);
		else drawPassage(p, now);
		ctx.globalAlpha = 1;
		const out = clamp(p / 0.1);
		heroCopy.style.opacity = String(1 - out);
		heroCopy.style.visibility = out >= 1 ? 'hidden' : 'visible';
		heroCopy.style.transform = `translateY(${-out * 30}px)`;
		scrim.style.opacity = String(1 - clamp(p / 0.25));
		const cap = clamp((p - 0.86) / 0.08);
		caption.style.opacity = String(cap);
		caption.style.transform = `translateY(${(1 - cap) * 20}px)`;
		if (!reduced && visible) raf = requestAnimationFrame(frame);
	}
	const wake = () => {
		if (!raf && !disposed) raf = requestAnimationFrame(frame);
	};

	build();
	cv.classList.add('ready');
	wake();

	const io = new IntersectionObserver(([e]) => {
		visible = e.isIntersecting;
		if (visible) wake();
	});
	io.observe(gate);
	let resizeTimer = 0;
	const onResize = () => {
		clearTimeout(resizeTimer);
		resizeTimer = window.setTimeout(() => {
			build();
			wake();
		}, 150);
	};
	const onScroll = () => wake();
	// Il rimescolamento sotto il puntatore vale solo per la rovina ferma, prima dello scorrimento.
	const onPointer = (e: PointerEvent) => {
		if (progress() > 0.001) return;
		const r = cv.getBoundingClientRect();
		const now = performance.now();
		const cx = Math.floor((e.clientX - r.left) / CELL);
		const cy = Math.floor((e.clientY - r.top) / CELL);
		for (let y = cy - 6; y <= cy + 6; y++)
			for (let x = cx - 6; x <= cx + 6; x++) {
				const d = Math.hypot(x - cx, y - cy);
				if (d > 6) continue;
				const k = S.index.get(y * S.cols + x);
				if (k === undefined) continue;
				const g = S.glyphs[k];
				until.set(g, Math.max(until.get(g) || 0, now + 180 + (1 - d / 6) * 260 + hash(x, y) * 160));
			}
		wake();
	};
	addEventListener('resize', onResize);
	addEventListener('scroll', onScroll, { passive: true });
	if (!reduced) cv.parentElement!.addEventListener('pointermove', onPointer);

	return () => {
		disposed = true;
		cancelAnimationFrame(raf);
		io.disconnect();
		clearTimeout(resizeTimer);
		removeEventListener('resize', onResize);
		removeEventListener('scroll', onScroll);
		cv.parentElement?.removeEventListener('pointermove', onPointer);
	};
}
