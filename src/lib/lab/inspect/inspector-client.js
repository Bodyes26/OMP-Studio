// @ts-nocheck — codice che gira DENTRO l'iframe dell'anteprima, non in Studio.
//
// Ispettore «Indica e disegna» del Laboratorio prototipi (Gate R3X-lab-indica).
//
// Questo file e' un modulo ES autosufficiente, senza import: preview-builder lo
// legge come testo (`?raw`) e lo inserisce nell'HTML dell'anteprima in un
// `<script type="module">` prima di `app.js`, seguito da
// `installLabInspector(window)`. Gli smoke test importano le funzioni pure
// (raggruppamento del riquadro, geometria) direttamente da qui.
//
// Invarianti:
//  1. Tutto passa per `postMessage` con `source: 'lab-preview'` (iframe -> Studio)
//     e `source: 'lab-parent'` (Studio -> iframe), versione LAB_INSPECT_PROTOCOL.
//  2. Overlay (hover, etichetta, marker numerati, rettangolo del riquadro) in uno
//     shadow root CHIUSO appeso a <html>: Tailwind preflight e i CSS del prototipo
//     non lo toccano, e la cattura lo esclude.
//  3. Con una modalita' attiva un «catcher» trasparente riceve tutti i puntatori:
//     il prototipo non vede clic, hover o trascinamenti mentre si indica.
//  4. La cattura rasterizza il DOM in SVG foreignObject -> canvas dentro l'iframe
//     (funziona su WebView2, WKWebView e WebKitGTK): stili calcolati in linea,
//     immagini e font come data URL quando il CORS lo consente, altrimenti
//     segnaposto e avviso. Se fallisce, Studio invia solo il testo.

export const LAB_INSPECT_PROTOCOL = 2;
export const LAB_LOC_ATTR = 'data-lab-loc';

const MEDIA_TAGS = new Set(['img', 'svg', 'video', 'canvas', 'picture', 'iframe']);
const CONTROL_TAGS = new Set(['button', 'a', 'input', 'select', 'textarea', 'label']);

// ---------------------------------------------------------------------------
// Funzioni pure (testate in Node)
// ---------------------------------------------------------------------------

export function rectArea(r) {
	return Math.max(0, r.width) * Math.max(0, r.height);
}

export function intersectRects(a, b) {
	const x = Math.max(a.x, b.x);
	const y = Math.max(a.y, b.y);
	const right = Math.min(a.x + a.width, b.x + b.width);
	const bottom = Math.min(a.y + a.height, b.y + b.height);
	if (right <= x || bottom <= y) return null;
	return { x, y, width: right - x, height: bottom - y };
}

/** L'elemento sta «dentro» l'area se almeno `ratio` della sua superficie cade nell'area. */
export function isMostlyInside(rect, area, ratio = 0.8) {
	const total = rectArea(rect);
	if (total <= 0) return false;
	const inter = intersectRects(rect, area);
	return inter ? rectArea(inter) / total >= ratio : false;
}

export function unionRects(rects) {
	let out = null;
	for (const r of rects) {
		if (!r || r.width <= 0 || r.height <= 0) continue;
		if (!out) {
			out = { x: r.x, y: r.y, width: r.width, height: r.height };
			continue;
		}
		const right = Math.max(out.x + out.width, r.x + r.width);
		const bottom = Math.max(out.y + out.height, r.y + r.height);
		out.x = Math.min(out.x, r.x);
		out.y = Math.min(out.y, r.y);
		out.width = right - out.x;
		out.height = bottom - out.y;
	}
	return out;
}

export function roundRect(r) {
	return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
}

/**
 * Regione della pagina da catturare: l'unione dei rettangoli delle note con un
 * margine, allargata almeno al viewport (centrata sulle note) e limitata al
 * documento. Senza note: il viewport corrente.
 */
export function computeCaptureRegion(rects, viewport, doc, pad = 32) {
	const view = { x: viewport.scrollX, y: viewport.scrollY, width: viewport.width, height: viewport.height };
	const union = unionRects(rects);
	let r = union
		? { x: union.x - pad, y: union.y - pad, width: union.width + pad * 2, height: union.height + pad * 2 }
		: view;
	if (r.width < view.width) {
		r = { ...r, x: r.x - (view.width - r.width) / 2, width: view.width };
	}
	if (r.height < view.height) {
		r = { ...r, y: r.y - (view.height - r.height) / 2, height: view.height };
	}
	const maxW = Math.max(doc.width, view.width);
	const maxH = Math.max(doc.height, view.height);
	r.width = Math.min(r.width, maxW);
	r.height = Math.min(r.height, maxH);
	r.x = Math.min(Math.max(0, r.x), maxW - r.width);
	r.y = Math.min(Math.max(0, r.y), maxH - r.height);
	return roundRect(r);
}

/** Chiave di raggruppamento del riquadro: componente + file:riga del JSX. */
export function areaGroupKey(item) {
	if (item.loc) return (item.component || '') + '|' + item.loc;
	return (item.component || '') + '|~' + item.tag + '|' + (item.anchorLoc || '');
}

/**
 * Raggruppa gli elementi raccolti da un riquadro (in ordine di documento) per
 * componente e file:riga: le istanze di una stessa riga JSX diventano un solo
 * gruppo con il conteggio. Restituisce al massimo `max` gruppi.
 */
export function groupAreaElements(items, max = 12) {
	const byKey = new Map();
	const order = [];
	for (const item of items) {
		const key = areaGroupKey(item);
		let group = byKey.get(key);
		if (!group) {
			group = {
				tag: item.tag,
				loc: item.loc || null,
				locKind: item.locKind || null,
				component: item.component || null,
				selector: item.selector,
				classes: item.classes || '',
				text: item.text || '',
				rect: item.rect,
				instance: { index: 0, count: 1 },
				count: 0
			};
			byKey.set(key, group);
			order.push(group);
		}
		group.count += 1;
		if (!group.text && item.text) group.text = item.text;
	}
	return {
		groups: order.slice(0, max),
		total: items.length,
		omitted: Math.max(0, order.length - max)
	};
}

export function collapseText(s, max = 80) {
	const t = String(s || '').replace(/\s+/g, ' ').trim();
	return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

// ---------------------------------------------------------------------------
// DOM: descrizione degli elementi
// ---------------------------------------------------------------------------

function cssEscape(win, value) {
	try {
		return win.CSS.escape(value);
	} catch (_) {
		return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
	}
}

export function computeSelector(win, el) {
	const doc = win.document;
	if (!el || el === doc.body || el === doc.documentElement) return 'body';
	if (el.id) return '#' + cssEscape(win, el.id);
	const steps = [];
	let cur = el;
	while (cur && cur.nodeType === 1 && cur !== doc.body && cur !== doc.documentElement) {
		let step = cur.localName;
		const parent = cur.parentElement;
		if (parent) {
			const same = Array.prototype.filter.call(parent.children, (s) => s.localName === cur.localName);
			if (same.length > 1) step += ':nth-of-type(' + (same.indexOf(cur) + 1) + ')';
		}
		steps.unshift(step);
		if (parent && parent.id) {
			steps.unshift('#' + cssEscape(win, parent.id));
			break;
		}
		cur = parent;
	}
	return steps.join(' > ');
}

function fiberOf(el) {
	for (const key in el) {
		if (key.startsWith('__reactFiber$')) return el[key];
	}
	return null;
}

function componentName(type) {
	if (!type) return null;
	if (typeof type === 'function') return type.displayName || type.name || null;
	if (typeof type === 'object') {
		return (
			type.displayName ||
			(type.render && (type.render.displayName || type.render.name)) ||
			(type.type && componentName(type.type)) ||
			null
		);
	}
	return null;
}

/** Componente React piu' vicino e, se serve, il punto di chiamata registrato dallo shim jsxDEV. */
function reactInfo(win, el) {
	const out = { component: null, callSite: null, callSiteComponent: null };
	let fiber = fiberOf(el);
	const callSites = win.__labInspect && win.__labInspect.callSites;
	let guard = 0;
	while (fiber && guard++ < 200) {
		if (typeof fiber.type !== 'string') {
			const name = componentName(fiber.type);
			if (name && !out.component) out.component = name;
			if (!out.callSite && callSites && fiber.memoizedProps && typeof fiber.memoizedProps === 'object') {
				const loc = callSites.get(fiber.memoizedProps);
				if (loc) {
					out.callSite = loc;
					out.callSiteComponent = name;
				}
			}
			if (out.component && out.callSite) break;
		}
		fiber = fiber.return;
	}
	return out;
}

function nearestLocAncestor(el) {
	let cur = el.parentElement;
	while (cur) {
		const loc = cur.getAttribute && cur.getAttribute(LAB_LOC_ATTR);
		if (loc) return loc;
		cur = cur.parentElement;
	}
	return null;
}

function classesOf(el) {
	const c = el.getAttribute('class');
	return c ? collapseText(c, 160) : '';
}

function instanceOf(win, el, loc) {
	if (!loc) return { index: 0, count: 1 };
	let list;
	try {
		list = win.document.querySelectorAll('[' + LAB_LOC_ATTR + '="' + loc.replace(/"/g, '\\"') + '"]');
	} catch (_) {
		return { index: 0, count: 1 };
	}
	const index = Array.prototype.indexOf.call(list, el);
	return { index: Math.max(0, index), count: Math.max(1, list.length) };
}

function pageRect(win, el) {
	const r = el.getBoundingClientRect();
	return roundRect({ x: r.left + win.scrollX, y: r.top + win.scrollY, width: r.width, height: r.height });
}

export function describeElement(win, el) {
	const tag = el.localName;
	const own = el.getAttribute(LAB_LOC_ATTR);
	const info = reactInfo(win, el);
	let loc = own || null;
	let locKind = own ? 'jsx' : null;
	if (!loc && info.callSite) {
		loc = info.callSite;
		locKind = 'callsite';
	}
	if (!loc) {
		const anc = nearestLocAncestor(el);
		if (anc) {
			loc = anc;
			locKind = 'ancestor';
		}
	}
	return {
		tag,
		loc,
		locKind,
		component: locKind === 'callsite' ? info.callSiteComponent || info.component : info.component,
		selector: computeSelector(win, el),
		classes: classesOf(el),
		text: collapseText(el.innerText != null ? el.innerText : el.textContent, 80),
		instance: own ? instanceOf(win, el, own) : { index: 0, count: 1 },
		rect: pageRect(win, el)
	};
}

/** L'elemento da indicare sotto il puntatore: dentro un SVG si sale all'<svg> esterno. */
function pickable(el) {
	if (!el || el.nodeType !== 1) return null;
	let cur = el;
	while (cur && cur.ownerSVGElement) cur = cur.ownerSVGElement;
	return cur;
}

function hasOwnText(el) {
	for (const n of el.childNodes) {
		if (n.nodeType === 3 && n.nodeValue && n.nodeValue.trim()) return true;
	}
	return false;
}

function isSignificant(el) {
	if (el.ownerSVGElement) return false;
	const tag = el.localName;
	if (el.hasAttribute(LAB_LOC_ATTR)) return true;
	if (MEDIA_TAGS.has(tag) || CONTROL_TAGS.has(tag)) return true;
	return hasOwnText(el);
}

// ---------------------------------------------------------------------------
// Rasterizzazione DOM -> PNG (SVG foreignObject -> canvas)
// ---------------------------------------------------------------------------

const INHERITED_PROPS = new Set([
	'border-collapse', 'border-spacing', 'caption-side', 'color', 'cursor', 'direction', 'empty-cells',
	'font', 'font-family', 'font-feature-settings', 'font-kerning', 'font-size', 'font-size-adjust',
	'font-stretch', 'font-style', 'font-variant', 'font-variant-caps', 'font-variant-ligatures',
	'font-variant-numeric', 'font-variation-settings', 'font-weight', 'font-optical-sizing',
	'font-synthesis', 'hyphens', 'letter-spacing', 'line-break', 'line-height', 'list-style',
	'list-style-image', 'list-style-position', 'list-style-type', 'orphans', 'overflow-wrap',
	'paint-order', 'quotes', 'tab-size', 'text-align', 'text-align-last', 'text-indent',
	'text-justify', 'text-rendering', 'text-shadow', 'text-transform', 'text-underline-position',
	'text-wrap', 'visibility', 'white-space', 'white-space-collapse', 'widows', 'word-break',
	'word-spacing', 'word-wrap', 'writing-mode', '-webkit-text-fill-color', '-webkit-text-stroke-color',
	'-webkit-text-stroke-width', '-webkit-font-smoothing', 'fill', 'fill-opacity', 'fill-rule',
	'stroke', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin',
	'stroke-miterlimit', 'stroke-opacity', 'stroke-width', 'clip-rule', 'color-interpolation',
	'shape-rendering', 'text-anchor', 'dominant-baseline', 'color-scheme', 'accent-color', 'caret-color'
]);

// Valori calcolati che dipendono da un'altra proprieta': con `border-style: solid`
// e larghezza 0 (preflight di Tailwind) la larghezza calcolata e' uguale al
// default, ma nel clone tornerebbe `medium`. Si scrivono sempre.
const ALWAYS_PROPS = new Set([
	'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
	'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
	'outline-width', 'outline-style', 'column-rule-width', 'column-rule-style'
]);

const DROP_TAGS = new Set(['script', 'noscript', 'template', 'style', 'link', 'meta', 'title', 'base', 'head']);
const SVG_NS = 'http://www.w3.org/2000/svg';

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

function withTimeout(promise, ms, message) {
	return Promise.race([
		promise,
		new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))
	]);
}

function blobToDataUrl(win, blob) {
	return new Promise((resolve, reject) => {
		const reader = new win.FileReader();
		reader.onload = () => resolve(reader.result);
		reader.onerror = () => reject(reader.error || new Error('lettura non riuscita'));
		reader.readAsDataURL(blob);
	});
}

/**
 * Immagine -> data URL passando da un canvas. L'iframe ha origine opaca, quindi
 * ogni immagine http(s) e' «cross-origin»: si ricarica con crossOrigin=anonymous
 * e funziona solo se il server risponde con CORS (il server Lab lo fa, molti CDN
 * di immagini anche). Altrimenti il canvas si «sporca» e si rifiuta.
 */
function imageToDataUrl(win, url, cache) {
	if (url.startsWith('data:')) return Promise.resolve(url);
	if (cache.has(url)) return cache.get(url);
	const job = withTimeout(
		new Promise((resolve, reject) => {
			const img = new win.Image();
			img.crossOrigin = 'anonymous';
			img.decoding = 'async';
			img.onload = () => {
				try {
					let w = img.naturalWidth || 300;
					let h = img.naturalHeight || 150;
					const k = Math.min(1, 2048 / Math.max(w, h));
					w = Math.max(1, Math.round(w * k));
					h = Math.max(1, Math.round(h * k));
					const c = win.document.createElement('canvas');
					c.width = w;
					c.height = h;
					c.getContext('2d').drawImage(img, 0, 0, w, h);
					resolve(c.toDataURL('image/png'));
				} catch (err) {
					reject(err);
				}
			};
			img.onerror = () => reject(new Error('immagine non caricabile con CORS'));
			img.src = url;
		}),
		5000,
		'immagine: tempo scaduto'
	);
	cache.set(url, job);
	return job;
}

function extractCssUrls(value) {
	const out = [];
	const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
	let m;
	while ((m = re.exec(value))) out.push(m[2]);
	return out;
}

function unquoteFamily(f) {
	return String(f || '').trim().replace(/^['"]|['"]$/g, '');
}

async function collectFontCss(win, usedFamilies, warnings) {
	const doc = win.document;
	const parts = [];
	let budget = 6 * 1024 * 1024;
	for (const sheet of Array.from(doc.styleSheets)) {
		let rules;
		try {
			rules = sheet.cssRules;
		} catch (_) {
			// Foglio di un'altra origine senza CORS (es. Google Fonts): font sostituiti.
			if (usedFamilies.size > 0) warnings.add('fonts');
			continue;
		}
		const queue = Array.from(rules || []);
		while (queue.length) {
			const rule = queue.shift();
			if (rule.cssRules && rule.type !== 5) {
				queue.push(...Array.from(rule.cssRules));
				continue;
			}
			if (rule.type !== 5) continue; // CSSFontFaceRule
			const family = unquoteFamily(rule.style.getPropertyValue('font-family'));
			if (!usedFamilies.has(family.toLowerCase())) continue;
			let cssText = rule.cssText;
			const urls = extractCssUrls(cssText).filter((u) => !u.startsWith('data:'));
			let ok = true;
			for (const u of urls) {
				try {
					const abs = new win.URL(u, sheet.href || doc.baseURI).href;
					const res = await withTimeout(win.fetch(abs), 5000, 'font: tempo scaduto');
					if (!res.ok) throw new Error('HTTP ' + res.status);
					const blob = await res.blob();
					budget -= blob.size;
					if (budget < 0) throw new Error('troppi font');
					const data = await blobToDataUrl(win, blob);
					cssText = cssText.split(u).join(data);
				} catch (_) {
					ok = false;
					break;
				}
			}
			if (ok) parts.push(cssText);
			else warnings.add('fonts');
		}
	}
	return parts.join('\n');
}

function makeStyleWriter(win) {
	const doc = win.document;
	const host = doc.createElement('div');
	host.setAttribute('data-lab-skip', '');
	host.style.cssText =
		'position:absolute!important;left:-99999px!important;top:0!important;width:0!important;height:0!important;overflow:hidden!important;visibility:hidden!important;pointer-events:none!important;';
	const root = host.attachShadow({ mode: 'open' });
	const svgBox = doc.createElementNS(SVG_NS, 'svg');
	root.appendChild(svgBox);
	(doc.body || doc.documentElement).appendChild(host);
	const cache = new Map();

	function baseline(el) {
		const isSvg = el.namespaceURI === SVG_NS && el.localName !== 'svg';
		const key = (isSvg ? 'svg:' : '') + el.localName;
		let cs = cache.get(key);
		if (!cs) {
			const probe = isSvg ? doc.createElementNS(SVG_NS, el.localName) : doc.createElement(el.localName);
			(isSvg ? svgBox : root).appendChild(probe);
			// Copia statica: il CSSStyleDeclaration calcolato e' vivo.
			const live = win.getComputedStyle(probe);
			const snap = new Map();
			for (let i = 0; i < live.length; i++) snap.set(live[i], live.getPropertyValue(live[i]));
			cs = snap;
			cache.set(key, cs);
		}
		return cs;
	}

	function write(el, cs, parentCs, parentEl) {
		const base = baseline(el);
		const parentBase = parentEl ? baseline(parentEl) : null;
		let out = '';
		for (let i = 0; i < cs.length; i++) {
			const name = cs[i];
			if (name.startsWith('--')) continue;
			const value = cs.getPropertyValue(name);
			if (value === '') continue;
			if (INHERITED_PROPS.has(name)) {
				// Ereditata e uguale al genitore: si omette, salvo che il foglio UA
				// la imposti diversa sul tag (font dei <button>, colore dei link).
				if (
					parentCs &&
					parentCs.getPropertyValue(name) === value &&
					(!parentBase || parentBase.get(name) === base.get(name))
				) {
					continue;
				}
			} else if (!ALWAYS_PROPS.has(name) && base.get(name) === value) {
				continue;
			}
			out += name + ':' + value + ';';
		}
		return out;
	}

	function writeAll(cs) {
		let out = '';
		for (let i = 0; i < cs.length; i++) {
			const name = cs[i];
			if (name.startsWith('--')) continue;
			const value = cs.getPropertyValue(name);
			if (value !== '') out += name + ':' + value + ';';
		}
		return out;
	}

	return {
		write,
		writeAll,
		dispose() {
			host.remove();
		}
	};
}

function pageBackground(win) {
	const doc = win.document;
	const transparent = (c) => !c || c === 'transparent' || /rgba\(.*,\s*0\)$/.test(c);
	const h = win.getComputedStyle(doc.documentElement).backgroundColor;
	if (!transparent(h)) return h;
	const b = doc.body ? win.getComputedStyle(doc.body).backgroundColor : '';
	return transparent(b) ? '#ffffff' : b;
}

/**
 * Rasterizza la regione `region` (coordinate pagina, px CSS) del documento in
 * un PNG con lato lungo <= opts.maxSide. `opts.skip(node)` esclude nodi (overlay).
 * Restituisce { dataUrl, width, height, scale, region, warnings[] }.
 */
export async function rasterizeRegion(win, region, opts) {
	const doc = win.document;
	const skip = opts.skip || (() => false);
	const warnings = new Set();
	const writer = makeStyleWriter(win);
	const imageCache = new Map();
	const jobs = [];
	const pseudoRules = [];
	const usedFamilies = new Set();
	let pseudoSeq = 0;

	function clone(src, parentCs, parentEl) {
		if (src.nodeType === 3) return doc.createTextNode(src.nodeValue);
		if (src.nodeType !== 1) return null;
		const tag = src.localName;
		if (DROP_TAGS.has(tag) || skip(src) || src.hasAttribute('data-lab-skip')) return null;
		const cs = win.getComputedStyle(src);
		if (cs.display === 'none') return null;

		let out;
		if (tag === 'canvas') {
			out = doc.createElement('img');
			try {
				out.setAttribute('src', src.toDataURL('image/png'));
			} catch (_) {
				warnings.add('canvas');
			}
		} else if (tag === 'iframe' || tag === 'video' || tag === 'object' || tag === 'embed' || tag === 'audio') {
			out = doc.createElement('div');
			if (tag === 'video' && src.poster) {
				const poster = src.poster;
				jobs.push(
					imageToDataUrl(win, poster, imageCache).then(
						(d) => out.style.setProperty('background', 'center / cover no-repeat url("' + d + '")'),
						() => warnings.add('images')
					)
				);
			} else {
				warnings.add('media');
			}
		} else {
			out = src.cloneNode(false);
			out.removeAttribute('srcset');
			out.removeAttribute('id');
			if (out.removeAttribute) out.removeAttribute('loading');
		}

		let style = writer.write(src, cs, parentCs, parentEl);
		if (cs.position === 'fixed') {
			// Nel foreignObject «fixed» si ancorerebbe all'inizio della pagina:
			// si congela dove l'utente lo vede adesso.
			const r = src.getBoundingClientRect();
			style +=
				'position:absolute;top:' + (r.top + win.scrollY) + 'px;left:' + (r.left + win.scrollX) +
				'px;right:auto;bottom:auto;';
		}
		if (tag === 'canvas' || tag === 'iframe' || tag === 'video' || tag === 'object' || tag === 'embed') {
			const r = src.getBoundingClientRect();
			style += 'display:inline-block;width:' + r.width + 'px;height:' + r.height + 'px;';
			if (tag !== 'canvas') style += 'background-color:#e5e7eb;';
		}
		out.setAttribute('style', style);

		if (hasOwnText(src)) usedFamilies.add(unquoteFamily(cs.fontFamily.split(',')[0]).toLowerCase());

		for (const pseudo of ['::before', '::after']) {
			const pcs = win.getComputedStyle(src, pseudo);
			const content = pcs.getPropertyValue('content');
			if (content && content !== 'none' && content !== 'normal') {
				const cls = '__labp' + ++pseudoSeq;
				out.setAttribute('class', ((out.getAttribute('class') || '') + ' ' + cls).trim());
				pseudoRules.push('.' + cls + pseudo + '{' + writer.writeAll(pcs) + '}');
			}
		}

		if (tag === 'input') {
			const type = (src.getAttribute('type') || '').toLowerCase();
			if (type === 'checkbox' || type === 'radio') {
				if (src.checked) out.setAttribute('checked', '');
				else out.removeAttribute('checked');
			} else if (type !== 'file') {
				out.setAttribute('value', src.value);
			}
		} else if (tag === 'select') {
			// le opzioni vengono clonate sotto: si marca la scelta corrente
		} else if (tag === 'option') {
			if (src.selected) out.setAttribute('selected', '');
			else out.removeAttribute('selected');
		} else if (tag === 'img') {
			const url = src.currentSrc || src.src;
			if (url) {
				jobs.push(
					imageToDataUrl(win, url, imageCache).then(
						(d) => out.setAttribute('src', d),
						() => {
							// Pixel trasparente: niente icona di immagine rotta, solo il segnaposto grigio.
							out.setAttribute('src', 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
							out.style.setProperty('background-color', '#e5e7eb');
							warnings.add('images');
						}
					)
				);
			}
		}

		const bg = cs.backgroundImage;
		if (bg && bg !== 'none' && bg.includes('url(')) {
			const urls = extractCssUrls(bg);
			jobs.push(
				Promise.all(urls.map((u) => imageToDataUrl(win, u, imageCache))).then(
					(datas) => {
						let next = bg;
						urls.forEach((u, i) => {
							next = next.split(u).join(datas[i]);
						});
						out.style.setProperty('background-image', next);
					},
					() => {
						out.style.setProperty('background-image', 'none');
						warnings.add('images');
					}
				)
			);
		}

		if (tag === 'textarea') {
			out.textContent = src.value;
			return out;
		}

		for (const child of src.childNodes) {
			const c = clone(child, cs, src);
			if (c) out.appendChild(c);
		}

		// Contenitori scorrevoli: il clone non ha scrollTop, si spostano i figli.
		if ((src.scrollTop || src.scrollLeft) && src !== doc.documentElement && src !== doc.body) {
			for (const child of out.children) {
				child.style.setProperty('translate', -src.scrollLeft + 'px ' + -src.scrollTop + 'px');
			}
		}
		return out;
	}

	try {
		const root = clone(doc.documentElement, null, null);
		if (!root) throw new Error('documento vuoto');
		await Promise.all(jobs);
		const fontCss = await collectFontCss(win, usedFamilies, warnings);
		const styleEl = doc.createElement('style');
		styleEl.textContent = fontCss + '\n' + pseudoRules.join('\n');
		root.insertBefore(styleEl, root.firstChild);

		const de = doc.documentElement;
		const docW = Math.max(de.scrollWidth, doc.body ? doc.body.scrollWidth : 0, win.innerWidth);
		const docH = Math.max(de.scrollHeight, doc.body ? doc.body.scrollHeight : 0, win.innerHeight);
		root.style.setProperty('width', docW + 'px');
		root.style.setProperty('min-height', docH + 'px');
		root.style.setProperty('margin', '0');

		const xhtml = new win.XMLSerializer().serializeToString(root);
		const svg =
			'<svg xmlns="http://www.w3.org/2000/svg" width="' + region.width + '" height="' + region.height +
			'" viewBox="' + region.x + ' ' + region.y + ' ' + region.width + ' ' + region.height + '">' +
			'<foreignObject x="0" y="0" width="' + docW + '" height="' + docH + '">' + xhtml +
			'</foreignObject></svg>';

		const img = new win.Image();
		img.decoding = 'sync';
		const loaded = new Promise((resolve, reject) => {
			img.onload = () => resolve();
			img.onerror = () => reject(new Error('SVG del fotogramma non valido'));
		});
		img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
		await withTimeout(loaded, 8000, 'fotogramma: tempo scaduto');

		const dpr = Math.min(2, win.devicePixelRatio || 1);
		const scale = Math.min(dpr, opts.maxSide / Math.max(region.width, region.height));
		const cw = Math.max(1, Math.round(region.width * scale));
		const ch = Math.max(1, Math.round(region.height * scale));
		const canvas = doc.createElement('canvas');
		canvas.width = cw;
		canvas.height = ch;
		const ctx = canvas.getContext('2d');
		const paint = () => {
			ctx.fillStyle = pageBackground(win);
			ctx.fillRect(0, 0, cw, ch);
			ctx.drawImage(img, 0, 0, cw, ch);
		};
		paint();
		// WebKit decodifica le immagini interne al foreignObject in ritardo:
		// un secondo passaggio le include.
		const ua = win.navigator.userAgent || '';
		if (/AppleWebKit/.test(ua) && !/Chrome|Edg\//.test(ua)) {
			await sleep(120);
			paint();
		}
		const dataUrl = canvas.toDataURL('image/png');
		return { dataUrl, width: cw, height: ch, scale, region, warnings: Array.from(warnings) };
	} finally {
		writer.dispose();
	}
}

// ---------------------------------------------------------------------------
// Ispettore: modalita', overlay, protocollo
// ---------------------------------------------------------------------------

const OVERLAY_CSS = `
:host { all: initial; }
.catcher { position: fixed; inset: 0; pointer-events: none; cursor: crosshair; }
.catcher.on { pointer-events: auto; }
.layer { position: fixed; inset: 0; pointer-events: none; }
.hover { position: fixed; border: 1.5px solid #e2477f; background: rgba(226,71,127,.10); border-radius: 3px; display: none; box-sizing: border-box; }
.inst { position: fixed; border: 1px dashed rgba(226,71,127,.7); border-radius: 3px; box-sizing: border-box; }
.label { position: fixed; display: none; background: #18181b; color: #fafafa; font: 11px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; padding: 3px 6px; border-radius: 4px; white-space: nowrap; box-shadow: 0 2px 8px rgba(0,0,0,.35); max-width: 70vw; overflow: hidden; text-overflow: ellipsis; }
.label .c { color: #f5a3c4; } .label .f { color: #a1a1aa; }
.mark { position: fixed; border: 2px solid #e2477f; border-radius: 4px; box-sizing: border-box; }
.mark.area { border-style: dashed; background: rgba(226,71,127,.07); }
.mark.stale { border-color: #d97706; }
.mark.active { box-shadow: 0 0 0 3px rgba(226,71,127,.3); }
.num { position: fixed; min-width: 20px; height: 20px; padding: 0 5px; box-sizing: border-box; border-radius: 10px; background: #e2477f; color: #fff; font: 700 11px/20px system-ui, -apple-system, "Segoe UI", sans-serif; text-align: center; box-shadow: 0 1px 4px rgba(0,0,0,.35); pointer-events: auto; cursor: pointer; }
.num.stale { background: #d97706; }
.rubber { position: fixed; border: 1.5px dashed #e2477f; background: rgba(226,71,127,.08); display: none; box-sizing: border-box; }
`;

export function installLabInspector(win) {
	if (win.__labInspector) return win.__labInspector;
	const doc = win.document;
	const post = (msg) => {
		try {
			win.parent.postMessage(Object.assign({ source: 'lab-preview', v: LAB_INSPECT_PROTOCOL }, msg), '*');
		} catch (_) {}
	};

	let mode = 'off';
	let activeId = null;
	let pickSeq = 0;
	/** pickId -> elemento indicato in questo documento (per agganciare la nota appena creata). */
	const picked = new Map();
	const newPickId = () => 'p' + Date.now().toString(36) + '-' + ++pickSeq;
	/** id -> { n, kind, els: Element[], area?: rect pagina, stale } */
	const notes = new Map();

	const host = doc.createElement('lab-inspector');
	host.setAttribute('data-lab-skip', '');
	host.style.cssText =
		'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;display:block!important;';
	const shadow = host.attachShadow({ mode: 'closed' });
	shadow.innerHTML =
		'<style>' + OVERLAY_CSS + '</style><div class="catcher"></div><div class="layer">' +
		'<div class="marks"></div><div class="insts"></div><div class="hover"></div>' +
		'<div class="label"></div><div class="rubber"></div></div>';
	const catcher = shadow.querySelector('.catcher');
	const marksEl = shadow.querySelector('.marks');
	const instsEl = shadow.querySelector('.insts');
	const hoverEl = shadow.querySelector('.hover');
	const labelEl = shadow.querySelector('.label');
	const rubberEl = shadow.querySelector('.rubber');

	function mount() {
		if (!host.isConnected && doc.documentElement) doc.documentElement.appendChild(host);
	}
	mount();
	doc.addEventListener('DOMContentLoaded', mount);

	function elementAt(x, y) {
		const list = doc.elementsFromPoint(x, y);
		for (const el of list) {
			if (el === host || el === doc.documentElement) continue;
			return pickable(el);
		}
		return null;
	}

	function place(el, r) {
		el.style.left = r.x + 'px';
		el.style.top = r.y + 'px';
		el.style.width = r.width + 'px';
		el.style.height = r.height + 'px';
	}

	function clientRect(el) {
		const r = el.getBoundingClientRect();
		return { x: r.left, y: r.top, width: r.width, height: r.height };
	}

	function toClient(r) {
		return { x: r.x - win.scrollX, y: r.y - win.scrollY, width: r.width, height: r.height };
	}

	function escapeHtml(s) {
		return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
	}

	function shortLoc(loc) {
		if (!loc) return '';
		const parts = loc.split(':');
		const file = parts[0].split('/').pop();
		return file + ':' + (parts[1] || '');
	}

	// --- hover -------------------------------------------------------------
	let hoverTarget = null;
	let hoverFrame = 0;
	let lastPoint = null;

	function clearHover() {
		hoverTarget = null;
		hoverEl.style.display = 'none';
		labelEl.style.display = 'none';
		instsEl.textContent = '';
	}

	function renderHover() {
		hoverFrame = 0;
		if (mode !== 'point' || !lastPoint) return clearHover();
		const el = elementAt(lastPoint.x, lastPoint.y);
		if (!el || el === doc.body) return clearHover();
		const r = clientRect(el);
		hoverEl.style.display = 'block';
		place(hoverEl, r);
		if (el !== hoverTarget) {
			hoverTarget = el;
			const d = describeElement(win, el);
			labelEl.innerHTML =
				(d.component ? '<span class="c">' + escapeHtml(d.component) + '</span> · ' : '') +
				escapeHtml(d.tag) +
				(d.loc ? ' <span class="f">' + escapeHtml(shortLoc(d.loc)) + '</span>' : '') +
				(d.instance.count > 1 ? ' <span class="f">×' + d.instance.count + '</span>' : '');
			instsEl.textContent = '';
			const own = el.getAttribute(LAB_LOC_ATTR);
			if (own && d.instance.count > 1) {
				const list = doc.querySelectorAll('[' + LAB_LOC_ATTR + '="' + own.replace(/"/g, '\\"') + '"]');
				let shown = 0;
				for (const other of list) {
					if (other === el || shown++ > 24) continue;
					const box = doc.createElement('div');
					box.className = 'inst';
					place(box, clientRect(other));
					instsEl.appendChild(box);
				}
			}
		}
		labelEl.style.display = 'block';
		const ly = r.y > 24 ? r.y - 22 : r.y + r.height + 4;
		labelEl.style.left = Math.max(2, Math.min(r.x, win.innerWidth - 120)) + 'px';
		labelEl.style.top = ly + 'px';
	}

	// --- marker ------------------------------------------------------------
	let markFrame = 0;
	function scheduleMarks() {
		if (!markFrame) markFrame = win.requestAnimationFrame(renderMarks);
	}

	function noteRects(note) {
		if (note.kind === 'area') return note.area ? [note.area] : [];
		return note.els.filter((e) => e && e.isConnected).map((e) => pageRect(win, e));
	}

	function renderMarks() {
		markFrame = 0;
		marksEl.textContent = '';
		for (const [id, note] of notes) {
			const rects = noteRects(note);
			rects.forEach((pr, i) => {
				const r = toClient(pr);
				const box = doc.createElement('div');
				box.className =
					'mark' + (note.kind === 'area' ? ' area' : '') + (note.stale ? ' stale' : '') +
					(id === activeId ? ' active' : '');
				place(box, r);
				marksEl.appendChild(box);
				if (i === 0) {
					const num = doc.createElement('div');
					num.className = 'num' + (note.stale ? ' stale' : '');
					num.textContent = String(note.n);
					num.style.left = Math.max(2, r.x - 8) + 'px';
					num.style.top = Math.max(2, r.y - 10) + 'px';
					num.addEventListener('click', (e) => {
						e.preventDefault();
						e.stopPropagation();
						post({ type: 'inspect_marker_click', id, client: roundRect(r) });
					});
					marksEl.appendChild(num);
				}
			});
		}
	}

	win.addEventListener('scroll', () => {
		scheduleMarks();
		if (hoverTarget && !hoverFrame) hoverFrame = win.requestAnimationFrame(renderHover);
	}, true);
	win.addEventListener('resize', scheduleMarks);
	setInterval(() => {
		if (notes.size > 0) scheduleMarks();
	}, 700);

	// --- modalita' e puntatore ----------------------------------------------
	function setMode(next) {
		mode = next === 'point' || next === 'area' ? next : 'off';
		catcher.classList.toggle('on', mode !== 'off');
		if (mode !== 'point') clearHover();
		rubberEl.style.display = 'none';
		drag = null;
	}

	let drag = null;

	catcher.addEventListener('pointermove', (e) => {
		lastPoint = { x: e.clientX, y: e.clientY };
		if (mode === 'point') {
			if (!hoverFrame) hoverFrame = win.requestAnimationFrame(renderHover);
		} else if (mode === 'area' && drag) {
			drag.x1 = e.clientX;
			drag.y1 = e.clientY;
			const r = {
				x: Math.min(drag.x0, drag.x1),
				y: Math.min(drag.y0, drag.y1),
				width: Math.abs(drag.x1 - drag.x0),
				height: Math.abs(drag.y1 - drag.y0)
			};
			rubberEl.style.display = 'block';
			place(rubberEl, r);
		}
	});
	catcher.addEventListener('pointerleave', () => {
		lastPoint = null;
		clearHover();
	});
	catcher.addEventListener('pointerdown', (e) => {
		e.preventDefault();
		if (mode === 'area') {
			drag = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY };
			try {
				catcher.setPointerCapture(e.pointerId);
			} catch (_) {}
		}
	});
	catcher.addEventListener('pointerup', (e) => {
		if (mode === 'area' && drag) {
			const r = {
				x: Math.min(drag.x0, drag.x1),
				y: Math.min(drag.y0, drag.y1),
				width: Math.abs(drag.x1 - drag.x0),
				height: Math.abs(drag.y1 - drag.y0)
			};
			drag = null;
			rubberEl.style.display = 'none';
			if (r.width < 6 || r.height < 6) {
				pickAt(e.clientX, e.clientY, e.shiftKey);
				return;
			}
			const area = roundRect({ x: r.x + win.scrollX, y: r.y + win.scrollY, width: r.width, height: r.height });
			const result = collectArea(area);
			const areaPickId = newPickId();
			picked.set(areaPickId, null);
			post({ type: 'inspect_area', pickId: areaPickId, rect: area, client: roundRect(r), groups: result.groups, total: result.total, omitted: result.omitted, viewport: viewportInfo() });
		}
	});
	catcher.addEventListener('click', (e) => {
		e.preventDefault();
		e.stopPropagation();
		if (mode === 'point') pickAt(e.clientX, e.clientY, e.shiftKey);
	});
	catcher.addEventListener('contextmenu', (e) => e.preventDefault());

	function pickAt(x, y, additive) {
		const el = elementAt(x, y);
		if (!el || el === doc.body) return;
		for (const [id, note] of notes) {
			if (note.kind === 'point' && note.els.includes(el)) {
				post({ type: 'inspect_marker_click', id, client: roundRect(clientRect(el)) });
				return;
			}
		}
		const target = describeElement(win, el);
		target.pickId = newPickId();
		picked.set(target.pickId, el);
		post({
			type: 'inspect_pick',
			additive: !!additive,
			target,
			client: roundRect(clientRect(el)),
			viewport: viewportInfo()
		});
	}

	function viewportInfo() {
		return { width: win.innerWidth, height: win.innerHeight, dpr: win.devicePixelRatio || 1 };
	}

	function collectArea(area) {
		const areaClient = toClient(area);
		const items = [];
		const all = doc.body ? doc.body.querySelectorAll('*') : [];
		for (const el of all) {
			if (el === host || el.hasAttribute('data-lab-skip')) continue;
			if (!isSignificant(el)) continue;
			const r = clientRect(el);
			if (r.width < 2 || r.height < 2) continue;
			if (!isMostlyInside(r, areaClient)) continue;
			const cs = win.getComputedStyle(el);
			if (cs.visibility === 'hidden' || cs.opacity === '0') continue;
			const d = describeElement(win, el);
			d.anchorLoc = d.locKind === 'jsx' ? null : d.loc;
			items.push(d);
		}
		return groupAreaElements(items, 12);
	}

	// --- riaggancio dopo la ricompilazione ---------------------------------
	function resolveTarget(t) {
		if (t.loc && t.locKind === 'jsx') {
			let list = [];
			try {
				list = Array.from(doc.querySelectorAll('[' + LAB_LOC_ATTR + '="' + t.loc.replace(/"/g, '\\"') + '"]'));
			} catch (_) {}
			if (list.length) {
				let bySel = null;
				try {
					bySel = t.selector ? doc.querySelector(t.selector) : null;
				} catch (_) {}
				if (bySel && list.includes(bySel)) return bySel;
				const idx = t.instance ? t.instance.index : 0;
				return list[Math.min(idx, list.length - 1)];
			}
		}
		try {
			const el = t.selector ? doc.querySelector(t.selector) : null;
			if (el && el.localName === t.tag) return el;
		} catch (_) {}
		return null;
	}

	function sync(list) {
		const keep = new Set();
		const changed = [];
		for (const item of list) {
			keep.add(item.id);
			const existing = notes.get(item.id);
			if (existing) {
				existing.n = item.n;
				if (item.kind === 'point') {
					// Maiusc+clic: elementi aggiunti a una nota gia' tracciata
					for (const t of item.targets) {
						const el = t.pickId ? picked.get(t.pickId) : null;
						if (el && !existing.els.includes(el)) existing.els.push(el);
					}
				}
				continue;
			}
			if (item.kind === 'area') {
				const area = item.rect;
				if (item.pickId && picked.has(item.pickId)) {
					notes.set(item.id, { n: item.n, kind: 'area', els: [], area, stale: false });
					continue;
				}
				const fresh = area ? collectArea(area) : { groups: [], total: 0, omitted: 0 };
				const stale = fresh.total === 0;
				notes.set(item.id, { n: item.n, kind: 'area', els: [], area, stale });
				changed.push({ id: item.id, stale, groups: fresh.groups, total: fresh.total, omitted: fresh.omitted });
				continue;
			}
			const els = [];
			const targets = [];
			let resolved = false;
			for (const t of item.targets) {
				const pickedEl = t.pickId ? picked.get(t.pickId) : null;
				const el = pickedEl || resolveTarget(t);
				if (!pickedEl) resolved = true;
				if (el) {
					els.push(el);
					targets.push(pickedEl ? t : Object.assign(describeElement(win, el), { pickId: t.pickId }));
				} else {
					targets.push(Object.assign({}, t, { missing: true }));
				}
			}
			const stale = els.length === 0;
			notes.set(item.id, { n: item.n, kind: 'point', els, stale });
			if (resolved) changed.push({ id: item.id, stale, targets });
		}
		for (const id of Array.from(notes.keys())) if (!keep.has(id)) notes.delete(id);
		scheduleMarks();
		if (changed.length) post({ type: 'inspect_synced', notes: changed });
	}

	// --- cattura -----------------------------------------------------------
	async function capture(reqId, maxSide) {
		const rects = {};
		const all = [];
		for (const [id, note] of notes) {
			if (note.stale) continue;
			const rs = noteRects(note);
			rects[id] = rs;
			all.push(...rs);
		}
		const de = doc.documentElement;
		const region = computeCaptureRegion(
			all,
			{ scrollX: win.scrollX, scrollY: win.scrollY, width: win.innerWidth, height: win.innerHeight },
			{ width: Math.max(de.scrollWidth, win.innerWidth), height: Math.max(de.scrollHeight, win.innerHeight) }
		);
		try {
			const shot = await rasterizeRegion(win, region, { maxSide: maxSide || 1568, skip: (n) => n === host });
			post({ type: 'inspect_captured', reqId, ok: true, dataUrl: shot.dataUrl, width: shot.width, height: shot.height, scale: shot.scale, region, rects, warnings: shot.warnings });
		} catch (err) {
			post({ type: 'inspect_captured', reqId, ok: false, error: String((err && err.message) || err), region, rects, warnings: [] });
		}
	}

	// --- tastiera ----------------------------------------------------------
	win.addEventListener('keydown', (e) => {
		// Alt+I (Ctrl+Opzione+I su macOS): Studio decide se e' una scorciatoia.
		if (e.altKey && !e.metaKey && e.code === 'KeyI') {
			e.preventDefault();
			e.stopPropagation();
			post({ type: 'inspect_key', key: 'toggle' });
		} else if (e.key === 'Escape' && mode !== 'off') {
			e.preventDefault();
			e.stopPropagation();
			post({ type: 'inspect_key', key: 'escape' });
		}
	}, true);

	// --- messaggi da Studio --------------------------------------------------
	win.addEventListener('message', (e) => {
		const data = e.data;
		if (!data || data.source !== 'lab-parent' || e.source !== win.parent) return;
		switch (data.type) {
			case 'inspect_mode':
				setMode(data.mode);
				break;
			case 'toggle_select_mode': // compatibilita' col vecchio bridge
				setMode(data.enabled ? 'point' : 'off');
				break;
			case 'inspect_sync':
				activeId = data.activeId || null;
				sync(Array.isArray(data.notes) ? data.notes : []);
				break;
			case 'inspect_capture':
				void capture(data.reqId, data.maxSide);
				break;
		}
	});

	const api = { setMode, sync, capture, describe: (el) => describeElement(win, el) };
	win.__labInspector = api;
	post({ type: 'inspect_ready', version: LAB_INSPECT_PROTOCOL, features: ['point', 'area', 'capture'], viewport: viewportInfo() });
	return api;
}
