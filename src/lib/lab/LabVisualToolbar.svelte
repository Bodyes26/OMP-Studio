<script lang="ts">
	import {
		IconInspect,
		IconCamera,
		IconWarning,
		IconSend,
		IconRefresh,
		IconCheck,
		IconClose
	} from '$lib/icons';
	import type {
		LabVisualTools,
		LabActiveSelection,
		LabViewportConfig,
		LabInteractionMode
	} from './visual-tools';
	import type {
		LabVisualContextAttachment,
		LabRevisionId,
		LabViewportPresetName
	} from './contracts';

	let {
		visualTools,
		observedRevisionId,
		onSendAttachment,
		onStaleReferenceBlocked
	}: {
		visualTools: LabVisualTools;
		observedRevisionId: LabRevisionId;
		onSendAttachment?: (attachment: LabVisualContextAttachment) => void;
		onStaleReferenceBlocked?: (error: string) => void;
	} = $props();

	let mode = $state<LabInteractionMode>('interact');
	let currentVp = $state<LabViewportConfig>({
		width: 1280,
		height: 800,
		deviceScaleFactor: 1,
		label: 'Desktop (1280x800)'
	});
	let activeSelection = $state<LabActiveSelection | null>(null);
	let isStale = $state<boolean>(false);

	// Stato del pannello di annotazione
	let showAnnotateModal = $state(false);
	let annotationComment = $state('');
	let includeScreenshot = $state(true);
	let isCapturing = $state(false);
	let validationError = $state<string | null>(null);
	let revalidationFeedback = $state<string | null>(null);

	// Sincronizza lo stato con visualTools quando cambiano le prop o le notifiche
	$effect(() => {
		visualTools.setObservedRevisionId(observedRevisionId);
		mode = visualTools.getMode();
		currentVp = visualTools.getViewport();
		isStale = visualTools.isSelectionStale();
		activeSelection = visualTools.getActiveSelection();
	});

	function handleModeToggle() {
		mode = visualTools.toggleMode();
	}

	async function handleViewportSelect(preset: LabViewportPresetName) {
		try {
			currentVp = await visualTools.setViewport(preset);
		} catch (err) {
			console.error('Errore cambio viewport:', err);
		}
	}

	async function handleRevalidate() {
		revalidationFeedback = null;
		validationError = null;
		const res = await visualTools.revalidateActiveSelection();
		if (res.ok) {
			revalidationFeedback = `Riconfermato su <${res.element?.tagName}> in ${observedRevisionId}`;
			isStale = false;
			activeSelection = visualTools.getActiveSelection();
		} else {
			revalidationFeedback = `Rivalidazione fallita: ${res.message}`;
			isStale = true;
			activeSelection = null;
		}
		setTimeout(() => {
			revalidationFeedback = null;
		}, 4000);
	}

	async function handleCaptureQuick() {
		isCapturing = true;
		try {
			await visualTools.captureScreenshot(activeSelection ? 'element' : 'viewport');
		} catch (err) {
			console.error('Errore cattura:', err);
		} finally {
			isCapturing = false;
		}
	}

	function handleOpenAnnotate() {
		validationError = null;
		revalidationFeedback = null;
		showAnnotateModal = true;
	}

	async function handleSubmitAnnotation() {
		if (!annotationComment.trim()) {
			validationError = 'Inserisci un commento per l annotazione visuale.';
			return;
		}

		// 1. Crea l'annotazione formale nel controller
		let screenshotBase64: string | undefined;
		if (includeScreenshot) {
			try {
				screenshotBase64 = await visualTools.captureScreenshot(
					activeSelection ? 'element' : 'viewport'
				);
			} catch {
				// Continua anche se lo screenshot fallisce
			}
		}

		// 2. Costruisce il pacchetto di contesto da allegare
		const attachment = visualTools.buildVisualContextAttachment({
			comment: annotationComment.trim(),
			includeActiveSelection: true,
			includeScreenshot
		});

		if (!attachment) {
			validationError = 'Nessun elemento selezionato o annotazione da inviare.';
			return;
		}

		if (screenshotBase64 && !attachment.screenshotBase64) {
			attachment.screenshotBase64 = screenshotBase64;
		}

		// 3. REGOLA FONDAMENTALE DI ACCETTAZIONE:
		// Verifica se il riferimento appartiene alla revisione corrente. Se e' obsoleto,
		// VIENE BLOCCATO E MAI APPLICATO ALLA CIECA.
		const validation = visualTools.validateAttachmentForSubmission(attachment);
		if (!validation.ok) {
			const errMsg =
				validation.error ||
				`Riferimento bloccato: appartiene alla revisione '${attachment.revisionId}', ma l'anteprima e' alla revisione '${observedRevisionId}'. Rivalida la selezione.`;
			validationError = errMsg;
			onStaleReferenceBlocked?.(errMsg);
			return;
		}

		// Invio sicuro
		onSendAttachment?.(attachment);
		showAnnotateModal = false;
		annotationComment = '';
	}
</script>

<div class="lab-visual-toolbar" role="toolbar" aria-label="Strumenti visuali anteprima">
	<!-- 1. Interazione / Selezione elemento -->
	<div class="mode-group" role="group" aria-label="Modalita operazione">
		<button
			type="button"
			class="btn-mode"
			class:active={mode === 'interact'}
			onclick={() => {
				visualTools.setMode('interact');
				mode = 'interact';
			}}
			title="Modalita Interazione: usa il prototipo come un utente reale"
		>
			Interazione
		</button>
		<button
			type="button"
			class="btn-mode select-mode"
			class:active={mode === 'select'}
			onclick={() => {
				visualTools.setMode('select');
				mode = 'select';
			}}
			title="Modalita Selezione: ispeziona elementi DOM in sola lettura"
		>
			<IconInspect />
			<span>Seleziona elemento</span>
		</button>
	</div>

	<!-- 2. Cambio Viewport -->
	<div class="viewport-group" role="group" aria-label="Selettore viewport responsive">
		<button
			type="button"
			class="btn-vp"
			class:active={currentVp.width === 1280}
			onclick={() => handleViewportSelect('desktop')}
			title="Desktop (1280x800)"
		>
			Desktop
		</button>
		<button
			type="button"
			class="btn-vp"
			class:active={currentVp.width === 768}
			onclick={() => handleViewportSelect('tablet')}
			title="Tablet (768x1024)"
		>
			Tablet
		</button>
		<button
			type="button"
			class="btn-vp"
			class:active={currentVp.width === 390}
			onclick={() => handleViewportSelect('mobile')}
			title="Mobile (390x844)"
		>
			Mobile
		</button>
		<span class="vp-label">{currentVp.width}&times;{currentVp.height}</span>
	</div>

	<!-- 3. Badge della Revisione Osservata -->
	<div class="revision-indicator" title="Revisione attualmente osservata nel renderer">
		<span class="rev-dot"></span>
		<span class="rev-id">{observedRevisionId}</span>
	</div>

	<!-- 4. Elemento Attualmente Selezionato o Avviso di Obsolescenza -->
	{#if activeSelection}
		<div class="selection-chip" class:stale={isStale}>
			<span class="chip-tag">&lt;{activeSelection.element.tagName}&gt;</span>
			<span class="chip-sel" title={activeSelection.element.selector}>{activeSelection.element.selector}</span>
			{#if isStale}
				<span class="stale-warning" title="La selezione appartiene a una revisione superata">
					<IconWarning /> Obsoleto ({activeSelection.revisionId})
				</span>
				<button
					type="button"
					class="btn-revalidate"
					onclick={handleRevalidate}
					title="Rivalida l elemento sulla revisione osservata corrente"
				>
					<IconRefresh /> Rivalida
				</button>
			{/if}
			<button
				type="button"
				class="btn-chip-close"
				onclick={() => visualTools.clearSelection()}
				title="Annulla selezione"
			>
				<IconClose />
			</button>
		</div>
	{/if}

	<div class="spacer"></div>

	<!-- 5. Feedback rivalidazione -->
	{#if revalidationFeedback}
		<span class="reval-feedback">{revalidationFeedback}</span>
	{/if}

	<!-- 6. Azioni: Cattura schermata e Annota -->
	<div class="action-group">
		<button
			type="button"
			class="btn-action"
			disabled={isCapturing}
			onclick={handleCaptureQuick}
			title="Cattura screenshot del viewport o elemento selezionato"
		>
			<IconCamera />
			<span>{isCapturing ? 'Cattura...' : 'Screenshot'}</span>
		</button>
		<button
			type="button"
			class="btn-action primary"
			onclick={handleOpenAnnotate}
			title="Aggiungi un annotazione e inviala con la richiesta all agente"
		>
			<IconSend />
			<span>Annota</span>
		</button>
	</div>
</div>

<!-- Modal di annotazione e allegato richiesta -->
{#if showAnnotateModal}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="modal-backdrop" onclick={() => (showAnnotateModal = false)} role="presentation">
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div
			class="annotate-dialog"
			onclick={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
			tabindex="-1"
		>
			<div class="dialog-header">
				<h3>Annotazione sull'anteprima ({observedRevisionId})</h3>
				<button type="button" class="btn-close" onclick={() => (showAnnotateModal = false)}>
					<IconClose />
				</button>
			</div>

			<div class="dialog-body">
				{#if validationError}
					<div class="alert-banner error" role="alert">
						<IconWarning />
						<span>{validationError}</span>
					</div>
				{/if}

				{#if activeSelection}
					<div class="element-summary" class:stale={isStale}>
						<div class="summary-row">
							<strong>Elemento:</strong>
							<code>&lt;{activeSelection.element.tagName}&gt; {activeSelection.element.selector}</code>
						</div>
						<div class="summary-row">
							<strong>Revisione:</strong>
							<span>{activeSelection.revisionId}</span>
							{#if isStale}
								<span class="stale-pill">Obsoleta (osservata: {observedRevisionId})</span>
							{/if}
						</div>
						{#if activeSelection.element.textSnippet}
							<div class="summary-row">
								<strong>Testo:</strong>
								<span class="snippet">"{activeSelection.element.textSnippet}"</span>
							</div>
						{/if}
					</div>
				{:else}
					<div class="element-summary empty">
						<span>Nessun elemento specifico selezionato: l annotazione riguardera l intero viewport {currentVp.width}&times;{currentVp.height}.</span>
					</div>
				{/if}

				<div class="field-wrap">
					<label for="annotation-text">Cosa vuoi modificare o chiedere all'agente?</label>
					<textarea
						id="annotation-text"
						bind:value={annotationComment}
						placeholder="Es. Riduci il padding, usa un colore piu caldo o cambia il testo in..."
						rows="3"
					></textarea>
				</div>

				<label class="checkbox-label">
					<input type="checkbox" bind:checked={includeScreenshot} />
					<span>Includi cattura schermata nello stato attuale</span>
				</label>
			</div>

			<div class="dialog-footer">
				{#if isStale}
					<button
						type="button"
						class="btn-secondary"
						onclick={handleRevalidate}
						title="Rivalida l elemento sulla revisione attuale prima di inviare"
					>
						<IconRefresh /> Rivalida selezione
					</button>
				{/if}
				<div class="spacer"></div>
				<button type="button" class="btn-secondary" onclick={() => (showAnnotateModal = false)}>
					Annulla
				</button>
				<button type="button" class="btn-primary" onclick={handleSubmitAnnotation}>
					<IconSend /> Invia con richiesta
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.lab-visual-toolbar {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 10px;
		background: var(--bg-surface);
		border-bottom: 1px solid var(--border-subtle);
		font-size: 12px;
		color: var(--ink);
		user-select: none;
	}

	.mode-group,
	.viewport-group,
	.action-group {
		display: inline-flex;
		align-items: center;
		background: var(--bg-sunken);
		border-radius: 6px;
		padding: 2px;
		border: 1px solid var(--border-subtle);
	}

	.btn-mode,
	.btn-vp,
	.btn-action {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 3px 8px;
		font-size: 11px;
		font-weight: 500;
		color: var(--ink-subtle);
		background: transparent;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.btn-mode:hover,
	.btn-vp:hover,
	.btn-action:hover {
		color: var(--ink);
		background: var(--bg-hover);
	}

	.btn-mode.active,
	.btn-vp.active {
		color: var(--ink-strong);
		background: var(--bg-surface);
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
	}

	.btn-mode.select-mode.active {
		color: var(--accent);
		background: var(--accent-subtle);
	}

	.btn-action.primary {
		background: var(--accent);
		color: #fff;
		font-weight: 600;
	}

	.btn-action.primary:hover {
		filter: brightness(1.1);
	}

	.vp-label {
		font-size: 10px;
		color: var(--ink-muted);
		padding: 0 6px;
		font-family: var(--font-mono, monospace);
	}

	.revision-indicator {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 2px 7px;
		border-radius: 4px;
		background: var(--bg-sunken);
		font-family: var(--font-mono, monospace);
		font-size: 11px;
		color: var(--ink-muted);
	}

	.rev-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--accent);
	}

	.selection-chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 2px 7px;
		background: var(--accent-subtle);
		border: 1px solid var(--accent);
		border-radius: 4px;
		font-size: 11px;
	}

	.selection-chip.stale {
		background: var(--warn-subtle, rgba(234, 179, 8, 0.15));
		border-color: var(--warn, #eab308);
	}

	.chip-tag {
		font-weight: 600;
		color: var(--accent);
	}

	.selection-chip.stale .chip-tag {
		color: var(--warn, #eab308);
	}

	.chip-sel {
		max-width: 130px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-mono, monospace);
	}

	.stale-warning {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		color: var(--warn, #eab308);
		font-weight: 600;
	}

	.btn-revalidate {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		padding: 1px 5px;
		font-size: 10px;
		border-radius: 3px;
		background: var(--warn, #eab308);
		color: #000;
		font-weight: 600;
		border: none;
		cursor: pointer;
	}

	.btn-chip-close {
		background: transparent;
		border: none;
		padding: 0;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		color: var(--ink-muted);
	}

	.btn-chip-close:hover {
		color: var(--ink);
	}

	.spacer {
		flex: 1;
	}

	.reval-feedback {
		font-size: 11px;
		color: var(--ink-muted);
		font-style: italic;
	}

	/* Modal e drawer di annotazione */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.45);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 9999;
	}

	.annotate-dialog {
		width: 480px;
		max-width: 90vw;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: 8px;
		box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.dialog-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		border-bottom: 1px solid var(--border-subtle);
	}

	.dialog-header h3 {
		margin: 0;
		font-size: 14px;
		font-weight: 600;
	}

	.dialog-body {
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.alert-banner.error {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		background: rgba(239, 68, 68, 0.12);
		border: 1px solid #ef4444;
		color: #ef4444;
		border-radius: 6px;
		font-size: 12px;
	}

	.element-summary {
		background: var(--bg-sunken);
		border: 1px solid var(--border-subtle);
		border-radius: 6px;
		padding: 10px;
		font-size: 12px;
	}

	.element-summary.stale {
		border-color: var(--warn, #eab308);
		background: rgba(234, 179, 8, 0.08);
	}

	.summary-row {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 4px;
	}

	.summary-row:last-child {
		margin-bottom: 0;
	}

	.stale-pill {
		font-size: 10px;
		font-weight: 600;
		background: var(--warn, #eab308);
		color: #000;
		padding: 1px 5px;
		border-radius: 3px;
	}

	.snippet {
		color: var(--ink-muted);
		font-style: italic;
	}

	.field-wrap {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.field-wrap label {
		font-size: 12px;
		font-weight: 500;
	}

	.field-wrap textarea {
		width: 100%;
		box-sizing: border-box;
		padding: 8px;
		background: var(--bg-sunken);
		border: 1px solid var(--border-subtle);
		border-radius: 6px;
		color: var(--ink);
		font-family: inherit;
		font-size: 12px;
		resize: vertical;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		cursor: pointer;
	}

	.dialog-footer {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 16px;
		background: var(--bg-sunken);
		border-top: 1px solid var(--border-subtle);
	}

	.btn-secondary,
	.btn-primary {
		padding: 6px 12px;
		border-radius: 6px;
		font-size: 12px;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.btn-secondary {
		background: transparent;
		border: 1px solid var(--border-subtle);
		color: var(--ink);
	}

	.btn-primary {
		background: var(--accent);
		border: none;
		color: #fff;
		font-weight: 600;
	}

	.btn-primary:hover {
		filter: brightness(1.1);
	}

	.btn-close {
		background: transparent;
		border: none;
		color: var(--ink-muted);
		cursor: pointer;
	}
</style>
