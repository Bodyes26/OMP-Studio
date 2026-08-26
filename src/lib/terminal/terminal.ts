import { Terminal, type ILinkProvider, type ILink } from '@xterm/xterm';
import { CanvasAddon } from '@xterm/addon-canvas';
import { FitAddon } from '@xterm/addon-fit';
import { LigaturesAddon } from '@xterm/addon-ligatures';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { invoke, Channel } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { canvasColors, onThemeChange } from '$lib/theme';
import { settingsStore, withFontFamily } from '$lib/stores/settings.svelte';
const TITLE_STATE_REGEX = /^\u03c0 ([>:!])(?: |$)/;

// Deve essere uno stack di font letterale: xterm/Monaco lo usano anche per
// `ctx.font` su canvas, dove `var(--font-mono)` e' invalido e provoca il
// fallback a un font proporzionale (glifi sfalsati e larghezze errate).
// 'Studio Mono NF' e' il Nerd bundlato via @font-face (vedi app.css): su
// macOS WebKit non disegna i glifi Private Use dei font di sistema nel
// canvas, quindi va primo; altrove resta un fallback dopo i Nerd locali.
const BUNDLED_NF = '"Studio Mono NF"';
const IS_MAC = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
const MONO_FONT = IS_MAC
	? `${BUNDLED_NF}, "BlexMono Nerd Font Propo", "BlexMono Nerd Font Mono", "BlexMono Nerd Font", "IBMPlexMono Nerd Font Propo", "JetBrainsMono Nerd Font", "CaskaydiaCove Nerd Font", "FiraCode Nerd Font Mono", "FiraCode Nerd Font", "Hack Nerd Font Mono", "Hack Nerd Font", "MesloLGS NF", "Symbols Nerd Font Mono", "Symbols Nerd Font", Menlo, monospace`
	: `"BlexMono Nerd Font Propo", "BlexMono Nerd Font Mono", "BlexMono Nerd Font", "IBMPlexMono Nerd Font Propo", "JetBrainsMono Nerd Font", "CaskaydiaCove Nerd Font", "Symbols Nerd Font Mono", "Symbols Nerd Font", "Cascadia Mono", Consolas, ${BUNDLED_NF}, monospace`;

/** Font family effettiva: la preferenza dell'utente in testa, lo stack del
 *  guscio come fallback (glifi Nerd Font per icone e powerline della TUI). */
function terminalFontFamily(): string {
	return withFontFamily(settingsStore.terminal.fontFamily, MONO_FONT);
}

export type TerminalAgentState = 'idle' | 'working' | 'attention' | 'unknown';

export interface TerminalSessionInfo {
	sessionId: string;
	sessionPath: string;
	cwd: string;
	fresh: boolean;
}

export class TerminalSession {
	private term: Terminal;
	private fitAddon: FitAddon;
	private container: HTMLElement;
	private cwd: string;
	private ptyId: number | null = null;
	private resizeObserver: ResizeObserver;
	private resizeTimeout: number | null = null;
	private disposed = false;
	private unsubscribeTheme: () => void;
	private currentState: TerminalAgentState = 'unknown';
	private pendingInputLength = 0;
	private currentSession: TerminalSessionInfo | null = null;
	/** Sessione da riprendere al primo avvio, consumata una volta sola: un
	 *  riavvio successivo deve ripartire da quella corrente, non da questa. */
	private pendingResume: string | null;
	/** Argomenti espliciti per `omp`, quando la scheda non e' una sessione di
	 *  progetto: il modal di primo avvio lancia `omp setup`. Sostituiscono del
	 *  tutto la derivazione da `cwd`/`--resume`. */
	private launchArgs: string[] | null;
	/** Contesto WebAudio per il campanello, creato al primo bell e riusato:
	 *  aprirne uno per ogni bell sarebbe inutile e piu' lento. */
	private audioCtx: AudioContext | null = null;
	/** Buffer per micro-batching dell'output PTY: aggrega i chunk ravvicinati
	 *  per ridurre le scritture su xterm e i cicli di rendering durante
	 *  flussi di streaming veloci. */
	private outputBuffer: (Uint8Array | string)[] = [];
	private outputRafId: number | null = null;
	private outputTimeoutId: number | null = null;
	private bufferedOutputBytes = 0;
	private static readonly MAX_BATCH_BYTES = 65536;

	public onStateChange: (state: TerminalAgentState) => void = () => {};
	public onOpenFile: (relPath: string, line: number | null) => void = () => {};
	public onInputPendingChange: (pending: boolean) => void = () => {};
	public onSessionChange: (session: TerminalSessionInfo | null) => void = () => {};

	constructor(
		container: HTMLElement,
		cwd: string,
		onStateChange: (state: TerminalAgentState) => void,
		onOpenFile: (relPath: string, line: number | null) => void,
		onInputPendingChange: (pending: boolean) => void,
		onSessionChange: (session: TerminalSessionInfo | null) => void,
		resumeSessionId: string | null = null,
		launchArgs: string[] | null = null
	) {
		this.pendingResume = resumeSessionId;
		this.launchArgs = launchArgs;
		this.container = container;
		this.cwd = cwd;
		this.onStateChange = onStateChange;
		this.onOpenFile = onOpenFile;
		this.onInputPendingChange = onInputPendingChange;
		this.onSessionChange = onSessionChange;

		this.term = new Terminal({
			allowProposedApi: true,
			fontFamily: terminalFontFamily(),
			fontSize: settingsStore.terminal.fontSize,
			lineHeight: 1.2,
			cursorBlink: settingsStore.terminal.cursorBlink,
			// Su macOS Option compone caratteri (Option+P = pi greco): cosi'
			// le scorciatoie Alt di omp (es. selettore modelli) non arrivano.
			// Option diventa Meta (prefisso ESC), come in iTerm2/VS Code.
			macOptionIsMeta: true,
			scrollback: settingsStore.terminal.scrollback,
			/* Solo background e foreground: i 16 colori ANSI appartengono al
			   tema di omp, il guscio non li tocca (docs/DESIGN.md §2.8). */
			theme: {
				background: canvasColors().bgSunken,
				foreground: canvasColors().ink,
			},
			linkHandler: {
				allowNonHttpProtocols: true,
				activate: (_event, text) => {
					if (text.startsWith('http://') || text.startsWith('https://')) {
						void openUrl(text);
						return;
					}
					void this.activateFileCandidate(text);
				}
			}
		});

		this.fitAddon = new FitAddon();
		this.term.loadAddon(this.fitAddon);
		try {
			this.term.loadAddon(new CanvasAddon());
		} catch (e) {
			console.warn('CanvasAddon non caricato:', e);
		}
		this.term.loadAddon(new Unicode11Addon());
		this.term.unicode.activeVersion = '11';
		this.term.loadAddon(new WebLinksAddon((_event, uri) => {
			void openUrl(uri);
		}));
		this.term.registerLinkProvider(new FileLinkProvider(this.term, (text) => {
			void this.activateFileCandidate(text);
		}));
		this.term.loadAddon(new SearchAddon());
		this.term.loadAddon(new ClipboardAddon());

		this.term.open(container);

		try {
			this.term.loadAddon(new LigaturesAddon());
		} catch (e) {
			console.warn('LigaturesAddon non caricato:', e);
		}

		// Il tema del guscio e quello della TUI cambiano insieme: qui tocca
		// solo la cornice, i 16 colori ANSI restano di omp.
		this.unsubscribeTheme = onThemeChange(() => {
			if (this.disposed) return;
			const c = canvasColors();
			this.term.options.theme = { background: c.bgSunken, foreground: c.ink };
		});

		// I webfont vengono caricati in modo asincrono: xterm misura la cella
		// prima che siano pronti, quindi va rimisurata quando lo sono.
		document.fonts.ready.then(() => {
			if (this.disposed) return;
			this.term.options.fontFamily = terminalFontFamily();
			this.fit();
		});

		this.term.onData((data) => {
			this.trackUserInput(data);
			void this.writePty(data).catch((error) => {
				console.error('Scrittura input nel PTY:', error);
			});
		});

		this.term.onResize((size) => {
			if (this.ptyId !== null) {
				invoke('pty_resize', { ptyId: this.ptyId, cols: size.cols, rows: size.rows });
			}
		});

		this.term.onTitleChange((title) => {
			const match = TITLE_STATE_REGEX.exec(title);
			const state = match
				? ({ ">": "idle", ":": "working", "!": "attention" } as const)[match[1] as ">" | ":" | "!"]
				: "unknown";
			this.currentState = state;
			if (state === 'working') this.setInputPending(0);
			this.onStateChange(state);
			if (state === 'idle') void this.refreshSessionInfo();
		});

		this.term.onBell(() => this.playBell());

		this.resizeObserver = new ResizeObserver(() => {
			clearTimeout(this.resizeTimeout ?? undefined);
			this.resizeTimeout = window.setTimeout(() => this.fit(), 50);
		});

		this.resizeObserver.observe(container);
		void this.startPty(cwd);
	}

	private async activateFileCandidate(candidate: string) {
		if (!this.cwd) return;
		try {
			const res: { rel_path: string; line: number | null } | null = await invoke('resolve_project_file', {
				projectPath: this.cwd,
				candidate
			});
			if (res && res.rel_path) {
				this.onOpenFile(res.rel_path, res.line ?? null);
			}
		} catch (err) {
			console.error('Failed to resolve project file candidate:', candidate, err);
		}
	}

	private setInputPending(length: number) {
		const wasPending = this.pendingInputLength > 0;
		this.pendingInputLength = Math.max(0, length);
		const isPending = this.pendingInputLength > 0;
		if (wasPending !== isPending) this.onInputPendingChange(isPending);
	}

	private trackUserInput(data: string) {
		const pasteStart = '\x1b[200~';
		const pasteEnd = '\x1b[201~';
		if (data.includes(pasteStart)) {
			const content = data.replaceAll(pasteStart, '').replaceAll(pasteEnd, '');
			this.setInputPending(this.pendingInputLength + Array.from(content).length);
			return;
		}
		if (data === '\r' || data === '\n' || data === '\x03' || data === '\x15') {
			this.setInputPending(0);
			return;
		}
		if (data.startsWith('\x1b')) return;

		let length = this.pendingInputLength;
		for (const character of data) {
			if (character === '\x7f' || character === '\b') length = Math.max(0, length - 1);
			else if (character >= ' ') length += 1;
		}
		this.setInputPending(length);
	}

	private async writePty(data: string) {
		if (this.ptyId === null) throw new Error('Terminale OMP non pronto');
		const encoded = new TextEncoder().encode(data);
		await invoke('pty_write', { ptyId: this.ptyId, data: Array.from(encoded) });
	}

	private async readSessionInfo() {
		if (this.ptyId === null || !this.cwd) return null;
		return invoke<TerminalSessionInfo | null>('pty_session_info', { ptyId: this.ptyId });
	}

	private updateSessionInfo(info: TerminalSessionInfo | null) {
		if (info?.sessionId === this.currentSession?.sessionId && info?.fresh === this.currentSession?.fresh) return;
		this.currentSession = info;
		this.onSessionChange(info);
	}

	private async refreshSessionInfo() {
		try {
			this.updateSessionInfo(await this.readSessionInfo());
		} catch (error) {
			console.warn('Lettura sessione terminale:', error);
		}
	}

	private async waitForSession(predicate: (info: TerminalSessionInfo) => boolean, failureMessage: string) {
		const deadline = Date.now() + 10_000;
		while (!this.disposed && Date.now() < deadline) {
			const info = await this.readSessionInfo();
			if (info && predicate(info)) {
				this.updateSessionInfo(info);
				return info;
			}
			const { promise, resolve } = Promise.withResolvers<void>();
			window.setTimeout(resolve, 100);
			await promise;
		}
		throw new Error(failureMessage);
	}

	private assertAutomationReady() {
		if (this.disposed || this.ptyId === null) throw new Error('Terminale OMP non pronto');
		if (this.currentState !== 'idle') throw new Error('OMP deve essere in attesa prima di cambiare sessione');
		if (this.pendingInputLength > 0) throw new Error('Completa o cancella il testo presente nel terminale');
	}

	/** Invia un comando slash nella scheda corrente, senza ricreare il PTY.
	 *  Il primo avvio guidato lo usa per riaprire `/setup`. Non passa dai
	 *  gate di `assertAutomationReady`: la sessione di setup non pubblica uno
	 *  stato agente e non e' una coda di task. */
	public async sendCommand(command: string) {
		if (!/^\/[a-z][a-z0-9:_-]*$/i.test(command)) throw new Error('Comando non valido');
		await this.writePty(`${command}\r`);
		this.setInputPending(0);
	}

	public async startTask(prompt: string) {
		if (!prompt.trim()) throw new Error('Il task non contiene un prompt');
		if (prompt.includes('\x1b[201~')) throw new Error('Il prompt contiene una sequenza di controllo non supportata');
		this.assertAutomationReady();
		const previous = await this.readSessionInfo();
		if (!previous) throw new Error('OMP non ha ancora pubblicato la sessione corrente');
		await this.writePty('/new\r');
		const next = await this.waitForSession(
			(info) => info.sessionId !== previous.sessionId,
			'OMP non ha confermato la nuova sessione'
		);
		await this.writePty(`\x1b[200~${prompt}\x1b[201~\r`);
		this.setInputPending(0);
		return next;
	}

	public async resumeSession(sessionId: string) {
		if (!/^[A-Za-z0-9._-]+$/.test(sessionId)) throw new Error('Identificativo sessione non valido');
		this.assertAutomationReady();
		const current = await this.readSessionInfo();
		if (current?.sessionId === sessionId) {
			this.updateSessionInfo(current);
			return current;
		}
		await this.writePty(`/resume ${sessionId}\r`);
		this.setInputPending(0);
		return this.waitForSession(
			(info) => info.sessionId === sessionId,
			'OMP non ha confermato la ripresa della sessione'
		);
	}

	private queueTerminalOutput(data: Uint8Array | string) {
		if (this.disposed) return;
		this.outputBuffer.push(data);
		this.bufferedOutputBytes += typeof data === 'string' ? data.length : data.byteLength;

		if (this.bufferedOutputBytes >= TerminalSession.MAX_BATCH_BYTES) {
			this.flushTerminalOutput();
			return;
		}

		if (this.outputRafId === null) {
			if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
				this.outputRafId = window.requestAnimationFrame(() => {
					this.outputRafId = null;
					if (this.outputTimeoutId !== null) {
						window.clearTimeout(this.outputTimeoutId);
						this.outputTimeoutId = null;
					}
					this.flushTerminalOutput();
				});
				if (this.outputTimeoutId === null) {
					this.outputTimeoutId = window.setTimeout(() => {
						this.outputTimeoutId = null;
						if (this.outputRafId !== null) {
							window.cancelAnimationFrame(this.outputRafId);
							this.outputRafId = null;
						}
						this.flushTerminalOutput();
					}, 16);
				}
			} else {
				this.flushTerminalOutput();
			}
		}
	}

	private flushTerminalOutput() {
		if (this.outputRafId !== null && typeof window !== 'undefined') {
			window.cancelAnimationFrame(this.outputRafId);
			this.outputRafId = null;
		}
		if (this.outputTimeoutId !== null && typeof window !== 'undefined') {
			window.clearTimeout(this.outputTimeoutId);
			this.outputTimeoutId = null;
		}
		if (this.disposed || this.outputBuffer.length === 0) return;

		const chunks = this.outputBuffer;
		this.outputBuffer = [];
		this.bufferedOutputBytes = 0;

		if (chunks.length === 1) {
			this.term.write(chunks[0]);
			return;
		}

		// Se tutti i chunk nel batch sono Uint8Array, concatenali in un unico buffer
		// per massimizzare la resa del parser interno di xterm e azzerare i micro-jank
		let allUint8 = true;
		let totalBytes = 0;
		for (const chunk of chunks) {
			if (chunk instanceof Uint8Array) {
				totalBytes += chunk.length;
			} else {
				allUint8 = false;
				break;
			}
		}

		if (allUint8 && totalBytes > 0) {
			const merged = new Uint8Array(totalBytes);
			let offset = 0;
			for (const chunk of chunks) {
				const arr = chunk as Uint8Array;
				merged.set(arr, offset);
				offset += arr.length;
			}
			this.term.write(merged);
			return;
		}

		for (const chunk of chunks) {
			this.term.write(chunk);
		}
	}

	private clearTerminalOutputBuffer() {
		if (this.outputRafId !== null && typeof window !== 'undefined') {
			window.cancelAnimationFrame(this.outputRafId);
			this.outputRafId = null;
		}
		if (this.outputTimeoutId !== null && typeof window !== 'undefined') {
			window.clearTimeout(this.outputTimeoutId);
			this.outputTimeoutId = null;
		}
		this.outputBuffer = [];
		this.bufferedOutputBytes = 0;
	}

	private async startPty(cwd: string) {
		const onOutput = new Channel<Uint8Array>();
		onOutput.onmessage = (message: unknown) => {
			try {
				if (message instanceof Uint8Array) {
					this.queueTerminalOutput(message);
				} else if (message instanceof ArrayBuffer) {
					this.queueTerminalOutput(new Uint8Array(message));
				} else if (Array.isArray(message) && message.every((value) => typeof value === 'number')) {
					this.queueTerminalOutput(new Uint8Array(message));
				} else if (message && typeof message === 'object' && 'data' in message && Array.isArray(message.data)) {
					this.queueTerminalOutput(new Uint8Array(message.data));
				} else if (typeof message === 'string') {
					this.queueTerminalOutput(message);
				} else {
					console.warn('Output PTY non riconosciuto:', message);
				}
			} catch (error) {
				console.error('Output PTY non renderizzabile:', error, message);
			}
		};
		const isScratchpad = cwd === '';
		const launchCwd = isScratchpad ? '.' : cwd;
		const args = this.launchArgs
			? [...this.launchArgs]
			: isScratchpad
				? ['--no-session']
				: [];

		// Il passaggio da GUI a TERMINAL deve continuare la stessa sessione:
		// senza questo `--resume` la scheda si apriva su una chat vuota e il
		// lavoro appena fatto in GUI sembrava perduto.
		const resume = this.pendingResume;
		this.pendingResume = null;
		if (!this.launchArgs && !isScratchpad && resume && /^[A-Za-z0-9._-]+$/.test(resume)) {
			args.push('--resume', resume);
		}

		try {
			this.fit();
			const cols = this.term.cols || 80;
			const rows = this.term.rows || 24;

			this.ptyId = await invoke<number>('pty_open', {
				cwd: launchCwd,
				args,
				cols,
				rows,
				onOutput
			});

			// Il fit puo' essere cambiato mentre pty_open era in volo: allora
			// onResize e' scattato con ptyId ancora null e il pty sarebbe
			// rimasto sulle dimensioni iniziali.
			if (this.term.cols !== cols || this.term.rows !== rows) {
				invoke('pty_resize', { ptyId: this.ptyId, cols: this.term.cols, rows: this.term.rows });
			}
			void this.refreshSessionInfo();
		} catch (e) {
			console.error("Failed to open PTY", e);
			this.term.write(`\r\n\x1b[31mFailed to start terminal: ${e}\x1b[0m\r\n`);
		}
	}

	public fit() {
		if (this.disposed) return;
		const { clientWidth, clientHeight } = this.container;
		// Un container nascosto o non ancora disposto misura 0: un fit in quello
		// stato produce cols/rows assurdi e taglia il contenuto.
		if (clientWidth < 2 || clientHeight < 2) return;
		try {
			this.fitAddon.fit();
		} catch (e) {
			console.error("Fit error", e);
		}
	}

	/** Riapplica a caldo le preferenze correnti, senza mai ricreare il
	 *  terminale: nessuna azione di UI puo' riavviare il PTY. */
	public applySettings() {
		if (this.disposed) return;
		this.term.options.fontFamily = terminalFontFamily();
		this.term.options.fontSize = settingsStore.terminal.fontSize;
		this.term.options.scrollback = settingsStore.terminal.scrollback;
		this.term.options.cursorBlink = settingsStore.terminal.cursorBlink;
		this.fit();
	}

	/** Il campanello ANSI (`\x07`): questa versione di xterm non espone
	 *  un'opzione di stile, solo l'evento `onBell` a cui agganciare il
	 *  suono. Un breve beep via WebAudio, solo se l'utente lo ha attivato. */
	private playBell() {
		if (this.disposed || !settingsStore.terminal.bell) return;
		try {
			if (!this.audioCtx) this.audioCtx = new AudioContext();
			const ctx = this.audioCtx;
			const oscillator = ctx.createOscillator();
			const gain = ctx.createGain();
			oscillator.type = 'sine';
			oscillator.frequency.value = 880;
			gain.gain.value = 0.05;
			oscillator.connect(gain).connect(ctx.destination);
			oscillator.start();
			oscillator.stop(ctx.currentTime + 0.08);
		} catch (error) {
			console.warn('Campanello terminale:', error);
		}
	}

	public async restart() {
		if (this.disposed) return;
		this.clearTerminalOutputBuffer();
		if (this.ptyId !== null) {
			try {
				await invoke('pty_close', { ptyId: this.ptyId });
			} catch (error) {
				console.warn('pty_close on restart:', error);
			}
			this.ptyId = null;
		}
		this.term.reset();
		this.currentState = 'unknown';
		this.setInputPending(0);
		this.updateSessionInfo(null);
		this.onStateChange('unknown');
		await this.startPty(this.cwd);
	}

	/**
	 * Rilascia soltanto il processo omp. Serve all'handoff: la superficie
	 * resta montata fino al cambio di layout, quindi disporre xterm qui
	 * attiverebbe callback degli addon su un terminale gia' distrutto.
	 */
	public async release() {
		if (this.disposed) return;
		const ptyId = this.ptyId;
		this.ptyId = null;
		if (ptyId === null) return;
		try {
			await invoke('pty_close', { ptyId });
		} catch {
			// Il processo puo' essere gia' terminato: il rilascio resta idempotente.
		}
	}

	public async close() {
		if (this.disposed) return;
		this.flushTerminalOutput();
		this.clearTerminalOutputBuffer();
		await this.release();
		this.disposed = true;
		this.unsubscribeTheme();
		clearTimeout(this.resizeTimeout ?? undefined);
		if (this.audioCtx) {
			void this.audioCtx.close().catch(() => {});
			this.audioCtx = null;
		}
		// Alcuni addon di xterm possono lanciare durante la disposizione se
		// WebView2 ha gia' rimosso i relativi listener. Il processo e' comunque
		// chiuso: la pulizia della vista non deve bloccare un handoff.
		try {
			this.term.dispose();
		} catch (error) {
			console.warn("Terminale gia' disposto:", error);
		}
	}

	public destroy() {
		void this.close();
	}
}

export function restartOmpTerminals(targetCwd?: string) {
	window.dispatchEvent(new CustomEvent('omp-terminals-restart', { detail: { targetCwd } }));
}

const FILE_TOKEN_REGEX = /(?:\[([^\s\]\r\n]+(?:#[0-9A-Fa-f]+|:[0-9]+(?:-[0-9]+)?))\]|`([^`\r\n]+)`|'([^'\r\n]+)'|"([^"\r\n]+)"|(file:\/\/\/[^\s\r\n()\[\]'"]+|file:\/\/[^\s\r\n()\[\]'"]+|[a-zA-Z]:[\\/][^\s\r\n()\[\]'"]+|\.{1,2}[\\/][^\s\r\n()\[\]'"]+|[a-zA-Z0-9_+\-.]+[\\/][^\s\r\n()\[\]'"]+|[a-zA-Z0-9_+\-.]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|jsonc|svelte|vue|html|htm|css|scss|sass|less|md|markdown|txt|rs|toml|yaml|yml|sql|cs|vb|aspx|ascx|ashx|config|xml|xaml|props|targets|resx|sh|bash|ps1|psm1|bat|cmd|py|go|cpp|c|h|hpp|java|png|jpg|jpeg|gif|svg|webp|ico|lock)(?::[0-9]+(?::[0-9]+)?)?|\.(?:gitignore|gitattributes|env[a-zA-Z0-9_.\-]*|editorconfig|npmrc)|Dockerfile|Makefile|Cargo\.lock|package-lock\.json))/g;

class FileLinkProvider implements ILinkProvider {
	constructor(
		private readonly term: Terminal,
		private readonly onActivate: (text: string) => void
	) {}

	public provideLinks(y: number, callback: (links: ILink[] | undefined) => void): void {
		const links = this.computeLinks(y);
		callback(links.length > 0 ? links : undefined);
	}

	private computeLinks(y: number): ILink[] {
		const [lines, startLineIndex] = this.getWindowedLineStrings(y - 1);
		const line = lines.join('');
		if (!line.trim()) return [];

		const results: ILink[] = [];
		const regex = new RegExp(FILE_TOKEN_REGEX.source, 'g');
		let match: RegExpExecArray | null;

		while ((match = regex.exec(line)) !== null) {
			const raw = match[0];
			let matchIdx = match.index;
			let matchLen = raw.length;
			let text = raw;

			if (match[1] !== undefined) {
				matchIdx += 1;
				matchLen = match[1].length;
				text = match[1];
			} else if (match[2] !== undefined) {
				matchIdx += 1;
				matchLen = match[2].length;
				text = match[2];
			} else if (match[3] !== undefined) {
				matchIdx += 1;
				matchLen = match[3].length;
				text = match[3];
			} else if (match[4] !== undefined) {
				matchIdx += 1;
				matchLen = match[4].length;
				text = match[4];
			}

			const trailingPunct = /([.,;:!?)]+)$/.exec(text);
			if (trailingPunct) {
				matchLen -= trailingPunct[1].length;
				text = text.slice(0, -trailingPunct[1].length);
			}

			if ((/^[a-zA-Z]+:\/\//.test(text) || text.includes('://')) && !text.startsWith('file:')) {
				continue;
			}

			if (!text.trim()) continue;

			const [startY, startX] = this.mapStrIdx(startLineIndex, 0, matchIdx);
			const [endY, endX] = this.mapStrIdx(startY, startX, matchLen);

			if (startY === -1 || startX === -1 || endY === -1 || endX === -1) {
				continue;
			}

			const range = {
				start: { x: startX + 1, y: startY + 1 },
				end: { x: endX, y: endY + 1 }
			};

			const targetText = text;
			results.push({
				range,
				text: targetText,
				activate: () => {
					this.onActivate(targetText);
				}
			});
		}

		return results;
	}

	private getWindowedLineStrings(lineIndex: number): [string[], number] {
		const buf = this.term.buffer.active;
		let line = buf.getLine(lineIndex);
		let topIdx = lineIndex;
		let bottomIdx = lineIndex;
		let length = 0;
		let content = '';
		const lines: string[] = [];

		if (line) {
			const currentContent = line.translateToString(true);

			if (line.isWrapped && currentContent[0] !== ' ') {
				length = 0;
				while (--topIdx >= 0 && (line = buf.getLine(topIdx)) && length < 2048) {
					content = line.translateToString(true);
					length += content.length;
					lines.push(content);
					if (!line.isWrapped || content.indexOf(' ') !== -1) {
						break;
					}
				}
				lines.reverse();
			}

			lines.push(currentContent);

			length = 0;
			while (++bottomIdx < buf.length && (line = buf.getLine(bottomIdx)) && line.isWrapped && length < 2048) {
				content = line.translateToString(true);
				length += content.length;
				lines.push(content);
				if (content.indexOf(' ') !== -1) {
					break;
				}
			}
		}
		return [lines, topIdx];
	}

	private mapStrIdx(lineIndex: number, rowIndex: number, stringIndex: number): [number, number] {
		const buf = this.term.buffer.active;
		const cell = buf.getNullCell();
		let start = rowIndex;
		while (stringIndex > 0) {
			const line = buf.getLine(lineIndex);
			if (!line) return [-1, -1];
			for (let i = start; i < line.length; ++i) {
				line.getCell(i, cell);
				const chars = cell.getChars();
				const width = cell.getWidth();
				if (width) {
					stringIndex -= chars.length || 1;
					if (i === line.length - 1 && chars === '') {
						const nextLine = buf.getLine(lineIndex + 1);
						if (nextLine && nextLine.isWrapped) {
							nextLine.getCell(0, cell);
							if (cell.getWidth() === 2) {
								stringIndex += 1;
							}
						}
					}
				}
				if (stringIndex <= 0) {
					return [lineIndex, i + 1];
				}
			}
			lineIndex++;
			start = 0;
		}
		return [lineIndex, start];
	}
}