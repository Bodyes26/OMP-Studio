// Rovina in caratteri ASCII: lo stesso effetto dello sfondo del DMG
// (scripts/generate-dmg-background.py), calcolato qui nel canvas per animarlo.
// Il pi e' fatto di caratteri colorati come la pietra sopra la foto scurita; il resto
// della foto ha vignettatura e alone sulle luci come una stampa da pellicola.
//
// Animazioni: il pi si compone dal basso all'avvio, i caratteri si rimescolano sotto
// il puntatore, una banda li attraversa durante l'installazione e un'onda sale alla
// fine. Con prefers-reduced-motion l'immagine e' ferma.

const RAMP = ' .:-=+*#%@';
const HEAVY = '=+*#%@';
const CELL_CSS = 6;
// Stack letterale: nel canvas var(--font-mono) non viene risolto.
const FONT = '"Cascadia Mono", Consolas, "Courier New", monospace';
const DARK = 0.55;
const HOVER_RADIUS = 6;

function loadImage(src) {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error(`immagine non caricata: ${src}`));
		image.src = src;
	});
}

function pixels(image, width, height) {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	const scale = Math.max(width / image.width, height / image.height);
	const w = image.width * scale;
	const h = image.height * scale;
	ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
	return ctx.getImageData(0, 0, width, height).data;
}

// Rumore deterministico per cella e istante: i caratteri cambiano a ~16 Hz, non a ogni frame.
function hash(a, b) {
	let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
	h ^= h >>> 15;
	h = Math.imul(h, 0x2c1b3c6d);
	return ((h ^ (h >>> 12)) >>> 0) / 4294967296;
}

function grainTexture() {
	const size = 192;
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext('2d');
	const data = ctx.createImageData(size, size);
	for (let i = 0; i < data.data.length; i += 4) {
		const v = Math.random() * 255;
		data.data[i] = v;
		data.data[i + 1] = v;
		data.data[i + 2] = v;
		data.data[i + 3] = 255;
	}
	ctx.putImageData(data, 0, 0);
	return canvas.toDataURL();
}

function buildScene(canvas, photo, mask) {
	const dpr = window.devicePixelRatio || 1;
	const W = Math.max(1, Math.round(canvas.clientWidth * dpr));
	const H = Math.max(1, Math.round(canvas.clientHeight * dpr));
	canvas.width = W;
	canvas.height = H;

	const P = pixels(photo, W, H);
	const M = pixels(mask, W, H);
	const n = W * H;

	// Livelli di tono calcolati solo sul pi: su tutta la foto il marmo cadrebbe su un solo carattere.
	const lum = new Float32Array(n);
	const sample = [];
	for (let i = 0, p = 0; i < n; i++, p += 4) {
		lum[i] = (0.299 * P[p] + 0.587 * P[p + 1] + 0.114 * P[p + 2]) / 255;
		if (M[p] > 127 && (i & 3) === 0) sample.push(lum[i]);
	}
	sample.sort((a, b) => a - b);
	const lo = sample.length ? sample[Math.floor(sample.length * 0.02)] : 0;
	const hi = sample.length ? sample[Math.floor(sample.length * 0.98)] : 1;
	const span = Math.max(hi - lo, 1e-3);

	// Fondo: foto da pellicola fuori dal pi, foto scurita sotto i caratteri.
	const base = document.createElement('canvas');
	base.width = W;
	base.height = H;
	const bctx = base.getContext('2d');
	const out = bctx.createImageData(W, H);
	const tone = new Float32Array(n);
	for (let y = 0, i = 0; y < H; y++) {
		const dy = y / H - 0.5;
		for (let x = 0; x < W; x++, i++) {
			const p = i * 4;
			const dx = x / W - 0.5;
			const d = Math.sqrt(dx * dx + dy * dy) / 0.707;
			const vignette = 1 - 0.35 * d * d;
			const halo = Math.min(Math.max((lum[i] - 0.7) / 0.3, 0), 1) * 0.35;
			const s = M[p] / 255;
			let t = Math.min(Math.max((lum[i] - lo) / span, 0), 1);
			tone[i] = t * t * (3 - 2 * t);
			for (let c = 0; c < 3; c++) {
				const a = P[p + c] / 255;
				const film = (1 - (1 - a) * (1 - halo)) * vignette;
				out.data[p + c] = (film * (1 - s) + a * DARK * s) * 255;
			}
			out.data[p + 3] = 255;
		}
	}
	bctx.putImageData(out, 0, 0);

	// Celle: carattere dal tono medio, colore della pietra schiarito come nel DMG.
	const cell = Math.max(4, Math.round(CELL_CSS * dpr));
	const cols = Math.ceil(W / cell);
	const rows = Math.ceil(H / cell);
	const grid = new Int32Array(cols * rows).fill(-1);
	const glyphs = [];
	for (let gy = 0; gy < rows; gy++) {
		for (let gx = 0; gx < cols; gx++) {
			let sumT = 0, sumS = 0, r = 0, g = 0, b = 0, count = 0;
			for (let y = gy * cell; y < Math.min(H, (gy + 1) * cell); y++) {
				for (let x = gx * cell; x < Math.min(W, (gx + 1) * cell); x++) {
					const i = y * W + x;
					const p = i * 4;
					sumT += tone[i];
					sumS += M[p] / 255;
					r += P[p];
					g += P[p + 1];
					b += P[p + 2];
					count++;
				}
			}
			const s = sumS / count;
			const t = sumT / count;
			const index = Math.min(RAMP.length - 1, Math.floor(t * RAMP.length));
			if (s < 0.5 || index === 0) continue;
			r /= count * 255;
			g /= count * 255;
			b /= count * 255;
			const peak = Math.max(r, g, b, 0.05);
			const color = [r, g, b].map((v) => Math.round(Math.max((v / peak) * 0.98, v) * 255));
			grid[gy * cols + gx] = glyphs.length;
			glyphs.push({
				x: gx * cell + cell / 2,
				y: gy * cell + cell / 2,
				gx,
				gy,
				char: RAMP[index],
				color: `rgb(${color[0]} ${color[1]} ${color[2]})`,
				// I caratteri in movimento prendono l'ocra dei licheni, l'accento del pannello:
				// sul marmo fitto un carattere diverso dello stesso colore non si vedrebbe.
				bright: `rgb(${color.map((v, c) => Math.round(v + ([227, 192, 106][c] - v) * 0.75)).join(' ')})`,
				alpha: Math.min(Math.max(0.5 + 1.1 * t, 0), 1) * Math.min(1, s * 1.2),
				start: 0,
				settle: 0,
				until: 0
			});
		}
	}

	const font = `bold ${Math.round(cell * 1.45)}px ${FONT}`;
	const settled = document.createElement('canvas');
	settled.width = W;
	settled.height = H;
	const sctx = settled.getContext('2d');
	sctx.drawImage(base, 0, 0);
	sctx.font = font;
	sctx.textAlign = 'center';
	sctx.textBaseline = 'middle';
	for (const glyph of glyphs) {
		sctx.globalAlpha = glyph.alpha;
		sctx.fillStyle = glyph.color;
		sctx.fillText(glyph.char, glyph.x, glyph.y);
	}
	sctx.globalAlpha = 1;

	return { W, H, cell, cols, rows, grid, glyphs, base, settled, font };
}

export async function mountRuin(canvas, { reducedMotion }) {
	const hero = canvas.parentElement;
	const grain = hero.querySelector('.grain');
	if (grain) grain.style.backgroundImage = `url(${grainTexture()})`;

	const [photo, mask] = await Promise.all([loadImage('assets/ruin.webp'), loadImage('assets/ruin-mask.png')]);
	const ctx = canvas.getContext('2d');
	let scene = buildScene(canvas, photo, mask);
	let introEnd = 0;
	let busySince = 0;
	let raf = 0;

	function intro(now) {
		for (const glyph of scene.glyphs) {
			const rise = 1 - glyph.gy / scene.rows;
			glyph.start = now + 120 + rise * 650 + hash(glyph.gx, glyph.gy) * 300;
			glyph.settle = glyph.start + 160 + hash(glyph.gy, glyph.gx) * 240;
			introEnd = Math.max(introEnd, glyph.settle);
		}
	}

	function drawScrambled(glyph, now) {
		const tick = Math.floor(now / 60);
		const char = HEAVY[Math.floor(hash(glyph.gx * 131 + glyph.gy, tick) * HEAVY.length)];
		ctx.globalAlpha = 1;
		ctx.fillStyle = glyph.bright;
		ctx.fillText(char, glyph.x, glyph.y);
	}

	function inBusyBand(glyph, now) {
		if (!busySince) return false;
		const band = (((now - busySince) / 1500) % 1) * (scene.rows + 16) - 8;
		return Math.abs(glyph.gy - band) < 2.5 && hash(glyph.gx, glyph.gy + Math.floor(now / 80)) < 0.55;
	}

	function frame(now) {
		raf = 0;
		const { base, settled, glyphs, cell, font } = scene;
		let active = false;
		ctx.font = font;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		if (now < introEnd) {
			active = true;
			ctx.drawImage(base, 0, 0);
			for (const glyph of glyphs) {
				if (now < glyph.start) continue;
				if (now < glyph.settle) {
					drawScrambled(glyph, now);
				} else {
					ctx.globalAlpha = glyph.alpha;
					ctx.fillStyle = glyph.color;
					ctx.fillText(glyph.char, glyph.x, glyph.y);
				}
			}
		} else {
			ctx.drawImage(settled, 0, 0);
			for (const glyph of glyphs) {
				if (now < glyph.until || inBusyBand(glyph, now)) {
					active = true;
					const x = glyph.x - cell / 2;
					const y = glyph.y - cell / 2;
					ctx.drawImage(base, x, y, cell, cell, x, y, cell, cell);
					drawScrambled(glyph, now);
				}
			}
			if (busySince) active = true;
		}
		ctx.globalAlpha = 1;
		if (active) raf = requestAnimationFrame(frame);
	}

	function wake() {
		if (!raf && !reducedMotion) raf = requestAnimationFrame(frame);
	}

	function scramble(clientX, clientY) {
		const rect = canvas.getBoundingClientRect();
		const dpr = scene.W / rect.width;
		const cx = Math.floor(((clientX - rect.left) * dpr) / scene.cell);
		const cy = Math.floor(((clientY - rect.top) * dpr) / scene.cell);
		const now = performance.now();
		for (let gy = cy - HOVER_RADIUS; gy <= cy + HOVER_RADIUS; gy++) {
			if (gy < 0 || gy >= scene.rows) continue;
			for (let gx = cx - HOVER_RADIUS; gx <= cx + HOVER_RADIUS; gx++) {
				if (gx < 0 || gx >= scene.cols) continue;
				const d = Math.hypot(gx - cx, gy - cy);
				const index = scene.grid[gy * scene.cols + gx];
				if (index < 0 || d > HOVER_RADIUS) continue;
				const glyph = scene.glyphs[index];
				glyph.until = Math.max(glyph.until, now + 180 + (1 - d / HOVER_RADIUS) * 260 + hash(gx, gy) * 160);
			}
		}
		wake();
	}

	if (reducedMotion) {
		ctx.drawImage(scene.settled, 0, 0);
	} else {
		intro(performance.now());
		hero.addEventListener('pointermove', (event) => scramble(event.clientX, event.clientY));
		wake();
	}
	canvas.classList.add('ready');

	// Cambio di schermo con un altro ridimensionamento: si ricalcola alla nuova densita'.
	let resizeTimer = 0;
	window.addEventListener('resize', () => {
		clearTimeout(resizeTimer);
		resizeTimer = setTimeout(() => {
			scene = buildScene(canvas, photo, mask);
			introEnd = 0;
			ctx.drawImage(scene.settled, 0, 0);
			if (busySince) wake();
		}, 150);
	});

	return {
		setBusy(on) {
			busySince = on ? performance.now() : 0;
			wake();
		},
		// Onda finale dal basso verso l'alto.
		finish() {
			if (reducedMotion) return;
			const now = performance.now();
			for (const glyph of scene.glyphs) {
				const rise = 1 - glyph.gy / scene.rows;
				glyph.until = now + rise * 520 + 140 + hash(glyph.gx, glyph.gy) * 90;
			}
			wake();
		}
	};
}
