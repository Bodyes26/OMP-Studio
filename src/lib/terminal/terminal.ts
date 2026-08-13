import { Terminal } from '@xterm/xterm';
import { CanvasAddon } from '@xterm/addon-canvas';
import { FitAddon } from '@xterm/addon-fit';
import { LigaturesAddon } from '@xterm/addon-ligatures';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { invoke, Channel } from '@tauri-apps/api/core';
import { canvasColors, onThemeChange } from '$lib/theme';

const TITLE_STATE_REGEX = /^\u03c0 ([>:!])(?: |$)/;

// Deve essere uno stack di font letterale: xterm/Monaco lo usano anche per
// `ctx.font` su canvas, dove `var(--font-mono)` e' invalido e provoca il
// fallback a un font proporzionale (glifi sfalsati e larghezze errate).
const MONO_FONT = '"BlexMono Nerd Font Propo", "BlexMono Nerd Font Mono", "BlexMono Nerd Font", "IBMPlexMono Nerd Font Propo", "JetBrainsMono Nerd Font", "CaskaydiaCove Nerd Font", "Symbols Nerd Font Mono", "Symbols Nerd Font", "Cascadia Mono", Consolas, monospace';

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

	public onStateChange: (state: 'idle' | 'working' | 'attention' | 'unknown') => void = () => {};
	public onOpenFile: (relPath: string, line: number | null) => void = () => {};

	constructor(
		container: HTMLElement,
		cwd: string,
		onStateChange: (state: 'idle' | 'working' | 'attention' | 'unknown') => void,
		onOpenFile: (relPath: string, line: number | null) => void
	) {
		this.container = container;
		this.cwd = cwd;
		this.onStateChange = onStateChange;
		this.onOpenFile = onOpenFile;

		this.term = new Terminal({
			allowProposedApi: true,
			fontFamily: MONO_FONT,
			fontSize: 14,
			lineHeight: 1.2,
			cursorBlink: true,
			scrollback: 10000,
			/* Solo background e foreground: i 16 colori ANSI appartengono al
			   tema di omp, il guscio non li tocca (docs/DESIGN.md §2.8). */
			theme: {
				background: canvasColors().bgSunken,
				foreground: canvasColors().ink,
			},
			linkHandler: {
				allowNonHttpProtocols: true,
				activate: (event, text) => this.openFileLink(event, text)
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
		this.term.loadAddon(new WebLinksAddon());
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
			this.term.options.fontFamily = MONO_FONT;
			this.fit();
		});

		this.term.onData((data) => {
			if (this.ptyId !== null) {
				const encoded = new TextEncoder().encode(data);
				invoke('pty_write', { ptyId: this.ptyId, data: Array.from(encoded) });
			}
		});

		this.term.onResize((size) => {
			if (this.ptyId !== null) {
				invoke('pty_resize', { ptyId: this.ptyId, cols: size.cols, rows: size.rows });
			}
		});

		this.term.onTitleChange((title) => {
			const m = TITLE_STATE_REGEX.exec(title);
			const state = m ? ({ ">": "idle", ":": "working", "!": "attention" } as const)[m[1] as ">"|":"|"!"] : "unknown";
			this.onStateChange(state);
		});

		this.resizeObserver = new ResizeObserver(() => {
			clearTimeout(this.resizeTimeout ?? undefined);
			this.resizeTimeout = window.setTimeout(() => this.fit(), 50);
		});

		this.resizeObserver.observe(container);
		
		this.startPty(cwd);
	}

	private openFileLink(event: MouseEvent, text: string) {
		if ((!event.ctrlKey && !event.metaKey) || !text.startsWith('file://')) return;

		let url: URL;
		try {
			url = new URL(text);
		} catch {
			return;
		}
		if (url.protocol !== 'file:') return;

		let filePath: string;
		try {
			filePath = decodeURIComponent(url.pathname);
		} catch {
			return;
		}
		if (/^\/[A-Za-z]:\//.test(filePath)) filePath = filePath.slice(1);

		const normFilePath = this.normalizePath(filePath);
		const normProjectPath = this.normalizePath(this.cwd);
		if (!normFilePath || !normProjectPath || normFilePath.includes('\0')) return;

		const projectPrefix = normProjectPath.endsWith('/') ? normProjectPath : `${normProjectPath}/`;
		const isWindows = normFilePath.includes(':');
		const fileCmp = isWindows ? normFilePath.toLowerCase() : normFilePath;
		const projCmp = isWindows ? projectPrefix.toLowerCase() : projectPrefix;

		if (!fileCmp.startsWith(projCmp)) return;

		const relativePath = normFilePath.slice(projectPrefix.length);
		if (!relativePath || relativePath.split('/').some((part) => part === '.' || part === '..')) return;

		const requestedLine = Number(url.searchParams.get('line'));
		const line = Number.isInteger(requestedLine) && requestedLine > 0 ? requestedLine : null;
		this.onOpenFile(relativePath, line);
	}

	private normalizePath(path: string) {
		return path.replace(/\\/g, '/').replace(/\/+$/, '');
	}

	private async startPty(cwd: string) {
		const onOutput = new Channel<Uint8Array>();
		onOutput.onmessage = (message: any) => {
			try {
				if (message instanceof Uint8Array) {
					this.term.write(message);
				} else if (message instanceof ArrayBuffer) {
					this.term.write(new Uint8Array(message));
				} else if (Array.isArray(message)) {
					this.term.write(new Uint8Array(message));
				} else if (message && typeof message === 'object' && 'data' in message) {
					this.term.write(new Uint8Array(message.data));
				} else if (typeof message === 'string') {
					this.term.write(message);
				} else {
					this.term.write(new Uint8Array(message));
				}
			} catch (err) {
				console.error("Error writing PTY output to xterm:", err, message);
			}
		};

		const isScratchpad = cwd === '';
		const args = isScratchpad ? ['--no-session'] : [];
		const launchCwd = isScratchpad ? '.' : cwd;

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

	public destroy() {
		this.disposed = true;
		this.resizeObserver.disconnect();
		this.unsubscribeTheme();
		clearTimeout(this.resizeTimeout ?? undefined);
		if (this.ptyId !== null) {
			invoke('pty_close', { ptyId: this.ptyId }).catch(() => {});
			this.ptyId = null;
		}
		this.term.dispose();
	}
}