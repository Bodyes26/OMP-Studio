import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createLabRendererController, type LabRendererController } from '../src/lib/lab/renderer.ts';
import {
	LabVisualTools,
	type LabInteractionMode,
	type LabViewportConfig
} from '../src/lib/lab/visual-tools.ts';
import {
	LAB_VIEWPORT_PRESETS,
	parseLabVisualAnnotation,
	parseLabVisualContextAttachment,
	validateVisualReferenceApplication,
	formatVisualContextForPrompt,
	redactSensitiveText,
	type LabVisualContextAttachment
} from '../src/lib/lab/contracts.ts';

describe('Laboratorio prototipi — Step 10: Selezione elementi e annotazioni legate alla revisione', () => {
	let controller: LabRendererController;

	before(async () => {
		controller = await createLabRendererController();
	});

	after(async () => {
		if (controller) await controller.close();
	});

	// --------------------------------------------------------------------------
	// 1. Alternanza modalita' (interazione vs selezione) e cambio viewport
	// --------------------------------------------------------------------------
	describe('1. Alternanza modalita e cambio viewport con comandi tipizzati', () => {
		it('alterna tra modalita interazione e selezione emettendo notifiche', () => {
			const modeEvents: LabInteractionMode[] = [];
			const visualTools = new LabVisualTools({
				renderer: controller,
				initialRevisionId: 'rev-mode-test',
				onModeChange: (m) => modeEvents.push(m)
			});

			assert.equal(visualTools.getMode(), 'interact');

			visualTools.setMode('select');
			assert.equal(visualTools.getMode(), 'select');
			assert.deepEqual(modeEvents, ['select']);

			// Toggle
			const toggled = visualTools.toggleMode();
			assert.equal(toggled, 'interact');
			assert.equal(visualTools.getMode(), 'interact');
			assert.deepEqual(modeEvents, ['select', 'interact']);
		});

		it('cambia viewport inviando il comando tipizzato set_viewport al renderer', async () => {
			await controller.renderRevision('rev-vp-test', {
				js: "document.getElementById('root').innerHTML = '<h1 id=\"title\">Viewport Test</h1>';",
				title: 'Viewport Test'
			});

			const vpEvents: LabViewportConfig[] = [];
			const visualTools = new LabVisualTools({
				renderer: controller,
				initialRevisionId: 'rev-vp-test',
				onViewportChange: (vp) => vpEvents.push(vp)
			});

			// 1. Preset Tablet (768x1024)
			const tabletVp = await visualTools.setViewport('tablet');
			assert.equal(tabletVp.width, 768);
			assert.equal(tabletVp.height, 1024);
			assert.equal(controller.getViewport().width, 768);
			assert.equal(controller.getViewport().height, 1024);

			// 2. Preset Mobile (390x844)
			const mobileVp = await visualTools.setViewport('mobile');
			assert.equal(mobileVp.width, 390);
			assert.equal(mobileVp.height, 844);
			assert.equal(controller.getViewport().width, 390);
			assert.equal(controller.getViewport().height, 844);

			// 3. Custom viewport
			const customVp = await visualTools.setViewport({ width: 1024, height: 600 });
			assert.equal(customVp.width, 1024);
			assert.equal(customVp.height, 600);
			assert.equal(controller.getViewport().width, 1024);

			assert.equal(vpEvents.length, 3);
		});
	});

	// --------------------------------------------------------------------------
	// 2. Ispezione in sola lettura e redazione dati sensibili
	// --------------------------------------------------------------------------
	describe('2. Ispezione in sola lettura e redazione rigorosa dei dati sensibili', () => {
		it('redige password, token Bearer e campi sensibili dal textSnippet', async () => {
			await controller.renderRevision('rev-privacy-test', {
				js: `
					document.getElementById('root').innerHTML = \`
						<form id="login-form">
							<label for="username">Utente</label>
							<input id="username" type="text" value="mario.rossi" />

							<label for="pwd">Password Segreta</label>
							<input id="pwd" type="password" value="SuperSecretPassword123!" />

							<label for="api-token">Token API</label>
							<input id="api-token" name="api_token" type="text" value="Bearer sec_abcdef123456789" />

							<p id="safe-text">Benvenuto nel portale</p>
						</form>
					\`;
				`,
				title: 'Privacy Test'
			});

			const visualTools = new LabVisualTools({
				renderer: controller,
				initialRevisionId: 'rev-privacy-test'
			});

			// 1. Campo password: il testo deve risultare categoricamente [REDACTED]
			const pwdEl = await visualTools.selectElementBySelector('#pwd');
			assert.ok(pwdEl, 'Deve trovare l elemento password');
			assert.equal(pwdEl!.tagName, 'input');
			assert.equal(pwdEl!.textSnippet, '[REDACTED]', 'La password non deve MAI essere esposta');

			// 2. Campo token API: deve risultare [REDACTED] per nome sensibile
			const tokenEl = await visualTools.selectElementBySelector('#api-token');
			assert.ok(tokenEl);
			assert.equal(tokenEl!.textSnippet, '[REDACTED]', 'Il token API non deve essere esposto');

			// 3. Campo ordinario e testo sicuro: testo leggibile
			const safeEl = await visualTools.selectElementBySelector('#safe-text');
			assert.ok(safeEl);
			assert.equal(safeEl!.textSnippet, 'Benvenuto nel portale');

			// 4. Utility redactSensitiveText pura
			const textWithSecret = 'Errore autorizzazione: Bearer abcdef1234567890 token=xyz987654321';
			const redacted = redactSensitiveText(textWithSecret);
			assert.equal(redacted.includes('abcdef1234567890'), false);
			assert.equal(redacted.includes('xyz987654321'), false);
			assert.equal(redacted.includes('[REDACTED]'), true);
		});
	});

	// --------------------------------------------------------------------------
	// 3. Cattura schermata e annotazioni
	// --------------------------------------------------------------------------
	describe('3. Cattura schermata e creazione annotazioni', () => {
		it('crea un annotazione con commento, screenshot, elemento e revisione osservata', async () => {
			await controller.renderRevision('rev-ann-test', {
				js: `
					document.getElementById('root').innerHTML = \`
						<div style="padding: 24px; background: #f8fafc;">
							<button id="cta-button" style="padding: 10px 18px; background: #6366f1; color: white;">
								Procedi alla conferma
							</button>
						</div>
					\`;
				`,
				title: 'Annotation Test'
			});

			const visualTools = new LabVisualTools({
				renderer: controller,
				initialRevisionId: 'rev-ann-test'
			});

			// Seleziona il pulsante
			const selected = await visualTools.selectElementBySelector('#cta-button', true);
			assert.ok(selected);
			assert.equal(selected!.tagName, 'button');

			// Crea annotazione
			const annotation = await visualTools.createAnnotation({
				comment: 'Rendi il pulsante verde smeraldo con angoli arrotondati',
				captureScreenshot: true
			});

			assert.ok(annotation.id.startsWith('ann-'));
			assert.equal(annotation.revisionId, 'rev-ann-test');
			assert.equal(annotation.comment, 'Rendi il pulsante verde smeraldo con angoli arrotondati');
			assert.ok(annotation.element);
			assert.equal(annotation.element!.tagName, 'button');
			assert.equal(annotation.element!.selector, '#cta-button');
			assert.ok(annotation.screenshotBase64);
			assert.ok(annotation.screenshotBase64.length > 50);

			// Parsing contrattuale
			const parsed = parseLabVisualAnnotation(annotation);
			assert.notEqual(parsed, null);
			assert.equal(parsed!.revisionId, 'rev-ann-test');
		});
	});

	// --------------------------------------------------------------------------
	// 4. CRITERIO DI ACCETTAZIONE VINCULANTE:
	//    Selezione, annotazione, invio con contesto corretto;
	//    poi revisione resa obsoleta e verifica blocco applicazione alla cieca.
	// --------------------------------------------------------------------------
	describe('4. Accettazione: allegato con revisione corretta e rifiuto riferimenti obsoleti', () => {
		it('seleziona un elemento, annota, invia con successo; rendendo obsoleta la revisione, l invio alla cieca viene BLOCCATO', async () => {
			// FASE 1: Revisione 1 attiva ('rev-step10-v1')
			await controller.renderRevision('rev-step10-v1', {
				js: `
					document.getElementById('root').innerHTML = \`
						<header id="main-header" style="padding: 16px; border-bottom: 1px solid #ccc;">
							<h1 id="brand-title">Studio Lab V1</h1>
							<button id="action-btn" class="primary-btn">Salva bozza</button>
						</header>
					\`;
				`,
				title: 'Step 10 V1'
			});

			const visualTools = new LabVisualTools({
				renderer: controller,
				initialRevisionId: 'rev-step10-v1'
			});

			// 1. Seleziona elemento
			const element = await visualTools.selectElementBySelector('#action-btn', true);
			assert.ok(element);
			assert.equal(element!.tagName, 'button');
			assert.equal(element!.selector, '#action-btn');

			// 2. Crea annotazione
			const annotation = await visualTools.createAnnotation({
				comment: 'Sposta questo pulsante a destra e fallo diventare icona',
				captureScreenshot: true
			});
			assert.equal(annotation.revisionId, 'rev-step10-v1');

			// 3. Costruisce il pacchetto di contesto da allegare alla richiesta
			const attachment = visualTools.buildVisualContextAttachment({
				annotationId: annotation.id
			});
			assert.notEqual(attachment, null);
			assert.equal(attachment!.type, 'visual_context');
			assert.equal(attachment!.revisionId, 'rev-step10-v1');
			assert.equal(attachment!.element?.selector, '#action-btn');
			assert.equal(attachment!.stale, false);

			// 4. Verifica di invio: con revisione coerente l'invio ha successo
			const submission1 = visualTools.validateAttachmentForSubmission(attachment!);
			assert.equal(submission1.ok, true, 'L invio con revisione coerente deve essere accettato');

			// 5. Verifica formattazione per il prompt dell'agente
			const promptText = visualTools.formatAttachmentForPrompt(attachment!);
			assert.match(promptText, /\[Riferimento visuale alla revisione: rev-step10-v1\]/);
			assert.match(promptText, /<button> #action-btn/);
			assert.match(promptText, /Sposta questo pulsante a destra/);

			// FASE 2: La revisione avanza a 'rev-step10-v2' (l'agente o il principale ha generato una nuova revisione)
			await controller.renderRevision('rev-step10-v2', {
				js: `
					document.getElementById('root').innerHTML = \`
						<header id="main-header" style="padding: 16px;">
							<h1 id="brand-title">Studio Lab V2</h1>
							<button id="action-btn" class="icon-btn">💾</button>
						</header>
					\`;
				`,
				title: 'Step 10 V2'
			});

			// Notifica al visualTools che l'anteprima ora osserva 'rev-step10-v2'
			visualTools.setObservedRevisionId('rev-step10-v2');

			// 6. VERIFICA CRUCIALE: il riferimento precedente ('rev-step10-v1') e' ora OBSOLETO
			assert.equal(visualTools.isSelectionStale(), true, 'La selezione deve risultare obsoleta');

			// Un nuovo pacchetto costruito con la vecchia annotazione viene marcato stale
			const staleAttachment = visualTools.buildVisualContextAttachment({
				annotationId: annotation.id
			});
			assert.notEqual(staleAttachment, null);
			assert.equal(staleAttachment!.revisionId, 'rev-step10-v1');
			assert.equal(staleAttachment!.stale, true, 'Il pacchetto deve essere marcato come obsoleto');

			// 7. BLOCCO INVIATO ALLA CIECA: la validazione deve RIFIUTARE categoricamente l'invio
			const blockedSubmission = visualTools.validateAttachmentForSubmission(staleAttachment!);
			assert.equal(blockedSubmission.ok, false, 'L invio alla cieca di un riferimento obsoleto DEVE essere rifiutato');
			assert.equal(blockedSubmission.reason, 'stale_revision');
			assert.match(blockedSubmission.error!, /appartiene alla revisione 'rev-step10-v1' ma l'anteprima e' alla revisione 'rev-step10-v2'/);

			// 8. RIVALIDAZIONE ESPLICITA SU REVISIONE COMPATIBILE
			// L'utente o il sistema richiede la rivalidazione dell'elemento sulla nuova revisione
			const revalidationRes = await visualTools.revalidateActiveSelection();
			assert.equal(revalidationRes.ok, true, 'La rivalidazione su elemento compatibile deve riuscire');
			assert.equal(revalidationRes.code, 'revalidated');
			assert.equal(revalidationRes.element?.tagName, 'button');

			// Ora l'activeSelection appartiene a 'rev-step10-v2' e non e' piu' obsoleta
			assert.equal(visualTools.isSelectionStale(), false);
			assert.equal(visualTools.getActiveSelection()?.revisionId, 'rev-step10-v2');

			// Il nuovo allegato costruito dopo la rivalidazione e' valido e inviabile
			const revalidatedAttachment = visualTools.buildVisualContextAttachment({
				comment: 'Ritocco dopo rivalidazione'
			});
			assert.notEqual(revalidatedAttachment, null);
			assert.equal(revalidatedAttachment!.revisionId, 'rev-step10-v2');
			assert.equal(revalidatedAttachment!.stale, false);
			assert.equal(visualTools.validateAttachmentForSubmission(revalidatedAttachment!).ok, true);

			// FASE 3: La revisione avanza a 'rev-step10-v3' dove l'elemento e' stato ELIMINATO o cambiato in modo incompatibile
			await controller.renderRevision('rev-step10-v3', {
				js: `
					document.getElementById('root').innerHTML = \`
						<header id="main-header">
							<h1>Studio Lab V3 - Pulsante rimosso</h1>
							<span id="action-btn">Non piu un pulsante ma un testo decorativo</span>
						</header>
					\`;
				`,
				title: 'Step 10 V3'
			});

			visualTools.setObservedRevisionId('rev-step10-v3');
			assert.equal(visualTools.isSelectionStale(), true);

			// Tentativo di rivalidazione: l'elemento ha cambiato tag (da button a span)
			const failedRevalidation = await visualTools.revalidateActiveSelection();
			assert.equal(failedRevalidation.ok, false, 'La rivalidazione su elemento incompatibile DEVE fallire');
			assert.equal(failedRevalidation.code, 'tag_mismatch');
			assert.match(failedRevalidation.message, /cambiato da <button> a <span>/);

			// La selezione attiva e' stata AZZERATA per evitare qualsiasi applicazione accidentale
			assert.equal(visualTools.getActiveSelection(), null);
		});
	});
});
