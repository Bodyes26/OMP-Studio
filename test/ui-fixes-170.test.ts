import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ActionsPollGate, ACTIONS_POLL_INTERVAL_MS } from '../src/lib/stores/actionsPollGate.ts';
import { roleConfigFromSelector } from '../src/lib/components/taskRoleConfig.ts';
import { loadPreview, type PreviewLoadDeps } from '../src/lib/components/previewLoad.ts';
import {
	installOutcomeKeepsRunning,
	installOutcomeNotice
} from '../src/lib/stores/studioInstallOutcome.ts';

describe('Cadenza stato GitHub Actions (ActionsPollGate)', () => {
	it('lascia passare una lettura al minuto per progetto e branch', () => {
		const gate = new ActionsPollGate();
		assert.equal(gate.tryAcquire('p\nmain', 0), true);
		// I refresh da 15 s del pannello Git non devono richiamare l'API.
		assert.equal(gate.tryAcquire('p\nmain', 15_000), false);
		assert.equal(gate.tryAcquire('p\nmain', 45_000), false);
		assert.equal(gate.tryAcquire('p\nmain', ACTIONS_POLL_INTERVAL_MS), true);
	});

	it('non limita una richiesta esplicita dell\'utente', () => {
		const gate = new ActionsPollGate();
		gate.tryAcquire('p\nmain', 0);
		assert.equal(gate.tryAcquire('p\nmain', 1_000, true), true);
		// La lettura forzata riparte il conteggio del minuto.
		assert.equal(gate.tryAcquire('p\nmain', 30_000), false);
	});

	it('tratta progetti e branch diversi come chiavi indipendenti', () => {
		const gate = new ActionsPollGate();
		gate.tryAcquire('p\nmain', 0);
		assert.equal(gate.tryAcquire('p\nfeature', 1_000), true);
		assert.equal(gate.tryAcquire('q\nmain', 1_000), true);
	});
});

describe('Ruolo del task: modello e thinking dal selettore', () => {
	it('non tronca gli id che contengono i due punti', () => {
		assert.deepEqual(roleConfigFromSelector('ollama/qwen3:32b'), { model: 'ollama/qwen3:32b', thinking: 'auto' });
		assert.deepEqual(roleConfigFromSelector('openrouter/x:free'), { model: 'openrouter/x:free', thinking: 'auto' });
	});

	it('separa il thinking solo quando e\' un livello noto', () => {
		assert.deepEqual(roleConfigFromSelector('ollama/qwen3:32b:high'), { model: 'ollama/qwen3:32b', thinking: 'high' });
		assert.deepEqual(roleConfigFromSelector('anthropic/claude-opus:xhigh'), {
			model: 'anthropic/claude-opus',
			thinking: 'xhigh'
		});
		assert.deepEqual(roleConfigFromSelector('google/gemini-flash'), { model: 'google/gemini-flash', thinking: 'auto' });
	});

	it('rispetta i selettori noti del catalogo', () => {
		// Un modello il cui id finisce davvero con `:high` resta intero.
		const known = new Set(['custom/model:high']);
		assert.deepEqual(roleConfigFromSelector('custom/model:high', known), { model: 'custom/model:high', thinking: 'auto' });
	});

	it('restituisce un ruolo vuoto senza selettore', () => {
		assert.deepEqual(roleConfigFromSelector(''), { model: '', thinking: 'auto' });
	});
});

describe('Caricamento anteprima superato (loadPreview)', () => {
	function deferred<T>() {
		let resolve!: (value: T) => void;
		const promise = new Promise<T>((r) => (resolve = r));
		return { promise, resolve };
	}

	function makeDeps(overrides: Partial<PreviewLoadDeps>): PreviewLoadDeps & { published: string[]; unpublished: string[] } {
		const published: string[] = [];
		const unpublished: string[] = [];
		return {
			key: 'k1',
			isCurrent: () => true,
			currentKey: () => 'k1',
			readFile: async () => ({ content: '<div></div>', exists: true }),
			isSvg: () => false,
			publish: async (key) => {
				published.push(key);
				return `http://127.0.0.1/${key}`;
			},
			unpublish: (key) => unpublished.push(key),
			published,
			unpublished,
			...overrides
		};
	}

	it('pubblica e restituisce l\'URL quando resta il caricamento corrente', async () => {
		const deps = makeDeps({});
		const result = await loadPreview(deps);
		assert.deepEqual(result, { kind: 'html', content: '<div></div>', url: 'http://127.0.0.1/k1' });
		assert.deepEqual(deps.published, ['k1']);
	});

	it('non pubblica se il file cambia mentre la lettura e\' in volo', async () => {
		let current = true;
		const read = deferred<{ content: string; exists: boolean }>();
		const deps = makeDeps({ isCurrent: () => current, readFile: () => read.promise });
		const pending = loadPreview(deps);
		current = false;
		read.resolve({ content: '<p></p>', exists: true });
		assert.equal(await pending, null);
		assert.deepEqual(deps.published, []);
	});

	it('ritira la chiave vecchia se la pubblicazione arriva dopo il cambio di file', async () => {
		let current = true;
		let shownKey = 'k1';
		const deps = makeDeps({
			isCurrent: () => current,
			currentKey: () => shownKey,
			publish: async (key) => {
				// La pulizia del componente avviene mentre la pubblicazione e' in volo.
				current = false;
				shownKey = 'k2';
				return `http://127.0.0.1/${key}`;
			}
		});
		assert.equal(await loadPreview(deps), null);
		assert.deepEqual(deps.unpublished, ['k1']);
	});

	it('non ritira la chiave se un «Ricarica» piu\' recente usa la stessa', async () => {
		let current = true;
		const deps = makeDeps({
			isCurrent: () => current,
			publish: async (key) => {
				current = false;
				return `http://127.0.0.1/${key}`;
			}
		});
		assert.equal(await loadPreview(deps), null);
		assert.deepEqual(deps.unpublished, []);
	});

	it('distingue file mancante e SVG senza pubblicare', async () => {
		const missing = makeDeps({ readFile: async () => ({ content: '', exists: false }) });
		assert.deepEqual(await loadPreview(missing), { kind: 'missing' });
		const svg = makeDeps({ isSvg: () => true, readFile: async () => ({ content: '<svg/>', exists: true }) });
		assert.deepEqual(await loadPreview(svg), { kind: 'svg', content: '<svg/>' });
		assert.deepEqual([...missing.published, ...svg.published], []);
	});
});

describe('Esito installazione aggiornamento Studio', () => {
	it('riconosce la chiusura dell\'app (nessun esito)', () => {
		assert.equal(installOutcomeKeepsRunning(undefined), false);
		assert.equal(installOutcomeKeepsRunning(null), false);
		assert.equal(installOutcomeNotice(undefined), null);
	});

	it('mostra il messaggio quando Studio resta aperto (.deb)', () => {
		const text = 'Completa con: sudo apt install ./omp-studio.deb';
		assert.equal(installOutcomeKeepsRunning(text), true);
		assert.equal(installOutcomeNotice(text), text);
		const obj = { status: 'pending', message: text };
		assert.equal(installOutcomeKeepsRunning(obj), true);
		assert.equal(installOutcomeNotice(obj), text);
	});

	it('segnala un esito senza testo per usare il messaggio predefinito', () => {
		assert.equal(installOutcomeKeepsRunning({ status: 'pending' }), true);
		assert.equal(installOutcomeNotice({ status: 'pending' }), null);
	});
});
