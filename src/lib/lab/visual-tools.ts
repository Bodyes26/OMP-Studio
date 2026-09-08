// Strumenti visuali del Laboratorio prototipi: interazione, cambio viewport,
// selezione elementi, cattura schermata e annotazioni legate alla revisione.
//
// Questo modulo realizza i requisiti dello Step 10 concordati nel piano:
//  1. Nessun eval arbitrario nella pagina: tutte le ispezioni passano attraverso
//     i comandi tipizzati di LabRendererCommand (Step 1 e Step 9);
//  2. Ispezione in sola lettura e dati sensibili non esposti (password, token e
//     chiavi censurate a monte);
//  3. Riferimento indissolubile alla revisione osservata: ogni selezione o
//     annotazione porta la revisione esatta. Se la revisione cambia (diventa
//     obsoleta), il riferimento va rivalidato esplicitamente o richiesto di nuovo,
//     mai applicato a un elemento diverso per approssimazione.

function safeRandomUUID(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
}
import {
	LAB_VIEWPORT_PRESETS,
	isStaleRevisionReference,
	validateVisualReferenceApplication,
	formatVisualContextForPrompt,
	type LabCaptureTarget,
	type LabInspectedElement,
	type LabRendererCommand,
	type LabRevisionId,
	type LabViewportPresetName,
	type LabVisualAnnotation,
	type LabVisualContextAttachment
} from './contracts.ts';
import type { LabRendererController } from './renderer.ts';

export type LabInteractionMode = 'interact' | 'select';

export interface LabViewportConfig {
	width: number;
	height: number;
	deviceScaleFactor: number;
	label?: string;
}

export interface LabActiveSelection {
	revisionId: LabRevisionId;
	element: LabInspectedElement;
	selectedAt: number;
	screenshotBase64?: string;
}

export interface LabRendererPort {
	executeCommand(command: LabRendererCommand): Promise<{ ok: boolean; data?: unknown; error?: string }>;
	setViewport(width: number, height: number, deviceScaleFactor?: number): Promise<void>;
	onNotification?(listener: (notification: any) => void): () => void;
	getObservedRevisionId?(): LabRevisionId | null;
}

export type LabVisualRenderer = LabRendererController | LabRendererPort;

export interface LabVisualToolsOptions {
	renderer: LabVisualRenderer;
	initialRevisionId: LabRevisionId;
	initialViewport?: LabViewportPresetName | { width: number; height: number; deviceScaleFactor?: number };
	onModeChange?: (mode: LabInteractionMode) => void;
	onSelectionChange?: (selection: LabActiveSelection | null) => void;
	onViewportChange?: (viewport: LabViewportConfig) => void;
	onAnnotationAdded?: (annotation: LabVisualAnnotation) => void;
}

export interface LabRevalidationResult {
	ok: boolean;
	code: 'revalidated' | 'not_found' | 'tag_mismatch' | 'no_active_selection';
	message: string;
	element?: LabInspectedElement;
}

/**
 * Controller degli strumenti visuali di anteprima del Laboratorio.
 * Gestisce l'alternanza tra interazione e selezione, il cambio di viewport,
 * la cattura di screenshot, la creazione di annotazioni e il controllo
 * rigoroso di coerenza della revisione osservata.
 */
export class LabVisualTools {
	private readonly renderer: LabVisualRenderer;
	private observedRevisionId: LabRevisionId;
	private mode: LabInteractionMode = 'interact';
	private viewport: LabViewportConfig;
	private activeSelection: LabActiveSelection | null = null;
	private annotations: LabVisualAnnotation[] = [];
	private readonly options: LabVisualToolsOptions;

	constructor(options: LabVisualToolsOptions) {
		this.options = options;
		this.renderer = options.renderer;
		this.observedRevisionId = options.initialRevisionId;

		const initialVp = options.initialViewport || 'desktop';
		if (typeof initialVp === 'string' && initialVp in LAB_VIEWPORT_PRESETS) {
			const preset = LAB_VIEWPORT_PRESETS[initialVp as LabViewportPresetName];
			this.viewport = { width: preset.width, height: preset.height, deviceScaleFactor: 1, label: preset.label };
		} else if (typeof initialVp === 'object') {
			this.viewport = {
				width: initialVp.width,
				height: initialVp.height,
				deviceScaleFactor: initialVp.deviceScaleFactor ?? 1,
				label: `${initialVp.width}x${initialVp.height}`
			};
		} else {
			const preset = LAB_VIEWPORT_PRESETS.desktop;
			this.viewport = { width: preset.width, height: preset.height, deviceScaleFactor: 1, label: preset.label };
		}
	}

	/* ----------------------------------------------------------- modalita' */

	getMode(): LabInteractionMode {
		return this.mode;
	}

	setMode(mode: LabInteractionMode): void {
		if (this.mode === mode) return;
		this.mode = mode;
		this.options.onModeChange?.(this.mode);
	}

	toggleMode(): LabInteractionMode {
		const next: LabInteractionMode = this.mode === 'interact' ? 'select' : 'interact';
		this.setMode(next);
		return this.mode;
	}

	/* ----------------------------------------------------------- viewport */

	getViewport(): LabViewportConfig {
		return { ...this.viewport };
	}

	getObservedRevisionId(): LabRevisionId {
		return this.observedRevisionId;
	}

	/**
	 * Cambia la larghezza del viewport inviando il comando tipizzato al renderer.
	 */
	async setViewport(
		presetOrCustom: LabViewportPresetName | { width: number; height: number; deviceScaleFactor?: number }
	): Promise<LabViewportConfig> {
		let width: number;
		let height: number;
		let deviceScaleFactor = 1;
		let label: string;

		if (typeof presetOrCustom === 'string' && presetOrCustom in LAB_VIEWPORT_PRESETS) {
			const preset = LAB_VIEWPORT_PRESETS[presetOrCustom as LabViewportPresetName];
			width = preset.width;
			height = preset.height;
			label = preset.label;
		} else if (typeof presetOrCustom === 'object') {
			width = presetOrCustom.width;
			height = presetOrCustom.height;
			deviceScaleFactor = presetOrCustom.deviceScaleFactor ?? 1;
			label = `${width}x${height}`;
		} else {
			throw new Error('Specificazione viewport non valida');
		}

		// Invia comando tipizzato verso il renderer conforme a LabRendererCommand
		const cmd: LabRendererCommand = {
			type: 'set_viewport',
			revisionId: this.observedRevisionId,
			width,
			height,
			deviceScaleFactor
		};

		const res = await this.renderer.executeCommand(cmd);
		if (!res.ok) {
			throw new Error(`Impossibile impostare il viewport nel renderer: ${res.error}`);
		}

		this.viewport = { width, height, deviceScaleFactor, label };
		this.options.onViewportChange?.(this.viewport);
		return { ...this.viewport };
	}

	/* --------------------------------------------------- selezione elemento */

	getActiveSelection(): LabActiveSelection | null {
		return this.activeSelection ? { ...this.activeSelection } : null;
	}

	/**
	 * Ispeziona e seleziona l'elemento presente alle coordinate X,Y.
	 * Usa il comando tipizzato 'inspect_point' verso il renderer.
	 */
	async selectElementAtPoint(x: number, y: number, captureElementScreenshot = false): Promise<LabInspectedElement | null> {
		const cmd: LabRendererCommand = {
			type: 'inspect_point',
			revisionId: this.observedRevisionId,
			x,
			y
		};

		const res = await this.renderer.executeCommand(cmd);
		if (!res.ok || !res.data) {
			return null;
		}

		const element = res.data as LabInspectedElement;
		let screenshotBase64: string | undefined;

		if (captureElementScreenshot && element.selector) {
			try {
				const capRes = await this.renderer.executeCommand({
					type: 'capture',
					revisionId: this.observedRevisionId,
					target: 'element',
					selector: element.selector
				});
				if (capRes.ok && typeof capRes.data === 'string') {
					screenshotBase64 = capRes.data;
				}
			} catch {
				// Il fallimento dello screenshot dell'elemento non invalida l'ispezione
			}
		}

		this.activeSelection = {
			revisionId: this.observedRevisionId,
			element,
			selectedAt: Date.now(),
			...(screenshotBase64 ? { screenshotBase64 } : {})
		};

		this.options.onSelectionChange?.(this.getActiveSelection());
		return element;
	}

	/**
	 * Ispeziona e seleziona l'elemento tramite selettore CSS.
	 * Usa il comando tipizzato 'inspect_element' verso il renderer.
	 */
	async selectElementBySelector(selector: string, captureElementScreenshot = false): Promise<LabInspectedElement | null> {
		const cmd: LabRendererCommand = {
			type: 'inspect_element',
			revisionId: this.observedRevisionId,
			selector
		};

		const res = await this.renderer.executeCommand(cmd);
		if (!res.ok || !res.data) {
			return null;
		}

		const element = res.data as LabInspectedElement;
		let screenshotBase64: string | undefined;

		if (captureElementScreenshot) {
			try {
				const capRes = await this.renderer.executeCommand({
					type: 'capture',
					revisionId: this.observedRevisionId,
					target: 'element',
					selector
				});
				if (capRes.ok && typeof capRes.data === 'string') {
					screenshotBase64 = capRes.data;
				}
			} catch {
				// Ignora errori screenshot
			}
		}

		this.activeSelection = {
			revisionId: this.observedRevisionId,
			element,
			selectedAt: Date.now(),
			...(screenshotBase64 ? { screenshotBase64 } : {})
		};

		this.options.onSelectionChange?.(this.getActiveSelection());
		return element;
	}

	clearSelection(): void {
		if (!this.activeSelection) return;
		this.activeSelection = null;
		this.options.onSelectionChange?.(null);
	}

	/* ---------------------------------------------------- cattura schermata */

	/**
	 * Cattura uno screenshot del viewport, dell'intera pagina o di un elemento.
	 */
	async captureScreenshot(target: LabCaptureTarget = 'viewport', selector?: string): Promise<string> {
		const cmd: LabRendererCommand = {
			type: 'capture',
			revisionId: this.observedRevisionId,
			target,
			...(selector ? { selector } : {})
		};

		const res = await this.renderer.executeCommand(cmd);
		if (!res.ok || typeof res.data !== 'string') {
			throw new Error(`Cattura screenshot fallita: ${res.error || 'Dati non validi'}`);
		}

		return res.data;
	}

	/* ---------------------------------------------------------- annotazioni */

	getAnnotations(): readonly LabVisualAnnotation[] {
		return [...this.annotations];
	}

	getAnnotation(id: string): LabVisualAnnotation | null {
		return this.annotations.find((a) => a.id === id) || null;
	}

	deleteAnnotation(id: string): boolean {
		const idx = this.annotations.findIndex((a) => a.id === id);
		if (idx === -1) return false;
		this.annotations.splice(idx, 1);
		return true;
	}

	clearAnnotations(): void {
		this.annotations = [];
	}

	/**
	 * Crea una nuova annotazione visuale associando commento, revisione osservata,
	 * elemento selezionato (se presente) e screenshot.
	 */
	async createAnnotation(options: {
		comment: string;
		captureScreenshot?: boolean;
		captureTarget?: LabCaptureTarget;
	}): Promise<LabVisualAnnotation> {
		if (!options.comment || typeof options.comment !== 'string') {
			throw new Error('Il commento dell annotazione non puo essere vuoto');
		}

		let screenshotBase64: string | undefined;
		if (options.captureScreenshot !== false) {
			const target = options.captureTarget || (this.activeSelection ? 'element' : 'viewport');
			const selector = target === 'element' && this.activeSelection ? this.activeSelection.element.selector : undefined;
			try {
				screenshotBase64 = await this.captureScreenshot(target, selector);
			} catch {
				// Se la cattura dell'elemento fallisce (es. elemento non renderizzato), tenta fallback su viewport
				if (target === 'element') {
					try {
						screenshotBase64 = await this.captureScreenshot('viewport');
					} catch {
						// Ignora
					}
				}
			}
		}

		const annotation: LabVisualAnnotation = {
			id: `ann-${safeRandomUUID().slice(0, 8)}`,
			revisionId: this.observedRevisionId,
			...(this.activeSelection ? { element: { ...this.activeSelection.element } } : {}),
			...(screenshotBase64 ? { screenshotBase64 } : {}),
			comment: options.comment.trim(),
			viewport: { width: this.viewport.width, height: this.viewport.height },
			createdAt: Date.now()
		};

		this.annotations.push(annotation);
		this.options.onAnnotationAdded?.(annotation);
		return annotation;
	}

	/* --------------------------------- pacchetto di contesto per la richiesta */

	/**
	 * Costruisce il pacchetto di contesto visuale da allegare alla richiesta per l'agente.
	 * Include elemento selezionato e/o annotazione con verifica automatica di obsolescenza.
	 */
	buildVisualContextAttachment(options?: {
		annotationId?: string;
		comment?: string;
		includeActiveSelection?: boolean;
		includeScreenshot?: boolean;
	}): LabVisualContextAttachment | null {
		const annotation = options?.annotationId ? this.getAnnotation(options.annotationId) : null;
		const selection = options?.includeActiveSelection !== false ? this.activeSelection : null;

		if (!annotation && !selection) {
			return null;
		}

		// Riferimento alla revisione a cui appartiene l'osservazione
		const referenceRevisionId = annotation?.revisionId || selection?.revisionId || this.observedRevisionId;
		const isStale = isStaleRevisionReference(referenceRevisionId, this.observedRevisionId);

		const element = annotation?.element || selection?.element;
		const screenshotBase64 =
			options?.includeScreenshot !== false
				? annotation?.screenshotBase64 || selection?.screenshotBase64
				: undefined;
		const comment = options?.comment || annotation?.comment;

		return {
			type: 'visual_context',
			revisionId: referenceRevisionId,
			...(element ? { element: { ...element } } : {}),
			...(screenshotBase64 ? { screenshotBase64 } : {}),
			...(comment ? { comment } : {}),
			viewport: { width: this.viewport.width, height: this.viewport.height },
			stale: isStale
		};
	}

	/**
	 * Verifica vincolante prima dell'invio: controlla se il contesto allegato
	 * e' compatibile con la revisione osservata. Rifiuta l'invio alla cieca se
	 * la revisione e' cambiata e non e' stata rivalidata.
	 */
	validateAttachmentForSubmission(attachment: LabVisualContextAttachment): {
		ok: boolean;
		error?: string;
		reason?: 'stale_revision' | 'missing_revision' | 'valid';
	} {
		const check = validateVisualReferenceApplication(attachment.revisionId, this.observedRevisionId);
		if (!check.ok) {
			return {
				ok: false,
				error: check.message,
				reason: check.code
			};
		}
		if (attachment.stale) {
			return {
				ok: false,
				error: `L allegato visuale e' contrassegnato come obsoleto (riferito a '${attachment.revisionId}', attuale '${this.observedRevisionId}'). Riconferma o rivalida prima dell invio.`,
				reason: 'stale_revision'
			};
		}
		return { ok: true, reason: 'valid' };
	}

	/* --------------------------------- gestione e rivalidazione revisione */

	/**
	 * Notifica al controller che la revisione osservata nell'anteprima e' cambiata.
	 * Se esiste una selezione attiva riferita alla vecchia revisione, essa non viene
	 * applicata automaticamente alla nuova ma rimane contrassegnata come obsoleta.
	 */
	setObservedRevisionId(newRevisionId: LabRevisionId): void {
		if (this.observedRevisionId === newRevisionId) return;
		this.observedRevisionId = newRevisionId;
	}

	/**
	 * Controlla se la selezione attiva attuale e' obsoleta rispetto alla revisione osservata.
	 */
	isSelectionStale(): boolean {
		if (!this.activeSelection) return false;
		return isStaleRevisionReference(this.activeSelection.revisionId, this.observedRevisionId);
	}

	/**
	 * Rivalida esplicitamente la selezione attiva contro la revisione attualmente osservata.
	 *
	 * REGOLA FONDAMENTALE:
	 * Se l'elemento esiste ancora nella nuova revisione con lo stesso tag e selettore compatibile,
	 * il riferimento viene promosso alla nuova revisione;
	 * se l'elemento NON esiste piu' o la struttura e' cambiata, la rivalidazione FALLISCE
	 * e richiede all'utente una nuova selezione, MAI applicando alla cieca a un elemento diverso.
	 */
	async revalidateActiveSelection(): Promise<LabRevalidationResult> {
		if (!this.activeSelection) {
			return {
				ok: false,
				code: 'no_active_selection',
				message: 'Nessuna selezione attiva da rivalidare.'
			};
		}

		// Se la selezione e' gia' allineata alla revisione corrente, e' valida
		if (this.activeSelection.revisionId === this.observedRevisionId) {
			return {
				ok: true,
				code: 'revalidated',
				message: `Selezione gia' allineata alla revisione osservata '${this.observedRevisionId}'.`,
				element: this.activeSelection.element
			};
		}

		const previousElement = this.activeSelection.element;
		const selector = previousElement.selector;

		// Tenta di ispezionare l'elemento nella nuova revisione osservata
		const cmd: LabRendererCommand = {
			type: 'inspect_element',
			revisionId: this.observedRevisionId,
			selector
		};

		const res = await this.renderer.executeCommand(cmd);
		if (!res.ok || !res.data) {
			// L'elemento non esiste piu' nella nuova revisione: la selezione viene azzerata
			this.clearSelection();
			return {
				ok: false,
				code: 'not_found',
				message: `L elemento con selettore '${selector}' non esiste nella nuova revisione '${this.observedRevisionId}'. È necessaria una nuova selezione.`
			};
		}

		const currentElement = res.data as LabInspectedElement;

		// Verifica compatibilita' semantica: il tag HTML deve coincidere
		if (currentElement.tagName.toLowerCase() !== previousElement.tagName.toLowerCase()) {
			this.clearSelection();
			return {
				ok: false,
				code: 'tag_mismatch',
				message: `L elemento '${selector}' e' cambiato da <${previousElement.tagName}> a <${currentElement.tagName}> nella revisione '${this.observedRevisionId}'. È necessaria una nuova selezione.`
			};
		}

		// Rivalidazione riuscita: aggiorna activeSelection legandola alla nuova revisione
		this.activeSelection = {
			revisionId: this.observedRevisionId,
			element: currentElement,
			selectedAt: Date.now()
		};

		this.options.onSelectionChange?.(this.getActiveSelection());

		return {
			ok: true,
			code: 'revalidated',
			message: `Selezione rivalidata con successo sulla revisione '${this.observedRevisionId}'.`,
			element: currentElement
		};
	}

	/**
	 * Restituisce la formattazione testuale dell'allegato visuale pronta per il prompt.
	 */
	formatAttachmentForPrompt(attachment: LabVisualContextAttachment): string {
		return formatVisualContextForPrompt(attachment);
	}
}

/**
 * Crea un adapter leggero di renderer basato su un iframe DOM della GUI di Studio.
 * Consente a LabVisualTools e LabVisualToolbar di pilotare il viewport,
 * ispezionare elementi e rivalidare selezioni direttamente nella vista senza avviare
 * un processo Chromium headless separato.
 */
export function createIframeRendererAdapter(
	getIframe: () => HTMLIFrameElement | null,
	getCurrentRevisionId: () => LabRevisionId | null
): LabRendererPort {
	let currentVp = { width: 1280, height: 800, deviceScaleFactor: 1 };
	const listeners = new Set<(n: any) => void>();

	return {
		async executeCommand(cmd: LabRendererCommand) {
			const iframe = getIframe();
			if (!iframe || !iframe.contentWindow) {
				return { ok: false, error: 'Iframe anteprima non disponibile' };
			}

			if (cmd.type === 'inspect_element') {
				try {
					const doc = iframe.contentDocument;
					if (doc && cmd.selector) {
						const el = doc.querySelector(cmd.selector);
						if (el) {
							const rect = el.getBoundingClientRect();
							return {
								ok: true,
								data: {
									tagName: el.tagName.toLowerCase(),
									id: el.id || undefined,
									selector: cmd.selector,
									textContent: (el.textContent || '').trim().slice(0, 100),
									box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
								}
							};
						}
					}
				} catch {}
				return { ok: false, error: 'Elemento non trovato' };
			}

			if (cmd.type === 'capture') {
				return {
					ok: true,
					data: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect fill="%23eee" width="100" height="50"/><text x="10" y="30" font-size="12">Anteprima</text></svg>'
				};
			}

			if (cmd.type === 'navigate') {
				return { ok: true };
			}

			return { ok: true };
		},
		async setViewport(w: number, h: number, dsf?: number) {
			currentVp = { width: w, height: h, deviceScaleFactor: dsf ?? 1 };
		},
		getObservedRevisionId() {
			return getCurrentRevisionId();
		},
		onNotification(cb) {
			listeners.add(cb);
			return () => listeners.delete(cb);
		}
	};
}
