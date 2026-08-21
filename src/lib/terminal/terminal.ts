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
			// Su macOS Option compone caratteri (Option+P = pi greco): cosi'
			// le scorciatoie Alt di omp (es. selettore modelli) non arrivano.
			// Option diventa Meta (prefisso ESC), come in iTerm2/VS Code.
			macOptionIsMeta: true,
			scrollback: 10000,
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


	private async startPty(cwd: string, extraArg?: string) {
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
		const args = isScratchpad ? ['--no-session'] : extraArg ? [extraArg] : [];
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
	public async restart(resumeSessionId?: string) {
		if (this.disposed) return;
		if (this.ptyId !== null) {
			try {
				await invoke('pty_close', { ptyId: this.ptyId });
			} catch (e) {
				console.warn('pty_close on restart:', e);
			}
			this.ptyId = null;
		}
		this.term.reset();
		this.onStateChange('idle');
		await this.startPty(this.cwd, resumeSessionId);
	}

	/// Riprende una sessione `omp` esistente: riavvia il PTY passando
	/// `--resume <id>` come argomento extra (stesso meccanismo dello
	/// scratchpad con `--no-session`).
	public async resumeSession(sessionId: string) {
		if (this.disposed || !sessionId) return;
		await this.restart(`--resume=${sessionId}`);
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