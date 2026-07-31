import { Terminal } from '@xterm/xterm';
import { CanvasAddon } from '@xterm/addon-canvas';
import { FitAddon } from '@xterm/addon-fit';
import { LigaturesAddon } from '@xterm/addon-ligatures';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { invoke, Channel } from '@tauri-apps/api/core';

const TITLE_STATE_REGEX = /^\u03c0 ([>:!])(?: |$)/;

// Deve essere uno stack di font letterale: xterm/Monaco lo usano anche per
// `ctx.font` su canvas, dove `var(--font-mono)` e' invalido e provoca il
// fallback a un font proporzionale (glifi sfalsati e larghezze errate).
const MONO_FONT = '"BlexMono Nerd Font Propo", "BlexMono Nerd Font Mono", "BlexMono Nerd Font", "IBMPlexMono Nerd Font Propo", "JetBrainsMono Nerd Font", "CaskaydiaCove Nerd Font", "Symbols Nerd Font Mono", "Symbols Nerd Font", "Cascadia Mono", Consolas, monospace';

export class TerminalSession {
	private term: Terminal;
	private fitAddon: FitAddon;
	private container: HTMLElement;
	private ptyId: number | null = null;
	private resizeObserver: ResizeObserver;
	private resizeTimeout: number | null = null;
	private disposed = false;

	public onStateChange: (state: 'idle' | 'working' | 'attention' | 'unknown') => void = () => {};

	constructor(container: HTMLElement, cwd: string, onStateChange: (state: 'idle' | 'working' | 'attention' | 'unknown') => void) {
		this.container = container;
		this.onStateChange = onStateChange;

		this.term = new Terminal({
			allowProposedApi: true,
			fontFamily: MONO_FONT,
			fontSize: 14,
			lineHeight: 1.2,
			cursorBlink: true,
			scrollback: 10000,
			theme: {
				background: '#0C0C0C',
				foreground: '#F5F5F5',
			}
		});

		this.fitAddon = new FitAddon();
		this.term.loadAddon(this.fitAddon);
		this.term.loadAddon(new CanvasAddon());
		this.term.loadAddon(new Unicode11Addon());
		this.term.unicode.activeVersion = '11';
		this.term.loadAddon(new WebLinksAddon());
		this.term.loadAddon(new SearchAddon());
		this.term.loadAddon(new ClipboardAddon());

		this.term.open(container);

		this.term.loadAddon(new LigaturesAddon());

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

	private async startPty(cwd: string) {
		const onOutput = new Channel<Uint8Array>();
		onOutput.onmessage = (message) => {
			this.term.write(new Uint8Array(message));
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
		clearTimeout(this.resizeTimeout ?? undefined);
		if (this.ptyId !== null) {
			invoke('pty_close', { ptyId: this.ptyId }).catch(() => {});
			this.ptyId = null;
		}
		this.term.dispose();
	}
}