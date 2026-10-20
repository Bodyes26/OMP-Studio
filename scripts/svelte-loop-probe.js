// Sonda sul ciclo di effetti di Svelte (`effect_update_depth_exceeded`).
//
// In produzione Svelte non dice quale effetto gira in tondo: lo stack contiene
// solo il suo scheduler. Questo plugin modifica `batch.js` del runtime perche',
// negli ultimi giri prima del limite di 1000, si annoti gli effetti che
// vengono rischedulati; all'errore ne allega il sorgente (`error.studioLoop`).
// Il sorgente minificato conserva i nomi delle proprieta' degli store e delle
// funzioni chiamate: basta per ritrovare l'effetto nel codice.
// Fuori dal ciclo il costo e' un confronto su un intero per ogni schedule.

const TARGET = /svelte[\\/]src[\\/]internal[\\/]client[\\/]reactivity[\\/]batch\.js$/;

const HELPERS = `
const __studioLoopRecent = [];
function __studioLoopNote(effect) {
	if (flush_count < 950) return;
	__studioLoopRecent.push(effect);
	if (__studioLoopRecent.length > 60) __studioLoopRecent.shift();
}
function __studioLoopSource(effect) {
	try {
		return String(effect?.fn ?? '').replace(/\\s+/g, ' ').slice(0, 400);
	} catch {
		return '?';
	}
}
function __studioLoopDescribe() {
	const counts = new Map();
	for (const effect of __studioLoopRecent) counts.set(effect, (counts.get(effect) ?? 0) + 1);
	__studioLoopRecent.length = 0;
	return [...counts].slice(0, 8).map(([effect, count]) => {
		const parents = [];
		for (let p = effect.parent; p && parents.length < 4; p = p.parent) parents.push(__studioLoopSource(p).slice(0, 160));
		return { count, flags: effect.f, effect: __studioLoopSource(effect), parents };
	});
}
`;

/** @returns {import('vite').Plugin} */
export function svelteLoopProbe() {
	return {
		name: 'studio-svelte-loop-probe',
		enforce: 'pre',
		/** @param {string} code @param {string} id */
		transform(code, id) {
			if (!TARGET.test(id.split('?')[0])) return null;
			const scheduleMark = '\t\tlast_scheduled_effect = effect;\n';
			const guardMark = '\t} catch (error) {\n\t\tif (DEV) {\n\t\t\t// stack contains no useful information, replace it';
			if (!code.includes(scheduleMark) || !code.includes(guardMark)) {
				// Runtime cambiato: meglio una build che fallisce che una sonda muta.
				this.error('svelte-loop-probe: punti di aggancio non trovati in batch.js, aggiornare la sonda');
			}
			return {
				code:
					code
						.replace(scheduleMark, `${scheduleMark}\t\t__studioLoopNote(effect);\n`)
						.replace(guardMark, `\t} catch (error) {\n\t\ttry { error.studioLoop = __studioLoopDescribe(); } catch {}\n\t\tif (DEV) {\n\t\t\t// stack contains no useful information, replace it`) +
					HELPERS,
				map: null
			};
		}
	};
}
