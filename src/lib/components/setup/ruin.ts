/**
 * Rovina ASCII dell'ingresso del setup.
 *
 * Stesso effetto di `site/src/lib/ruin.ts` (rampa, ocra, fondo, cella 7 px) ma a tempo
 * invece che a scorrimento: l'ingresso del setup non ha una pagina da scorrere, quindi
 * l'orologio parte al montaggio.
 *
 *   0,25–1,75 s  il paesaggio si compone in caratteri dal basso (scramble ocra)
 *   1,65–2,45 s  la foto si sviluppa a celle sotto i caratteri, il pi resta di pietra
 *   poi          vita a riposo: qualche carattere si rimescola, e sotto il puntatore
 *
 * Un solo orologio (rAF). Con movimento ridotto si disegna una volta, fermo.
 * Le immagini sono in `static/img` alla dimensione d'uso (1672×941, vedi AGENTS.md
 * «Asset: regole»): il canvas legge un pixel per cella, non serve altro.
 */
const RAMP = ' .:-=+*#%@';
const HEAVY = '=+*#%@';
const OCHRE = [227, 192, 106];
const OCHRE_CSS = 'rgb(227 192 106)';
const GROUND = '#0e0e0c';
const CELL = 7;
// `var(--font-mono)` non viene risolto dentro un canvas: lo stack va scritto per esteso.
const FONT_STACK = "'JetBrains Mono', 'Cascadia Mono', Consolas, monospace";

export const T_COMPOSE = 250;
export const T_COMPOSE_SPAN = 850;
export const T_DEVELOP = 1650;
export const T_DEVELOP_END = 2450;

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (t: number) => t * t * (3 - 2 * t);

function hash(a: number, b: number) {
	let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
	h ^= h >>> 15;
	h = Math.imul(h, 0x2c1b3c6d);
	return ((h ^ (h >>> 12)) >>> 0) / 4294967296;
}

const lumOf = (d: Uint8ClampedArray, p: number) =>
	(0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]) / 255;

function canvas2d(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
	const c = document.createElement('canvas');
	c.width = w;
	c.height = h;
	return [c, c.getContext('2d', { willReadFrequently: true })!];
}

/** Colore della cella: la foto normalizzata sul suo picco, avvicinata all'ocra. */
function color(r: number, g: number, b: number, toward?: number[], k = 0) {
	const peak = Math.max(r, g, b, 0.05);
	let c = [r, g, b].map((v) => Math.max((v / peak) * 0.98, v) * 255);
	if (toward) c = c.map((v, i) => v + (toward[i] - v) * k);
	return `rgb(${c[0] | 0} ${c[1] | 0} ${c[2] | 0})`;
}

const sizeOf = (s: HTMLImageElement) => [s.naturalWidth, s.naturalHeight];

interface Glyph {
	gx: number;
	gy: number;
	ch: string;
	color: string;
	bright: string;
	alpha: number;
}

interface Scene {
	cell: number;
	cols: number;
	rows: number;
	CW: number;
	CH: number;
	font: string;
	bg: HTMLCanvasElement;
	settled: HTMLCanvasElement;
	ascii: HTMLCanvasElement;
	piLayer: HTMLCanvasElement;
	layer: HTMLCanvasElement;
	maskC: HTMLCanvasElement;
	maskX: CanvasRenderingContext2D;
	maskImg: ImageData;
	glyphs: Glyph[];
	index: Map<number, number>;
	pch: string[];
	pcol: string[];
	pbright: string[];
	pal: Float32Array;
	dev: Float32Array;
}

export interface RuinHandle {
	skip(): void;
	dispose(): void;
}

export interface RuinOptions {
	reduced: boolean;
	intro: boolean;
	onReady?: () => void;
}

/** Le due immagini, caricate una volta per processo: i rimontaggi riusano la scena. */
let sources: Promise<{ photo: HTMLImageElement; mask: HTMLImageElement }> | null = null;

function loadImage(src: string): Promise<HTMLImageElement> {
	const { promise, resolve, reject } = Promise.withResolvers<HTMLImageElement>();
	const img = new Image();
	img.onload = () => (img.naturalWidth > 100 ? resolve(img) : reject(new Error(`immagine vuota: ${src}`)));
	img.onerror = () => reject(new Error(`immagine non caricata: ${src}`));
	img.src = src;
	return promise;
}

function loadRuin() {
	sources ??= Promise.all([loadImage('/img/ruin.webp'), loadImage('/img/ruin-mask.png')]).then(
		([photo, mask]) => ({ photo, mask })
	);
	return sources;
}

export function mountRuin(cv: HTMLCanvasElement, opts: RuinOptions): RuinHandle {
	const ctx = cv.getContext('2d')!;
	let S: Scene | null = null;
	let introStart = performance.now();
	let raf = 0;
	let disposed = false;
	let skipped = false;
	let photo: HTMLImageElement;
	let mask: HTMLImageElement;
	const until = new Map<Glyph, number>();
	if (!opts.intro) introStart -= T_DEVELOP_END;

	function build() {
		const dpr = Math.min(2, devicePixelRatio || 1);
		const W = cv.clientWidth || innerWidth;
		const H = cv.clientHeight || innerHeight;
		cv.width = Math.round(W * dpr);
		cv.height = Math.round(H * dpr);
		const CW = cv.width;
		const CH = cv.height;
		const [iw, ih] = sizeOf(photo);
		const [mw, mh] = sizeOf(mask);
		// La foto copre il canvas conservando le proporzioni, con il soggetto un po'
		// sopra il centro; la maschera è stirata con la stessa finestra.
		const s = Math.max(W / iw, H / ih);
		const sw = W / s;
		const sh = H / s;
		const x0 = (iw - sw) / 2;
		const y0 = Math.max(0, (ih - sh) * 0.42);
		const [, px] = canvas2d(CW, CH);
		px.drawImage(photo, x0, y0, sw, sh, 0, 0, CW, CH);
		const [, mx] = canvas2d(CW, CH);
		mx.drawImage(mask, (x0 * mw) / iw, (y0 * mh) / ih, (sw * mw) / iw, (sh * mh) / ih, 0, 0, CW, CH);
		const img = px.getImageData(0, 0, CW, CH);
		const d = img.data;
		const M = mx.getImageData(0, 0, CW, CH).data;
		const raw = new Uint8ClampedArray(d);
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
		// Stampa scura: alone sulle luci e foto abbassata fuori dal pi, foto scurita
		// sotto i caratteri che restano.
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
		const pbright: string[] = new Array(N).fill('');
		const pal = new Float32Array(N);
		const dev = new Float32Array(N);
		const glyphs: Glyph[] = [];
		const index = new Map<number, number>();
		for (let gy = 0; gy < rows; gy++)
			for (let gx = 0; gx < cols; gx++) {
				const i = gy * cols + gx;
				// Lo sviluppo entra dal basso con un po' di disordine, non a righe nette.
				dev[i] = 0.55 * hash(gx + 7, gy) + 0.45 * (1 - gy / rows);
				const cx = Math.min(CW - 1, Math.round((gx + 0.5) * cell));
				const cy = Math.min(CH - 1, Math.round((gy + 0.5) * cell));
				const p = (cy * CW + cx) * 4;
				const l = lumOf(raw, p);
				const pi = M[p] >= 128;
				const t = pi ? smooth(clamp((l - lo) / span)) : clamp((l - lo2) / span2);
				const k = Math.min(RAMP.length - 1, Math.floor(t * RAMP.length));
				if (!k) continue;
				const r = raw[p] / 255;
				const g = raw[p + 1] / 255;
				const b = raw[p + 2] / 255;
				pch[i] = RAMP[k];
				pcol[i] = color(r, g, b);
				pbright[i] = color(r, g, b, OCHRE, 0.75);
				pal[i] = clamp(0.5 + 1.1 * t) * (pi ? 1 : 0.85);
				if (pi) {
					index.set(i, glyphs.length);
					glyphs.push({ gx, gy, ch: RAMP[k], color: pcol[i], bright: pbright[i], alpha: pal[i] });
				}
			}

		const font = `600 ${Math.round(cell * 1.45)}px ${FONT_STACK}`;
		const prep = (x: CanvasRenderingContext2D) => {
			x.font = font;
			x.textAlign = 'center';
			x.textBaseline = 'middle';
		};
		// Tutti i caratteri del paesaggio sul fondo: lo stato a fine composizione.
		const [ascii, ax] = canvas2d(CW, CH);
		ax.fillStyle = GROUND;
		ax.fillRect(0, 0, CW, CH);
		prep(ax);
		for (let i = 0; i < N; i++) {
			if (!pch[i]) continue;
			ax.globalAlpha = pal[i];
			ax.fillStyle = pcol[i];
			ax.fillText(pch[i], ((i % cols) + 0.5) * cell, (((i / cols) | 0) + 0.5) * cell);
		}
		// Il solo pi, trasparente: resta sopra la foto che si sviluppa.
		const [piLayer, plx] = canvas2d(CW, CH);
		prep(plx);
		for (const g of glyphs) {
			plx.globalAlpha = g.alpha;
			plx.fillStyle = g.color;
			plx.fillText(g.ch, (g.gx + 0.5) * cell, (g.gy + 0.5) * cell);
		}
		const [settled, sx] = canvas2d(CW, CH);
		sx.drawImage(bg, 0, 0);
		sx.drawImage(piLayer, 0, 0);
		const [layer] = canvas2d(CW, CH);
		const [maskC, maskX] = canvas2d(cols, rows);
		const maskImg = maskX.createImageData(cols, rows);
		S = {
			cell, cols, rows, CW, CH, font, bg, settled, ascii, piLayer, layer,
			maskC, maskX, maskImg, glyphs, index, pch, pcol, pbright, pal, dev
		};
	}

	const scr = (a: number, b: number, now: number) =>
		HEAVY[Math.floor(hash(a * 131 + b, Math.floor(now / 60)) * HEAVY.length)];
	const rowStart = (gy: number, rows: number) => T_COMPOSE + (1 - gy / rows) * T_COMPOSE_SPAN;

	function drawCompose(t: number, now: number) {
		const s = S!;
		const { cell, cols, rows, CW, CH, pch, pcol, pbright, pal } = s;
		ctx.globalAlpha = 1;
		ctx.fillStyle = GROUND;
		ctx.fillRect(0, 0, CW, CH);
		// Le righe già assestate (in basso) si copiano in blocco dallo stato finale.
		let firstDone = rows;
		while (firstDone > 0 && t > rowStart(firstDone - 1, rows) + 700) firstDone--;
		if (firstDone < rows) {
			ctx.drawImage(s.ascii, 0, firstDone * cell, CW, CH - firstDone * cell, 0, firstDone * cell, CW, CH - firstDone * cell);
		}
		for (let gy = 0; gy < firstDone; gy++) {
			const rs = rowStart(gy, rows);
			if (t < rs) continue;
			for (let gx = 0; gx < cols; gx++) {
				const i = gy * cols + gx;
				if (!pch[i]) continue;
				const start = rs + hash(gx, gy) * 300;
				if (t < start) continue;
				const settling = t < start + 160 + hash(gy, gx) * 240;
				ctx.globalAlpha = settling ? 1 : pal[i];
				ctx.fillStyle = settling ? pbright[i] : pcol[i];
				ctx.fillText(settling ? scr(gx, gy, now) : pch[i], (gx + 0.5) * cell, (gy + 0.5) * cell);
			}
		}
	}

	function drawDevelop(t: number, now: number) {
		const s = S!;
		const { cell, cols, rows, CW, CH, dev, maskImg } = s;
		const d = smooth(clamp((t - T_DEVELOP) / (T_DEVELOP_END - T_DEVELOP))) * 1.08;
		const md = maskImg.data;
		for (let i = 0; i < cols * rows; i++) md[i * 4 + 3] = dev[i] < d ? 255 : 0;
		s.maskX.putImageData(maskImg, 0, 0);
		const lx = s.layer.getContext('2d')!;
		lx.globalCompositeOperation = 'source-over';
		lx.clearRect(0, 0, CW, CH);
		lx.drawImage(s.bg, 0, 0);
		lx.globalCompositeOperation = 'destination-in';
		lx.imageSmoothingEnabled = false;
		lx.drawImage(s.maskC, 0, 0, cols, rows, 0, 0, cols * cell, rows * cell);
		lx.globalCompositeOperation = 'source-over';
		ctx.globalAlpha = 1;
		ctx.drawImage(s.ascii, 0, 0);
		ctx.drawImage(s.layer, 0, 0);
		ctx.drawImage(s.piLayer, 0, 0);
		// Il bordo dello sviluppo scorre in ocra.
		const tick = Math.floor(now / 70);
		ctx.fillStyle = OCHRE_CSS;
		for (let i = 0; i < cols * rows; i++) {
			const o = dev[i];
			if (o < d || o > d + 0.03) continue;
			const gx = i % cols;
			const gy = (i / cols) | 0;
			ctx.globalAlpha = 0.85;
			ctx.fillText(HEAVY[(hash(gx, gy + tick) * HEAVY.length) | 0], (gx + 0.5) * cell, (gy + 0.5) * cell);
		}
	}

	function drawRest(now: number) {
		const s = S!;
		const { cell, glyphs } = s;
		ctx.globalAlpha = 1;
		ctx.drawImage(s.settled, 0, 0);
		if (opts.reduced) return;
		// Vita a riposo: qualche carattere si rimescola anche col puntatore fermo.
		if (Math.random() < 0.35 && glyphs.length) {
			until.set(glyphs[(Math.random() * glyphs.length) | 0], now + 260);
		}
		for (const [g, end] of until) {
			if (now > end) {
				until.delete(g);
				continue;
			}
			const x = g.gx * cell;
			const y = g.gy * cell;
			ctx.drawImage(s.bg, x, y, cell, cell, x, y, cell, cell);
			ctx.globalAlpha = 1;
			ctx.fillStyle = g.bright;
			ctx.fillText(scr(g.gx, g.gy, now), x + cell / 2, y + cell / 2);
		}
	}

	function frame(now: number) {
		raf = 0;
		if (disposed || !S) return;
		ctx.font = S.font;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		const t = opts.reduced ? Infinity : now - introStart;
		if (t < T_DEVELOP) drawCompose(t, now);
		else if (t < T_DEVELOP_END) drawDevelop(t, now);
		else drawRest(now);
		ctx.globalAlpha = 1;
		if (!opts.reduced) raf = requestAnimationFrame(frame);
	}

	const wake = () => {
		if (!raf && !disposed) raf = requestAnimationFrame(frame);
	};

	let resizeTimer = 0;
	const onResize = () => {
		clearTimeout(resizeTimer);
		// Il ridimensionamento ricostruisce le maschere: 150 ms di quiete evitano una
		// raffica di ricostruzioni mentre si trascina il bordo della finestra.
		resizeTimer = window.setTimeout(() => {
			if (!S) return;
			build();
			wake();
		}, 150);
	};

	const onPointer = (e: PointerEvent) => {
		if (!S || opts.reduced || performance.now() - introStart < T_DEVELOP_END) return;
		const r = cv.getBoundingClientRect();
		const now = performance.now();
		const cx = Math.floor((e.clientX - r.left) / CELL);
		const cy = Math.floor((e.clientY - r.top) / CELL);
		for (let y = cy - 6; y <= cy + 6; y++)
			for (let x = cx - 6; x <= cx + 6; x++) {
				const dd = Math.hypot(x - cx, y - cy);
				if (dd > 6) continue;
				const k = S.index.get(y * S.cols + x);
				if (k === undefined) continue;
				const g = S.glyphs[k];
				until.set(g, Math.max(until.get(g) || 0, now + 180 + (1 - dd / 6) * 260 + hash(x, y) * 160));
			}
	};

	loadRuin()
		.then((src) => {
			if (disposed) return;
			photo = src.photo;
			mask = src.mask;
			build();
			// Il tempo dell'ingresso parte quando la scena è pronta.
			if (opts.intro && !skipped) introStart = performance.now();
			opts.onReady?.();
			wake();
		})
		.catch((e) => {
			// Senza immagini resta il fondo del canvas (`#0e0e0c`): l'ingresso non si
			// blocca, la finestra sale comunque.
			console.error('Rovina non caricata', e);
			opts.onReady?.();
		});

	addEventListener('resize', onResize);
	cv.parentElement?.addEventListener('pointermove', onPointer);

	return {
		skip() {
			skipped = true;
			introStart = performance.now() - T_DEVELOP_END;
			wake();
		},
		dispose() {
			disposed = true;
			cancelAnimationFrame(raf);
			clearTimeout(resizeTimer);
			removeEventListener('resize', onResize);
			cv.parentElement?.removeEventListener('pointermove', onPointer);
		}
	};
}
