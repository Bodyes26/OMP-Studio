import { load, type Store } from '@tauri-apps/plugin-store';
import { debounce } from 'lodash-es';

/**
 * Personalizzazioni del guscio.
 *
 * Un solo posto per tutto quello che l'utente puo' cambiare e che non
 * appartiene ne' a `omp` (modelli, tema) ne' al singolo progetto: barra dei
 * progetti, editor, terminale e valori predefiniti dei task.
 *
 * Le impostazioni sono globali: una postazione, una preferenza. L'unica
 * eccezione sono i default dei task e l'auto-avvio, che cambiano da repo a
 * repo e vivono dentro `Project` (vedi `projects.svelte.ts`).
 *
 * `projectRoot` e il canale di aggiornamento restano di proprieta' dei loro
 * store (`projectStore`, `studioUpdaterStore`): il centro impostazioni li
 * mostra, non li duplica.
 */

/** Come si dispongono le tessere nella barra in alto. */
export type ProjectBarOrder = 'fixed' | 'mru' | 'priority' | 'alpha';

/** Che cosa dice la tessera sui task in coda. */
export type QueueBadgeStyle = 'count-state' | 'count' | 'dot' | 'off';

/** Contenuto della tessera: sigla di due lettere o nome troncato. */
export type ProjectLabelStyle = 'initials' | 'name';

/** Sorte della coda quando si chiude un progetto che ha task in attesa. */
export type CloseWithQueuedTasks = 'ask' | 'keep' | 'discard';

/** Superficie con cui nasce un progetto nuovo. */
export type DefaultSurface = 'terminal' | 'gui';

/** Larghezza e allineamento del flusso della chat: centrata per leggibilita' o a tutta colonna. */
export type ChatWidth = 'readable' | 'full';

export type SettingsSection = 'general' | 'accessibility' | 'notifications' | 'projectBar' | 'workspace' | 'tasks' | 'models';
/** Stile del messaggio della notifica di sistema. */
export type NotificationStyle = 'brief' | 'detailed';

export interface NotificationSettings {
	/** Invio di notifiche toast del sistema operativo. */
	enabled: boolean;
	/** Stile del testo: sintetica ('OMP ha bisogno di te...') o completa (con la domanda/messaggio dell'agente). */
	style: NotificationStyle;
	/** Segnalatore visivo sull'icona dell'app (pallino rosso su Windows, badge numerico su macOS). */
	appBadge: boolean;
	/** Segnale sonoro alla notifica. */
	sound: boolean;
}

export interface AccessibilitySettings {
	/** Abilita animazioni e transizioni nell'interfaccia. */
	animations: boolean;
}

export interface ProjectBarSettings {
	order: ProjectBarOrder;
	queueBadge: QueueBadgeStyle;
	label: ProjectLabelStyle;
	/** Puntino di stato dell'agente (attention / finished) accanto alla tessera. */
	showAgentDot: boolean;
	/** Elenco dei task in coda dentro il popover della tessera. */
	showQueuePeek: boolean;
}

export interface EditorSettings {
	fontSize: number;
	/** Famiglia aggiunta in testa allo stack monospazio; vuota = solo default. */
	fontFamily: string;
	minimap: boolean;
	wordWrap: boolean;
	tabSize: number;
	lineNumbers: boolean;
}

export interface TerminalSettings {
	fontSize: number;
	fontFamily: string;
	scrollback: number;
	/** Campanello sonoro: `omp` lo emette, il guscio decide se farlo suonare. */
	bell: boolean;
	cursorBlink: boolean;
}

export interface TaskDefaults {
	role: string;
	thinkingLevel: string;
	discussionMode: boolean;
	planMode: boolean;
	minimalMode: boolean;
	researchMode: boolean;
	includeEditorContext: boolean;
}

export interface GeneralSettings {
	defaultSurface: DefaultSurface;
	closeWithQueuedTasks: CloseWithQueuedTasks;
	/** Larghezza e allineamento della chat: centrata con larghezza massima leggibile o a tutta colonna. */
	chatWidth: ChatWidth;
}

export interface StudioSettings {
	projectBar: ProjectBarSettings;
	editor: EditorSettings;
	terminal: TerminalSettings;
	taskDefaults: TaskDefaults;
	general: GeneralSettings;
	notifications: NotificationSettings;
	accessibility: AccessibilitySettings;
}

export const DEFAULT_SETTINGS: StudioSettings = {
	projectBar: {
		// `fixed` e' il default: una tessera che si sposta da sola non e' un
		// punto di riferimento. Chi vuole il vecchio comportamento sceglie `mru`.
		order: 'fixed',
		queueBadge: 'count-state',
		label: 'initials',
		showAgentDot: true,
		showQueuePeek: true
	},
	editor: {
		fontSize: 14,
		fontFamily: '',
		minimap: false,
		wordWrap: false,
		tabSize: 4,
		lineNumbers: true
	},
	terminal: {
		fontSize: 14,
		fontFamily: '',
		scrollback: 10000,
		bell: false,
		cursorBlink: true
	},
	taskDefaults: {
		role: 'default',
		thinkingLevel: 'auto',
		discussionMode: false,
		planMode: false,
		minimalMode: false,
		researchMode: false,
		includeEditorContext: true
	},
	general: {
		defaultSurface: 'terminal',
		closeWithQueuedTasks: 'ask',
		chatWidth: 'readable'
	},
	notifications: {
		enabled: true,
		style: 'brief',
		appBadge: true,
		sound: true
	},
	accessibility: {
		animations: true
	}
};

export const EDITOR_FONT_SIZE_RANGE = { min: 9, max: 28 } as const;
export const TERMINAL_FONT_SIZE_RANGE = { min: 9, max: 28 } as const;
export const SCROLLBACK_RANGE = { min: 1000, max: 200000 } as const;
export const TAB_SIZE_RANGE = { min: 2, max: 8 } as const;

function clamp(value: number, min: number, max: number, fallback: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, Math.round(value)));
}

function bool(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function str(value: unknown, fallback: string): string {
	return typeof value === 'string' ? value : fallback;
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return allowed.includes(value as T) ? (value as T) : fallback;
}

/**
 * Legge quello che c'e' su disco senza fidarsene: una versione precedente,
 * un file modificato a mano o un campo mancante non devono lasciare il guscio
 * senza impostazioni. Ogni campo assente torna al suo default.
 */
export function parseSettings(value: unknown): StudioSettings {
	const record = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
	const bar = (record.projectBar && typeof record.projectBar === 'object' ? record.projectBar : {}) as Record<string, unknown>;
	const editor = (record.editor && typeof record.editor === 'object' ? record.editor : {}) as Record<string, unknown>;
	const terminal = (record.terminal && typeof record.terminal === 'object' ? record.terminal : {}) as Record<string, unknown>;
	const tasks = (record.taskDefaults && typeof record.taskDefaults === 'object' ? record.taskDefaults : {}) as Record<string, unknown>;
	const general = (record.general && typeof record.general === 'object' ? record.general : {}) as Record<string, unknown>;
	const notif = (record.notifications && typeof record.notifications === 'object' ? record.notifications : {}) as Record<string, unknown>;
	const access = (record.accessibility && typeof record.accessibility === 'object' ? record.accessibility : {}) as Record<string, unknown>;
	const d = DEFAULT_SETTINGS;

	return {
		projectBar: {
			order: pick(bar.order, ['fixed', 'mru', 'priority', 'alpha'] as const, d.projectBar.order),
			queueBadge: pick(bar.queueBadge, ['count-state', 'count', 'dot', 'off'] as const, d.projectBar.queueBadge),
			label: pick(bar.label, ['initials', 'name'] as const, d.projectBar.label),
			showAgentDot: bool(bar.showAgentDot, d.projectBar.showAgentDot),
			showQueuePeek: bool(bar.showQueuePeek, d.projectBar.showQueuePeek)
		},
		editor: {
			fontSize: clamp(editor.fontSize as number, EDITOR_FONT_SIZE_RANGE.min, EDITOR_FONT_SIZE_RANGE.max, d.editor.fontSize),
			fontFamily: str(editor.fontFamily, d.editor.fontFamily),
			minimap: bool(editor.minimap, d.editor.minimap),
			wordWrap: bool(editor.wordWrap, d.editor.wordWrap),
			tabSize: clamp(editor.tabSize as number, TAB_SIZE_RANGE.min, TAB_SIZE_RANGE.max, d.editor.tabSize),
			lineNumbers: bool(editor.lineNumbers, d.editor.lineNumbers)
		},
		terminal: {
			fontSize: clamp(terminal.fontSize as number, TERMINAL_FONT_SIZE_RANGE.min, TERMINAL_FONT_SIZE_RANGE.max, d.terminal.fontSize),
			fontFamily: str(terminal.fontFamily, d.terminal.fontFamily),
			scrollback: clamp(terminal.scrollback as number, SCROLLBACK_RANGE.min, SCROLLBACK_RANGE.max, d.terminal.scrollback),
			bell: bool(terminal.bell, d.terminal.bell),
			cursorBlink: bool(terminal.cursorBlink, d.terminal.cursorBlink)
		},
		taskDefaults: {
			role: str(tasks.role, d.taskDefaults.role),
			thinkingLevel: str(tasks.thinkingLevel, d.taskDefaults.thinkingLevel),
			discussionMode: bool(tasks.discussionMode, d.taskDefaults.discussionMode),
			planMode: bool(tasks.planMode, d.taskDefaults.planMode),
			minimalMode: bool(tasks.minimalMode, d.taskDefaults.minimalMode),
			researchMode: bool(tasks.researchMode, d.taskDefaults.researchMode),
			includeEditorContext: bool(tasks.includeEditorContext, d.taskDefaults.includeEditorContext)
		},
		general: {
			defaultSurface: pick(general.defaultSurface, ['terminal', 'gui'] as const, d.general.defaultSurface),
			closeWithQueuedTasks: pick(general.closeWithQueuedTasks, ['ask', 'keep', 'discard'] as const, d.general.closeWithQueuedTasks),
			chatWidth: pick(general.chatWidth, ['readable', 'full'] as const, d.general.chatWidth)
		},
		notifications: {
			enabled: bool(notif.enabled, d.notifications.enabled),
			style: pick(notif.style, ['brief', 'detailed'] as const, d.notifications.style),
			appBadge: bool(notif.appBadge, d.notifications.appBadge),
			sound: bool(notif.sound, d.notifications.sound)
		},
		accessibility: {
			animations: bool(access.animations, d.accessibility.animations)
		}
	};
}

/**
 * Compone lo stack dei font: la scelta dell'utente va in testa, lo stack
 * predefinito resta dietro. Senza la coda si perderebbero le glifi Nerd Font
 * che la TUI usa per icone e powerline.
 */
export function withFontFamily(preferred: string, fallbackStack: string): string {
	const name = preferred.trim();
	if (!name) return fallbackStack;
	const quoted = /[",]/.test(name) ? name : `"${name}"`;
	return `${quoted}, ${fallbackStack}`;
}

class SettingsStore {
	projectBar = $state<ProjectBarSettings>({ ...DEFAULT_SETTINGS.projectBar });
	editor = $state<EditorSettings>({ ...DEFAULT_SETTINGS.editor });
	terminal = $state<TerminalSettings>({ ...DEFAULT_SETTINGS.terminal });
	taskDefaults = $state<TaskDefaults>({ ...DEFAULT_SETTINGS.taskDefaults });
	general = $state<GeneralSettings>({ ...DEFAULT_SETTINGS.general });
	notifications = $state<NotificationSettings>({ ...DEFAULT_SETTINGS.notifications });
	accessibility = $state<AccessibilitySettings>({ ...DEFAULT_SETTINGS.accessibility });
	/** Vero quando il disco e' stato letto: prima di allora valgono i default. */
	ready = $state(false);

	/** Stato del centro impostazioni: unica fonte, nessun secondo flag. */
	open = $state(false);
	section = $state<SettingsSection>('general');

	private store: Store | null = null;
	private initialized = false;
	private initPromise: Promise<void> | null = null;

	/**
	 * Idempotente e memoizzata: la chiamano sia il guscio all'avvio sia gli
	 * store che devono conoscere le impostazioni prima di ricostruire il
	 * proprio stato (l'ordinamento della barra dipende da qui).
	 */
	init(): Promise<void> {
		if (!this.initPromise) this.initPromise = this.load();
		return this.initPromise;
	}

	private async load() {
		try {
			this.store = await load('settings.json', { autoSave: false });
			const parsed = parseSettings(await this.store.get<unknown>('studioSettings'));
			this.projectBar = parsed.projectBar;
			this.editor = parsed.editor;
			this.terminal = parsed.terminal;
			this.taskDefaults = parsed.taskDefaults;
			this.general = parsed.general;
			this.notifications = parsed.notifications;
			this.accessibility = parsed.accessibility;
		} catch {
			// Impostazioni illeggibili: si lavora con i default, senza bloccare
			// l'avvio. Il costo di un errore qui deve restare zero.
			this.store = null;
		}
		this.initialized = true;
		this.ready = true;
	}

	private save = debounce(async () => {
		if (!this.initialized || !this.store) return;
		const snapshot: StudioSettings = {
			projectBar: $state.snapshot(this.projectBar),
			editor: $state.snapshot(this.editor),
			terminal: $state.snapshot(this.terminal),
			taskDefaults: $state.snapshot(this.taskDefaults),
			general: $state.snapshot(this.general),
			notifications: $state.snapshot(this.notifications),
			accessibility: $state.snapshot(this.accessibility),
		};
		await this.store.set('studioSettings', snapshot);
		await this.store.save();
	}, 250);

	openSection(section: SettingsSection = 'general') {
		this.section = section;
		this.open = true;
	}

	close() {
		this.open = false;
	}

	patchProjectBar(patch: Partial<ProjectBarSettings>) {
		Object.assign(this.projectBar, patch);
		this.save();
	}

	patchEditor(patch: Partial<EditorSettings>) {
		Object.assign(this.editor, patch);
		this.save();
	}

	patchTerminal(patch: Partial<TerminalSettings>) {
		Object.assign(this.terminal, patch);
		this.save();
	}

	patchTaskDefaults(patch: Partial<TaskDefaults>) {
		Object.assign(this.taskDefaults, patch);
		this.save();
	}

	patchGeneral(patch: Partial<GeneralSettings>) {
		Object.assign(this.general, patch);
		this.save();
	}

	patchNotifications(patch: Partial<NotificationSettings>) {
		Object.assign(this.notifications, patch);
		this.save();
	}

	patchAccessibility(patch: Partial<AccessibilitySettings>) {
		Object.assign(this.accessibility, patch);
		this.save();
	}

	/** Riporta ai default una sezione, o tutto se non se ne indica una. */
	reset(section?: Exclude<SettingsSection, 'models'>) {
		if (!section || section === 'projectBar') this.projectBar = { ...DEFAULT_SETTINGS.projectBar };
		if (!section || section === 'workspace') {
			this.editor = { ...DEFAULT_SETTINGS.editor };
			this.terminal = { ...DEFAULT_SETTINGS.terminal };
		}
		if (!section || section === 'tasks') this.taskDefaults = { ...DEFAULT_SETTINGS.taskDefaults };
		if (!section || section === 'general') this.general = { ...DEFAULT_SETTINGS.general };
		if (!section || section === 'notifications') this.notifications = { ...DEFAULT_SETTINGS.notifications };
		if (!section || section === 'accessibility') this.accessibility = { ...DEFAULT_SETTINGS.accessibility };
		this.save();
	}
}

export const settingsStore = new SettingsStore();
