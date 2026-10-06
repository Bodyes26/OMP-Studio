#!/usr/bin/env node
// Genera tutte le icone di OMP Studio dal disegno del pi greco squadrato di omp.
//
//   npm run logo
//
// Il disegno vive qui come geometria, non in un file grafico: sei rettangoli in
// unita' t (lo spessore unico di tetto e gambe). Da qui escono:
//
//   assets/logo/*.svg              sorgenti vettoriali (Windows, macOS, monocolore)
//   assets/logo/readme-*.png       logo del README, una variante per tema di GitHub
//   src-tauri/icons/icon.ico       Windows: solo pi, gambe scure (Esplora risorse chiaro)
//   src-tauri/icons/window/*.png   Windows: icona di finestra/taskbar scambiata a runtime
//   src-tauri/icons/icon.icns      macOS: pi su riquadro arrotondato scuro
//   src-tauri/icons/*.png          Linux e icona di finestra predefinita: riquadro scuro
//   static/favicon.png             favicon della webview
//
// La rasterizzazione passa da `tauri icon` (resvg), gia' dipendenza del
// progetto: niente librerie grafiche in piu'. `.ico` e `.icns` si compongono
// qui perche' `tauri icon` li ricaverebbe scalando un solo sorgente, e sotto i
// 64px il pi va ridisegnato sulla griglia dei pixel, non rimpicciolito.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TAURI_CLI = join(ROOT, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');

// ---------------------------------------------------------------------------
// Disegno
// ---------------------------------------------------------------------------

// Glifo 6t x 5t. Il vuoto ai lati del tetto e fra le gambe e' sempre 1.5t / 1t,
// la gamba sinistra finisce con un quadrato t x t grigio.
const GLYPH = {
	bar: [0, 0, 6, 1],
	left: [1.5, 1, 2.5, 2.5],
	gray: [1.5, 2.5, 2.5, 3.5],
	right: [3.5, 1, 4.5, 5]
};

// "onDark": gambe bianche e bagliore, per taskbar scure e riquadro scuro.
// "onLight": gambe scure e gradiente piu' pieno, senza alone: su fondo chiaro
// l'alone e la sfumatura che scende nelle gambe sporcano invece di illuminare.
const PALETTE = {
	onDark: {
		stem: '#F6F7F9',
		gray: '#A6A9AF',
		grad: [[0, '#5CF6FF'], [0.5, '#8CC6FF'], [1, '#C9A6FF']],
		glow: 0.55
	},
	onLight: {
		stem: '#16181D',
		gray: '#878C96',
		grad: [[0, '#2EDCF5'], [0.5, '#7FA8FF'], [1, '#B98CFF']],
		glow: 0
	}
};

const fmt = (n) => Number(n.toFixed(2)).toString();

function glyphRects(x0, y0, t, hint) {
	const out = {};
	for (const [k, [ax, ay, bx, by]] of Object.entries(GLYPH)) {
		if (hint) {
			// Spessore sempre esattamente multiplo di t: l'arrotondamento sposta il
			// rettangolo, non lo assottiglia.
			const x = Math.floor(x0 + ax * t);
			const y = Math.floor(y0 + ay * t);
			out[k] = [x, y, Math.round((bx - ax) * t), Math.round((by - ay) * t)];
		} else {
			out[k] = [x0 + ax * t, y0 + ay * t, (bx - ax) * t, (by - ay) * t];
		}
	}
	return out;
}

function stops(grad) {
	return grad.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('');
}

/**
 * Il pi a colori. `hint` allinea i bordi ai pixel (dimensioni piccole, niente
 * angoli arrotondati); `blur` e' la deviazione del bagliore in unita' t.
 */
function glyphSvg({ x0, y0, t, variant, hint = false, glow = true, blur = 0.32, id = 'g' }) {
	const p = PALETTE[variant];
	const useGlow = glow && p.glow > 0;
	const g = glyphRects(x0, y0, t, hint);
	const r = hint ? 0 : t * 0.07;
	const [bx, by, bw, bh] = g.bar;
	const parts = [];

	parts.push(
		'<defs>',
		`<linearGradient id="${id}-bar" gradientUnits="userSpaceOnUse" x1="${fmt(bx)}" y1="0" x2="${fmt(bx + bw)}" y2="0">${stops(p.grad)}</linearGradient>`,
		// Il colore del tetto "cola" nelle gambe per ~0.8t, come nel disegno originale.
		`<linearGradient id="${id}-fade" gradientUnits="userSpaceOnUse" x1="0" y1="${fmt(by + bh)}" x2="0" y2="${fmt(by + bh + 0.8 * t)}">`,
		'<stop offset="0" stop-color="#fff" stop-opacity="0.55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>',
		`<mask id="${id}-mask"><rect x="${fmt(x0 - t)}" y="${fmt(y0 - t)}" width="${fmt(8 * t)}" height="${fmt(7 * t)}" fill="url(#${id}-fade)"/></mask>`,
		`<filter id="${id}-blur" x="-30%" y="-150%" width="160%" height="400%"><feGaussianBlur stdDeviation="${fmt(blur * t)}"/></filter>`,
		'</defs>'
	);
	if (useGlow) {
		parts.push(
			`<rect x="${fmt(bx)}" y="${fmt(by)}" width="${fmt(bw)}" height="${fmt(bh)}" rx="${fmt(r)}" fill="url(#${id}-bar)" opacity="${p.glow}" filter="url(#${id}-blur)"/>`
		);
	}
	for (const k of ['left', 'right']) {
		const [x, y, w, h] = g[k];
		// Le gambe salgono sotto il tetto per non lasciare cuciture; la sinistra
		// scende sotto il quadrato grigio, che ha cosi' spigoli vivi in alto.
		const ext = k === 'left' ? r * 2 : 0;
		parts.push(
			`<rect x="${fmt(x)}" y="${fmt(y - t * 0.5)}" width="${fmt(w)}" height="${fmt(h + t * 0.5 + ext)}" rx="${fmt(r)}" fill="${p.stem}"/>`
		);
	}
	{
		const [x, y, w, h] = g.gray;
		parts.push(`<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" rx="${fmt(r)}" fill="${p.gray}"/>`);
		if (r > 0) {
			parts.push(`<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(Math.min(r * 2, h))}" fill="${p.gray}"/>`);
		}
	}
	if (useGlow && !hint) {
		for (const k of ['left', 'right']) {
			const [x, y, w] = g[k];
			parts.push(
				`<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(0.8 * t)}" fill="url(#${id}-bar)" mask="url(#${id}-mask)"/>`
			);
		}
	}
	parts.push(`<rect x="${fmt(bx)}" y="${fmt(by)}" width="${fmt(bw)}" height="${fmt(bh)}" rx="${fmt(r)}" fill="url(#${id}-bar)"/>`);
	return parts.join('');
}

const svg = (w, h, body) =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>\n`;

/**
 * Solo pi su fondo trasparente (Windows, README). Fino a 64px t e' intero e i
 * bordi cadono sui pixel; sotto i 48px niente bagliore, che a quella scala
 * diventa una macchia attorno al tetto.
 */
function piSvg(size, variant) {
	const fill = 0.86;
	if (size <= 64) {
		const t = Math.max(2, Math.floor((size * fill) / 6));
		const x0 = Math.floor((size - 6 * t) / 2);
		const y0 = Math.floor((size - 5 * t + 1) / 2);
		return svg(size, size, glyphSvg({ x0, y0, t, variant, hint: true, glow: size >= 48, blur: 0.25, id: `pi${size}` }));
	}
	const t = (size * fill) / 6;
	return svg(size, size, glyphSvg({ x0: (size - 6 * t) / 2, y0: (size - 5 * t) / 2, t, variant, blur: 0.25, id: 'pi' }));
}

/** Superellisse (n=5): approssima la curvatura continua delle icone Apple. */
function squirclePath(c, half, n = 5, steps = 256) {
	const pts = [];
	for (let i = 0; i < steps; i++) {
		const a = (2 * Math.PI * i) / steps;
		const cs = Math.cos(a);
		const sn = Math.sin(a);
		const x = half * Math.sign(cs) * Math.abs(cs) ** (2 / n);
		const y = half * Math.sign(sn) * Math.abs(sn) ** (2 / n);
		pts.push(`${(c + x).toFixed(2)},${(c + y).toFixed(2)}`);
	}
	return `M${pts.join(' L')} Z`;
}

/**
 * Pi su riquadro arrotondato, griglia Apple (824 su 1024). Toni neutri: grafite
 * o bianco caldo, bordo a filo e un riflesso appena percettibile in alto.
 */
function tileSvg(size, tone) {
	const k = size / 1024;
	const half = 412 * k;
	const c = size / 2;
	const path = squirclePath(c, half);
	const dark = tone === 'dark';
	const bg = dark
		? '<stop offset="0" stop-color="#202228"/><stop offset="1" stop-color="#0E0F12"/>'
		: '<stop offset="0" stop-color="#FBFBFC"/><stop offset="1" stop-color="#E7E8EC"/>';
	const edge = dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)';
	const hi = dark ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.5)';
	const t = (824 * k * 0.6) / 6;
	const id = `tile-${tone}`;
	return svg(
		size,
		size,
		`<defs><linearGradient id="${id}-bg" x1="0" y1="0" x2="0" y2="1">${bg}</linearGradient>` +
			`<filter id="${id}-shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="${fmt(10 * k)}" stdDeviation="${fmt(12 * k)}" flood-opacity="0.28"/></filter>` +
			`<clipPath id="${id}-clip"><path d="${path}"/></clipPath></defs>` +
			`<path d="${path}" fill="url(#${id}-bg)" filter="url(#${id}-shadow)"/>` +
			`<g clip-path="url(#${id}-clip)">` +
			`<ellipse cx="${fmt(c)}" cy="${fmt(c - half * 0.9)}" rx="${fmt(half * 1.1)}" ry="${fmt(half * 0.7)}" fill="${hi}"/>` +
			glyphSvg({ x0: c - 3 * t, y0: c - 2.5 * t, t, variant: dark ? 'onDark' : 'onLight', id }) +
			'</g>' +
			`<path d="${path}" fill="none" stroke="${edge}" stroke-width="${fmt(2 * k)}"/>`
	);
}

/** Monocolore in `currentColor`: lo stesso disegno di src/lib/ui/BrandMark.svelte. */
function monoSvg() {
	const t = 16;
	const g = glyphRects(0, 0, t, false);
	const rect = ([x, y, w, h], extra = '') =>
		`<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" rx="1.1"${extra}/>`;
	const stem = ([x, y, w, h]) => [x, y - t / 2, w, h + t / 2];
	return (
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 80" fill="currentColor">' +
		rect(g.bar) +
		rect(stem(g.left)) +
		rect(stem(g.right)) +
		rect(g.gray, ' opacity="0.45"') +
		'</svg>\n'
	);
}

// ---------------------------------------------------------------------------
// Rasterizzazione e contenitori
// ---------------------------------------------------------------------------

const work = mkdtempSync(join(tmpdir(), 'omp-logo-'));
let seq = 0;

/** SVG -> PNG alla dimensione indicata, con il resvg di `tauri icon`. */
function rasterize(svgText, size) {
	const dir = join(work, String(seq++));
	mkdirSync(dir);
	const src = join(dir, 'in.svg');
	writeFileSync(src, svgText);
	const res = spawnSync(process.execPath, [TAURI_CLI, 'icon', src, '-o', dir, '--png', String(size)], {
		cwd: ROOT,
		encoding: 'utf8'
	});
	if (res.status !== 0) {
		throw new Error(`tauri icon fallito (${size}px):\n${res.stdout}\n${res.stderr}`);
	}
	return readFileSync(join(dir, `${size}x${size}.png`));
}

/** ICO con voci PNG (supportate da Windows Vista in poi, a ogni dimensione). */
function buildIco(entries) {
	const header = Buffer.alloc(6);
	header.writeUInt16LE(0, 0);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(entries.length, 4);
	const dir = Buffer.alloc(16 * entries.length);
	let offset = 6 + dir.length;
	entries.forEach(({ size, png }, i) => {
		const o = i * 16;
		dir.writeUInt8(size >= 256 ? 0 : size, o);
		dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
		dir.writeUInt8(0, o + 2);
		dir.writeUInt8(0, o + 3);
		dir.writeUInt16LE(1, o + 4);
		dir.writeUInt16LE(32, o + 6);
		dir.writeUInt32LE(png.length, o + 8);
		dir.writeUInt32LE(offset, o + 12);
		offset += png.length;
	});
	return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

/** ICNS con voci PNG: un tipo OSType per ogni dimensione e densita'. */
function buildIcns(entries) {
	const chunks = entries.map(({ type, png }) => {
		const head = Buffer.alloc(8);
		head.write(type, 0, 'ascii');
		head.writeUInt32BE(png.length + 8, 4);
		return Buffer.concat([head, png]);
	});
	const body = Buffer.concat(chunks);
	const head = Buffer.alloc(8);
	head.write('icns', 0, 'ascii');
	head.writeUInt32BE(body.length + 8, 4);
	return Buffer.concat([head, body]);
}

const out = (rel, data) => {
	const p = join(ROOT, rel);
	mkdirSync(dirname(p), { recursive: true });
	writeFileSync(p, data);
	console.log(`  ${rel} (${data.length} B)`);
};

// ---------------------------------------------------------------------------
// Uscite
// ---------------------------------------------------------------------------

try {
	console.log('Sorgenti vettoriali');
	out('assets/logo/pi-on-dark.svg', piSvg(1024, 'onDark'));
	out('assets/logo/pi-on-light.svg', piSvg(1024, 'onLight'));
	out('assets/logo/tile-dark.svg', tileSvg(1024, 'dark'));
	out('assets/logo/tile-light.svg', tileSvg(1024, 'light'));
	out('assets/logo/mono.svg', monoSvg());

	console.log('README (96px mostrati, 3x per il DPI)');
	out('assets/logo/readme-pi-on-dark.png', rasterize(piSvg(1024, 'onDark'), 288));
	out('assets/logo/readme-pi-on-light.png', rasterize(piSvg(1024, 'onLight'), 288));

	console.log('Windows');
	const piPng = (size, variant) => rasterize(size <= 64 ? piSvg(size, variant) : piSvg(1024, variant), size);
	out(
		'src-tauri/icons/icon.ico',
		buildIco([16, 20, 24, 32, 40, 48, 64, 256].map((size) => ({ size, png: piPng(size, 'onLight') })))
	);
	// Taskbar: 32px al 100%, 48px al 150%. 64px si riduce a 32 senza sbavature.
	out('src-tauri/icons/window/pi-on-dark.png', piPng(64, 'onDark'));
	out('src-tauri/icons/window/pi-on-light.png', piPng(64, 'onLight'));

	console.log('macOS e Linux');
	const tile = tileSvg(1024, 'dark');
	const tilePng = new Map([16, 32, 64, 128, 256, 512, 1024].map((s) => [s, rasterize(tile, s)]));
	out(
		'src-tauri/icons/icon.icns',
		buildIcns([
			{ type: 'icp4', png: tilePng.get(16) },
			{ type: 'icp5', png: tilePng.get(32) },
			{ type: 'icp6', png: tilePng.get(64) },
			{ type: 'ic07', png: tilePng.get(128) },
			{ type: 'ic08', png: tilePng.get(256) },
			{ type: 'ic09', png: tilePng.get(512) },
			{ type: 'ic10', png: tilePng.get(1024) },
			{ type: 'ic11', png: tilePng.get(32) },
			{ type: 'ic12', png: tilePng.get(64) },
			{ type: 'ic13', png: tilePng.get(256) },
			{ type: 'ic14', png: tilePng.get(512) }
		])
	);
	out('src-tauri/icons/32x32.png', tilePng.get(32));
	out('src-tauri/icons/64x64.png', tilePng.get(64));
	out('src-tauri/icons/128x128.png', tilePng.get(128));
	out('src-tauri/icons/128x128@2x.png', tilePng.get(256));

	console.log('Webview');
	out('static/favicon.png', rasterize(tile, 96));
} finally {
	rmSync(work, { recursive: true, force: true });
}
