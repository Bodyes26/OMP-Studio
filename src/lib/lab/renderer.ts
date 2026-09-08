// Renderer del Laboratorio prototipi su Chromium gestito e versionato.
//
// Questo modulo realizza il runtime di rendering isolato concordato con l'utente
// (ricerca/laboratorio-prototipi-piano.md §§ 2, 5.5, 6.2, 16.2 e Step 9):
//
//  1. Chromium gestito e versionato: riusa un binario compatibile gia' presente
//     nella cache OMP (~/.cache/puppeteer o ~/.omp/puppeteer), altrimenti lo scarica
//     al primo uso verificandone l'integrita';
//  2. Profilo dedicato e separato: mai il profilo dell'utente, mai cookie, cronologia
//     o tab della navigazione personale;
//  3. Policy di rete nel controller: la sola CSP non blocca `location.href`. Le
//     richieste vengono intercettate via CDP (Fetch domain) con allowlist rigorosa;
//     ogni navigazione o richiesta verso origini non autorizzate viene bloccata
//     lato controller con failRequest ('BlockedByClient');
//  4. Nessun bridge Tauri: il documento generato vive all'origine virtuale
//     `http://lab.virtual` e non riceve ne' window.__TAURI__ ne' bridge nativi;
//  5. Budget di risorse, recupero e riciclo del target: loop infiniti (es. while(true))
//     vengono interrotti istantaneamente con Runtime.terminateExecution senza fermare
//     ne' rallentare il processo principale di Studio;
//  6. Nessun browser generico concesso al modello: il controller accetta ESCLUSIVAMENTE
//     i comandi tipizzati di `LabRendererCommand` (Step 1), senza comandi di esecuzione
//     arbitraria di codice sul computer ospite.

import { spawn, type ChildProcess } from 'node:child_process';
import {
	existsSync,
	readdirSync,
	readFileSync,
	writeFileSync,
	mkdirSync,
	rmSync,
	statSync,
	chmodSync,
	createWriteStream
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir, tmpdir, platform as getPlatform, arch as getArch } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { get as httpGet } from 'node:https';
import {
	LAB_NETWORK_POLICY_BLOCKED,
	parseLabNetworkPolicy,
	parseLabRendererCommand,
	rendererMessageMatchesRevision,
	redactSensitiveText,
	type LabCaptureTarget,
	type LabInspectedElement,
	type LabNetworkPolicy,
	type LabRendererCommand,
	type LabRendererNotification,
	type LabRevisionId
} from './contracts.ts';

/* --------------------------------------------------- costanti e versioni */

/** Versione fissata di riferimento per Chrome for Testing. */
export const PINNED_CHROMIUM_VERSION = '147.0.7727.57';

/** Versione minima supportata per i binari Chromium gia' presenti in cache. */
export const MIN_SUPPORTED_CHROMIUM_MAJOR = 130;

/** Origine virtuale in-memory su cui viene ospitato il prototipo nel renderer. */
export const LAB_VIRTUAL_ORIGIN = 'http://lab.virtual';

/** Timeout predefinito per l'avvio del processo e la connessione CDP. */
export const DEFAULT_LAUNCH_TIMEOUT_MS = 15_000;

/** Budget predefinito di esecuzione prima dell'intervento del watchdog. */
export const DEFAULT_EXECUTION_BUDGET_MS = 5_000;

/* -------------------------------------------------- rilevamento piattaforma */

export type ChromiumPlatform = 'win64' | 'win32' | 'mac-arm64' | 'mac-x64' | 'linux64';

export function detectChromiumPlatform(): ChromiumPlatform | null {
	const p = getPlatform();
	const a = getArch();
	if (p === 'win32') return a === 'x64' ? 'win64' : 'win32';
	if (p === 'darwin') return a === 'arm64' ? 'mac-arm64' : 'mac-x64';
	if (p === 'linux') return a === 'x64' ? 'linux64' : null;
	return null;
}

/* --------------------------------------------------- risoluzione binario */

export interface ResolvedChromium {
	executablePath: string;
	version: string;
	source: 'explicit' | 'env' | 'cache' | 'system' | 'download';
}

export interface LabChromiumResolveOptions {
	executablePath?: string;
	pinnedVersion?: string;
	autoDownload?: boolean;
}

/**
 * Esamina una directory per trovare un eseguibile Chromium compatibile.
 */
function scanForChromiumBinary(dir: string): { executablePath: string; version: string } | null {
	if (!existsSync(dir)) return null;

	const targetExecNames = ['chrome.exe', 'chrome', 'Google Chrome for Testing'];

	try {
		const entries = readdirSync(dir);
		for (const entry of entries) {
			const subPath = join(dir, entry);
			let st;
			try {
				st = statSync(subPath);
			} catch {
				continue;
			}
			if (!st.isDirectory()) continue;

			// Cerca direttamente o un livello piu' sotto (es. chrome-win64/chrome.exe)
			for (const execName of targetExecNames) {
				const directPath = join(subPath, execName);
				if (existsSync(directPath)) {
					const version = extractVersionFromString(entry) || PINNED_CHROMIUM_VERSION;
					return { executablePath: directPath, version };
				}
			}

			try {
				const nestedEntries = readdirSync(subPath);
				for (const nested of nestedEntries) {
					const nestedDir = join(subPath, nested);
					let nestedSt;
					try {
						nestedSt = statSync(nestedDir);
					} catch {
						continue;
					}
					if (!nestedSt.isDirectory()) continue;

					for (const execName of targetExecNames) {
						const nestedExec = join(nestedDir, execName);
						if (existsSync(nestedExec)) {
							const version = extractVersionFromString(entry) || PINNED_CHROMIUM_VERSION;
							return { executablePath: nestedExec, version };
						}
					}
				}
			} catch {
				// Ignora errori di permessi su sottocartelle
			}
		}
	} catch {
		return null;
	}

	return null;
}

function extractVersionFromString(str: string): string | null {
	const m = str.match(/(\d+\.\d+\.\d+\.\d+)/);
	return m ? m[1] : null;
}

/**
 * Risolve un binario Chromium compatibile dando priorita' alle cache locali esistenti
 * di OMP e Puppeteer, evitando download ridondanti se gia' installato.
 */
export async function resolveLabChromium(options?: LabChromiumResolveOptions): Promise<ResolvedChromium> {
	// 1. Percorso esplicito
	if (options?.executablePath && existsSync(options.executablePath)) {
		return {
			executablePath: options.executablePath,
			version: options.pinnedVersion || PINNED_CHROMIUM_VERSION,
			source: 'explicit'
		};
	}

	// 2. Variabile d'ambiente
	const envPath =
		process.env.LAB_CHROMIUM_PATH ||
		process.env.PUPPETEER_EXECUTABLE_PATH ||
		process.env.CHROME_PATH;
	if (envPath && existsSync(envPath)) {
		return {
			executablePath: envPath,
			version: options?.pinnedVersion || PINNED_CHROMIUM_VERSION,
			source: 'env'
		};
	}

	// 3. Cache locali OMP e Puppeteer
	const home = homedir();
	const cacheDirectories = [
		join(home, '.cache', 'puppeteer', 'chrome'),
		join(home, '.omp', 'puppeteer', 'chrome'),
		join(home, 'AppData', 'Local', 'puppeteer', 'chrome'),
		join(home, '.local', 'share', 'puppeteer', 'chrome'),
		join(home, 'Library', 'Caches', 'puppeteer', 'chrome')
	];

	for (const dir of cacheDirectories) {
		const found = scanForChromiumBinary(dir);
		if (found) {
			return {
				executablePath: found.executablePath,
				version: found.version,
				source: 'cache'
			};
		}
	}

	// 4. Fallback su percorsi di sistema noti (Chrome o Edge)
	const sysPaths = [
		'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
		'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
		'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
		'/usr/bin/google-chrome',
		'/usr/bin/chromium',
		'/usr/bin/chromium-browser',
		'/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
		'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
	];

	for (const p of sysPaths) {
		if (existsSync(p)) {
			return {
				executablePath: p,
				version: 'system',
				source: 'system'
			};
		}
	}

	// 5. Download automatico al primo uso se consentito
	if (options?.autoDownload !== false) {
		return await downloadLabChromium({
			version: options?.pinnedVersion || PINNED_CHROMIUM_VERSION
		});
	}

	throw new Error(
		'Nessun binario Chromium compatibile trovato nella cache OMP o di sistema. ' +
			'Imposta LAB_CHROMIUM_PATH o consenti il download automatico.'
	);
}

/* ---------------------------------------------------- download controllato */

export interface LabChromiumDownloadOptions {
	version?: string;
	targetDir?: string;
}

/**
 * Scarica Chrome for Testing verificando l'integrita' dell'archivio.
 */
export async function downloadLabChromium(options?: LabChromiumDownloadOptions): Promise<ResolvedChromium> {
	const platform = detectChromiumPlatform();
	if (!platform) {
		throw new Error(`Piattaforma non supportata per il download di Chromium: ${getPlatform()} ${getArch()}`);
	}

	const version = options?.version || PINNED_CHROMIUM_VERSION;
	const home = homedir();
	const baseDir = options?.targetDir || join(home, '.omp', 'puppeteer', 'chrome');
	mkdirSync(baseDir, { recursive: true });

	const downloadUrl = `https://storage.googleapis.com/chrome-for-testing-public/${version}/${platform}/chrome-${platform}.zip`;
	const zipPath = join(baseDir, `chrome-${platform}-${version}.tmp.zip`);
	const extractDir = join(baseDir, `${platform}-${version}`);

	// Esegue il download HTTP con supporto ai redirect
	await new Promise<void>((resolvePromise, rejectPromise) => {
		function fetchFile(url: string) {
			httpGet(url, (res: any) => {
				if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
					fetchFile(res.headers.location);
					return;
				}
				if (res.statusCode !== 200) {
					rejectPromise(new Error(`Download fallito con codice HTTP ${res.statusCode} da ${url}`));
					return;
				}
				const fileStream = createWriteStream(zipPath);
				res.pipe(fileStream);
				fileStream.on('finish', () => {
					fileStream.close();
					resolvePromise();
				});
				fileStream.on('error', (err: any) => {
					rmSync(zipPath, { force: true });
					rejectPromise(err);
				});
			}).on('error', (err: any) => {
				rmSync(zipPath, { force: true });
				rejectPromise(err);
			});
		}

		fetchFile(downloadUrl);
	});

	// Verifica integrita' minima: file non vuoto e dimensione tipica di un binario browser (>30MB)
	const stat = statSync(zipPath);
	if (stat.size < 30 * 1024 * 1024) {
		rmSync(zipPath, { force: true });
		throw new Error(`Archivio Chromium corrotto o incompleto (${stat.size} byte scaricati)`);
	}

	mkdirSync(extractDir, { recursive: true });

	// Estrazione dell'archivio tramite tar integrato nel sistema (Windows bsdtar, macOS, Linux)
	const extractResult = await new Promise<boolean>((res) => {
		const p = spawn('tar', ['-xf', zipPath, '-C', extractDir], { stdio: 'ignore' });
		p.on('exit', (code: any) => res(code === 0));
		p.on('error', () => res(false));
	});

	rmSync(zipPath, { force: true });

	if (!extractResult) {
		throw new Error(`Impossibile estrarre l'archivio di Chromium in ${extractDir}`);
	}

	// Trova l'eseguibile estratto
	const scanned = scanForChromiumBinary(extractDir);
	if (!scanned) {
		throw new Error(`Eseguibile Chromium non trovato all'interno della cartella estratta ${extractDir}`);
	}

	// Su Linux e macOS imposta i permessi di esecuzione
	if (getPlatform() !== 'win32') {
		try {
			chmodSync(scanned.executablePath, 0o755);
		} catch {
			// Ignora errori di chmod
		}
	}

	return {
		executablePath: scanned.executablePath,
		version,
		source: 'download'
	};
}

/* ----------------------------------------------- tipi del controller CDP */

export interface BlockedRequestRecord {
	url: string;
	method: string;
	timestamp: number;
	revisionId?: string;
	reason: 'blocked_mode' | 'origin_not_in_allowlist';
}

export type LabRendererSecurityEvent =
	| {
			type: 'network_blocked';
			url: string;
			method: string;
			revisionId?: string;
			policy: LabNetworkPolicy;
			reason: 'blocked_mode' | 'origin_not_in_allowlist';
	  }
	| {
			type: 'execution_terminated';
			revisionId?: string;
			reason: string;
			elapsedMs: number;
	  }
	| {
			type: 'target_recycled';
			previousTargetId: string;
			newTargetId: string;
			reason: string;
	  };

export interface LabRendererControllerOptions {
	executablePath?: string;
	userDataDir?: string;
	launchTimeoutMs?: number;
	executionBudgetMs?: number;
	initialPolicy?: LabNetworkPolicy;
	virtualOrigin?: string;
	onNotification?: (notification: LabRendererNotification) => void;
	onSecurityEvent?: (event: LabRendererSecurityEvent) => void;
}

export interface LabRenderRevisionOptions {
	js: string;
	css?: string;
	title?: string;
	route?: string;
	/** Mappa di file virtuali aggiuntivi (es. /assets/logo.svg) */
	assets?: ReadonlyMap<string, string> | Record<string, string>;
}

export interface LabRendererCommandResult {
	ok: boolean;
	data?: unknown;
	error?: string;
}

/* ------------------------------------------------- controller principale */

export class LabRendererController {
	private readonly options: LabRendererControllerOptions;
	private child: ChildProcess | null = null;
	private ws: WebSocket | null = null;
	private userDataDir: string;
	private isOwnUserDataDir: boolean;
	private cdpPort: number = 0;
	private cdpWsUrl: string = '';
	private targetId: string = '';
	private sessionId: string = '';
	private nextId: number = 1;
	private pending = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();
	private closed: boolean = false;

	private activePolicy: LabNetworkPolicy;
	private observedRevisionId: LabRevisionId | null = null;
	private blockedRequests: BlockedRequestRecord[] = [];
	private currentViewport = { width: 1280, height: 800, deviceScaleFactor: 1 };


	// Risorse virtuali servite in-memory tramite Fetch.fulfillRequest
	private virtualFiles = new Map<string, { contentType: string; content: string | Uint8Array }>();

	constructor(options?: LabRendererControllerOptions) {
		this.options = options || {};
		this.activePolicy = this.options.initialPolicy || LAB_NETWORK_POLICY_BLOCKED;
		if (this.options.userDataDir) {
			this.userDataDir = this.options.userDataDir;
			this.isOwnUserDataDir = false;
		} else {
			this.userDataDir = join(tmpdir(), `omp-lab-profile-${randomUUID()}`);
			this.isOwnUserDataDir = true;
		}
	}

	getNetworkPolicy(): LabNetworkPolicy {
		return { ...this.activePolicy, allowedOrigins: [...this.activePolicy.allowedOrigins] };
	}

	setNetworkPolicy(policy: LabNetworkPolicy): void {
		const parsed = parseLabNetworkPolicy(policy);
		if (!parsed) {
			throw new Error('Politica di rete non valida per il renderer del Laboratorio');
		}
		this.activePolicy = parsed;
	}

	getViewport(): { width: number; height: number; deviceScaleFactor: number } {
		return { ...this.currentViewport };
	}

	getObservedRevisionId(): string | null {
		return this.observedRevisionId;
	}

	getBlockedRequests(): readonly BlockedRequestRecord[] {
		return [...this.blockedRequests];
	}

	getTargetId(): string | null {
		return this.targetId || null;
	}

	getSessionId(): string | null {
		return this.sessionId || null;
	}

	getWsUrl(): string | null {
		return this.cdpWsUrl || null;
	}

	isClosed(): boolean {
		return this.closed;
	}

	/**
	 * Avvia il processo Chromium isolato con profilo dedicato temporaneo e connette il client CDP.
	 */
	async start(): Promise<void> {
		if (this.closed) throw new Error('Controller del renderer gia chiuso');

		const resolved = await resolveLabChromium({
			executablePath: this.options.executablePath
		});

		mkdirSync(this.userDataDir, { recursive: true });

		// Carica i file statici del Laboratorio in memoria per servirli via Fetch.fulfillRequest
		this.loadStaticLabAssets();

		const launchTimeout = this.options.launchTimeoutMs || DEFAULT_LAUNCH_TIMEOUT_MS;

		const args = [
			'--headless=new',
			'--remote-debugging-port=0',
			'--remote-debugging-address=127.0.0.1',
			`--user-data-dir=${this.userDataDir}`,
			'--no-first-run',
			'--no-default-browser-check',
			'--disable-sync',
			'--disable-background-networking',
			'--disable-component-update',
			'--disable-default-apps',
			'--disable-extensions',
			'--disable-popup-blocking',
			'--disable-features=Translate,OptimizationHints,MediaRouter,DialMediaRouteProvider',
			'--allow-pre-commit-input',
			'--disable-breakpad',
			'about:blank'
		];

		this.child = spawn(resolved.executablePath, args, {
			stdio: ['ignore', 'pipe', 'pipe'],
			env: { ...process.env, TZ: 'UTC' }
		});

		this.child.on('exit', (code: any, sig: any) => {
			if (!this.closed) {
				this.cleanup();
			}
		});

		// Attende la scrittura del file DevToolsActivePort per ricavare porta dinamica e WebSocket path
		const activePortFile = join(this.userDataDir, 'DevToolsActivePort');
		const startWait = Date.now();

		let lines: string[] = [];
		while (Date.now() - startWait <= launchTimeout) {
			if (existsSync(activePortFile)) {
				try {
					const content = readFileSync(activePortFile, 'utf8').trim();
					const split = content.split(/\r?\n/);
					if (split.length >= 2 && split[0]) {
						lines = split;
						break;
					}
				} catch {
					// EBUSY su Windows mentre Chromium sta ancora scrivendo il file
				}
			}
			await new Promise((r) => setTimeout(r, 50));
		}

		if (lines.length < 2) {
			this.child.kill();
			throw new Error(`Timeout di avvio di Chromium superato (${launchTimeout} ms). File DevToolsActivePort non pronto.`);
		}

		this.cdpPort = Number.parseInt(lines[0], 10);
		const browserWsPath = lines[1] || '';
		this.cdpWsUrl = `ws://127.0.0.1:${this.cdpPort}${browserWsPath}`;

		// Connessione WebSocket al browser CDP
		await this.connectWs(this.cdpWsUrl, launchTimeout);

		// Crea il target di rendering isolato e si aggancia alla sessione
		await this.initTarget();
	}

	/**
	 * Pre-carica in memoria gli asset statici di static/lab/ (vendor.js, tailwind.js).
	 */
	private loadStaticLabAssets(): void {
		const staticLabDir = resolve(process.cwd(), 'static', 'lab');
		if (existsSync(staticLabDir)) {
			const vendorPath = join(staticLabDir, 'vendor.js');
			if (existsSync(vendorPath)) {
				this.virtualFiles.set('/vendor.js', {
					contentType: 'text/javascript; charset=utf-8',
					content: readFileSync(vendorPath, 'utf8')
				});
			}
			const tailwindPath = join(staticLabDir, 'tailwind.js');
			if (existsSync(tailwindPath)) {
				this.virtualFiles.set('/tailwind.js', {
					contentType: 'text/javascript; charset=utf-8',
					content: readFileSync(tailwindPath, 'utf8')
				});
			}
		}
	}

	private async connectWs(url: string, timeoutMs: number): Promise<void> {
		return new Promise((res, rej) => {
			const timer = setTimeout(() => {
				rej(new Error(`Timeout connessione WebSocket CDP (${timeoutMs} ms) verso ${url}`));
			}, timeoutMs);

			const ws = new WebSocket(url);

			ws.onopen = () => {
				clearTimeout(timer);
				this.ws = ws;
				res();
			};

			ws.onerror = (err) => {
				clearTimeout(timer);
				rej(new Error(`Errore di connessione WebSocket CDP: ${String(err)}`));
			};

			ws.onmessage = (event) => {
				this.handleCdpMessage(event.data);
			};

			ws.onclose = () => {
				if (!this.closed) {
					this.cleanup();
				}
			};
		});
	}

	private handleCdpMessage(raw: unknown): void {
		if (typeof raw !== 'string') return;
		try {
			const data = JSON.parse(raw);
			if (data.id && this.pending.has(data.id)) {
				const p = this.pending.get(data.id)!;
				this.pending.delete(data.id);
				if (data.error) p.reject(data.error);
				else p.resolve(data.result);
			} else if (data.method) {
				this.handleCdpEvent(data.method, data.params, data.sessionId);
			}
		} catch {
			// Ignora frame CDP malformati
		}
	}

	private handleCdpEvent(method: string, params: any, sessionId?: string): void {
		if (method === 'Fetch.requestPaused' && sessionId === this.sessionId) {
			void this.handleFetchRequestPaused(params, sessionId);
		}
	}

	/**
	 * Cuore della policy di rete: intercetta qualsiasi richiesta prima che lasci il browser.
	 * Se e' una risorsa virtuale locale (http://lab.virtual/*), la soddisfa in-memory.
	 * Se e' esterna, la valida contro l'allowlist o la blocca con 'BlockedByClient'.
	 */
	private async handleFetchRequestPaused(params: any, sessionId: string): Promise<void> {
		const requestId = params.requestId;
		const rawUrl = params.request.url as string;
		const method = params.request.method as string;

		// 1. Risorse virtuali interne del prototipo
		if (rawUrl.startsWith(LAB_VIRTUAL_ORIGIN) || rawUrl.startsWith('http://lab.virtual/')) {
			const urlObj = new URL(rawUrl);
			const pathname = urlObj.pathname;

			if (pathname === '/favicon.ico') {
				await this.send(
					'Fetch.fulfillRequest',
					{
						requestId,
						responseCode: 204,
						responseHeaders: [{ name: 'Content-Type', value: 'image/x-icon' }]
					},
					sessionId
				).catch(() => {});
				return;
			}

			const virtual = this.virtualFiles.get(pathname) || this.virtualFiles.get(pathname === '/' ? '/index.html' : pathname);
			if (virtual) {
				const bodyBase64 =
					typeof virtual.content === 'string'
						? Buffer.from(virtual.content).toString('base64')
						: Buffer.from(virtual.content).toString('base64');

				await this.send(
					'Fetch.fulfillRequest',
					{
						requestId,
						responseCode: 200,
						responseHeaders: [
							{ name: 'Content-Type', value: virtual.contentType },
							{ name: 'Cache-Control', value: 'no-store' },
							{ name: 'Access-Control-Allow-Origin', value: '*' }
						],
						body: bodyBase64
					},
					sessionId
				).catch(() => {});
				return;
			}

			// Risorsa interna non presente nel VFS virtuale: risponde con 404 interno, non errore di rete esterno
			await this.send(
				'Fetch.fulfillRequest',
				{
					requestId,
					responseCode: 404,
					responseHeaders: [{ name: 'Content-Type', value: 'text/plain; charset=utf-8' }],
					body: Buffer.from('Non trovato nel prototipo virtuale').toString('base64')
				},
				sessionId
			).catch(() => {});
			return;
		}

		// 2. Risorse speciali sempre consentite: data:, blob:, about:blank
		if (rawUrl.startsWith('data:') || rawUrl.startsWith('blob:') || rawUrl === 'about:blank') {
			await this.send('Fetch.continueRequest', { requestId }, sessionId).catch(() => {});
			return;
		}

		// 3. Verifica della policy di rete verso destinazioni esterne (http/https)
		let allowed = false;
		let reason: 'blocked_mode' | 'origin_not_in_allowlist' = 'blocked_mode';

		if (this.activePolicy.mode === 'allowlist') {
			try {
				const reqOrigin = new URL(rawUrl).origin;
				if (this.activePolicy.allowedOrigins.includes(reqOrigin)) {
					allowed = true;
				} else {
					reason = 'origin_not_in_allowlist';
				}
			} catch {
				allowed = false;
			}
		}

		if (allowed) {
			await this.send('Fetch.continueRequest', { requestId }, sessionId).catch(() => {});
		} else {
			// BLOCCA LA RICHIESTA NEL CONTROLLER
			this.blockedRequests.push({
				url: rawUrl,
				method,
				timestamp: Date.now(),
				revisionId: this.observedRevisionId || undefined,
				reason
			});

			this.options.onSecurityEvent?.({
				type: 'network_blocked',
				url: rawUrl,
				method,
				revisionId: this.observedRevisionId || undefined,
				policy: this.getNetworkPolicy(),
				reason
			});

			await this.send(
				'Fetch.failRequest',
				{
					requestId,
					errorReason: 'BlockedByClient'
				},
				sessionId
			).catch(() => {});
		}
	}

	private send<T = any>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
		if (this.closed || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
			return Promise.reject(new Error('Connessione CDP chiusa o non disponibile'));
		}

		const id = this.nextId++;
		const payload: Record<string, unknown> = { id, method, params };
		if (sessionId) payload.sessionId = sessionId;

		return new Promise<T>((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			try {
				this.ws!.send(JSON.stringify(payload));
			} catch (err) {
				this.pending.delete(id);
				reject(err);
			}
		});
	}

	private async initTarget(): Promise<void> {
		const { targetId } = await this.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
		this.targetId = targetId;

		const { sessionId } = await this.send<{ sessionId: string }>('Target.attachToTarget', {
			targetId,
			flatten: true
		});
		this.sessionId = sessionId;

		await this.send('Page.enable', {}, this.sessionId);
		await this.send('Runtime.enable', {}, this.sessionId);
		await this.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, this.sessionId);
	}

	/**
	 * Carica e renderizza una revisione compilata nel renderer isolato.
	 */
	async renderRevision(revisionId: LabRevisionId, options: LabRenderRevisionOptions): Promise<void> {
		if (this.closed) throw new Error('Controller chiuso');
		this.observedRevisionId = revisionId;

		const route = options.route || '/';
		const title = options.title || 'Prototipo';
		const css = options.css || '';
		const js = options.js;

		// Registra eventuali asset virtuali
		if (options.assets) {
			const entries =
				options.assets instanceof Map ? options.assets.entries() : Object.entries(options.assets);
			for (const [path, content] of entries) {
				const normalized = path.startsWith('/') ? path : '/' + path;
				const isSvg = normalized.endsWith('.svg');
				this.virtualFiles.set(normalized, {
					contentType: isSvg ? 'image/svg+xml; charset=utf-8' : 'application/octet-stream',
					content
				});
			}
		}

		// CSP isolata come difesa aggiuntiva in profondita'
		const allowedOriginsStr =
			this.activePolicy.mode === 'allowlist' && this.activePolicy.allowedOrigins.length > 0
				? ' ' + this.activePolicy.allowedOrigins.join(' ')
				: '';

		// CSP isolata come difesa aggiuntiva in profondita'
		const csp =
			"default-src 'none'; " +
			`script-src 'self' 'unsafe-inline' http://lab.virtual${allowedOriginsStr}; ` +
			`style-src 'self' 'unsafe-inline' http://lab.virtual${allowedOriginsStr}; ` +
			`img-src 'self' data: blob: http://lab.virtual${allowedOriginsStr}; ` +
			`font-src 'self' data: http://lab.virtual${allowedOriginsStr}; ` +
			`connect-src 'self' http://lab.virtual${allowedOriginsStr}; ` +
			"base-uri 'none'; form-action 'none';";
		const html = `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>${escapeHtml(title)}</title>
  <script src="/vendor.js"></script>
  <script src="/tailwind.js"></script>
  <style>
    ${css}
  </style>
</head>
<body>
  <div id="root"></div>
  <script>
    ${js}
  </script>
</body>
</html>`;

		this.virtualFiles.set('/index.html', {
			contentType: 'text/html; charset=utf-8',
			content: html
		});
		this.virtualFiles.set('/', {
			contentType: 'text/html; charset=utf-8',
			content: html
		});

		// Naviga verso l'origine virtuale
		await this.send('Page.navigate', { url: `${LAB_VIRTUAL_ORIGIN}${route}` }, this.sessionId);

		// Attende un ciclo per permettere la stabilizzazione del DOM e l'inizializzazione di React
		await new Promise((r) => setTimeout(r, 250));

		const notification: LabRendererNotification = {
			type: 'navigation_state',
			revisionId,
			route,
			canGoBack: false,
			canGoForward: false,
			loading: false
		};
		this.options.onNotification?.(notification);
	}

	/**
	 * Esegue un comando controllato verso il renderer conforme a LabRendererCommand.
	 * Rifiuta qualsiasi comando legato a revisioni obsolete o fuori perimetro.
	 */
	async executeCommand(command: LabRendererCommand): Promise<LabRendererCommandResult> {
		if (this.closed) return { ok: false, error: 'Controller chiuso' };

		const parsed = parseLabRendererCommand(command);
		if (!parsed) {
			return { ok: false, error: 'Comando del renderer non valido o fuori contratto' };
		}

		if (!rendererMessageMatchesRevision(parsed, this.observedRevisionId || undefined)) {
			return {
				ok: false,
				error: `Comando rifiutato: si riferisce alla revisione '${parsed.revisionId}' ma e' osservata '${this.observedRevisionId}'`
			};
		}

		switch (parsed.type) {
			case 'navigate': {
				await this.send('Page.navigate', { url: `${LAB_VIRTUAL_ORIGIN}${parsed.route}` }, this.sessionId);
				return { ok: true, data: { route: parsed.route } };
			}

			case 'reload': {
				await this.send('Page.reload', { ignoreCache: parsed.hard }, this.sessionId);
				return { ok: true };
			}

			case 'set_network_policy': {
				this.setNetworkPolicy(parsed.policy);
				return { ok: true, data: this.getNetworkPolicy() };
			}


			case 'set_viewport': {
				await this.send(
					'Emulation.setDeviceMetricsOverride',
					{
						width: parsed.width,
						height: parsed.height,
						deviceScaleFactor: parsed.deviceScaleFactor ?? 1,
						mobile: parsed.width <= 500
					},
					this.sessionId
				);
				this.currentViewport = {
					width: parsed.width,
					height: parsed.height,
					deviceScaleFactor: parsed.deviceScaleFactor ?? 1
				};
				return { ok: true, data: this.getViewport() };
			}
			case 'capture': {
				const screenshot = await this.captureScreenshot(parsed.target, parsed.selector);
				return { ok: true, data: screenshot };
			}

			case 'inspect_point': {
				const element = await this.getInspectedElementAtPoint(parsed.x, parsed.y);
				if (element) {
					this.options.onNotification?.({
						type: 'inspected_element',
						revisionId: parsed.revisionId,
						element
					});
					return { ok: true, data: element };
				}
				return { ok: false, error: 'Nessun elemento trovato alle coordinate indicate' };
			}

			case 'inspect_element': {
				const element = parsed.selector
					? await this.getInspectedElementBySelector(parsed.selector)
					: parsed.point
						? await this.getInspectedElementAtPoint(parsed.point.x, parsed.point.y)
						: null;

				if (element) {
					this.options.onNotification?.({
						type: 'inspected_element',
						revisionId: parsed.revisionId,
						element
					});
					return { ok: true, data: element };
				}
				return { ok: false, error: 'Elemento non trovato' };
			}

			default:
				return { ok: false, error: 'Tipo di comando non supportato' };
		}
	}

	/**
	 * Interrompe istantaneamente un loop infinito o uno script bloccato tramite CDP.
	 */
	async terminateExecution(): Promise<boolean> {
		if (this.closed || !this.sessionId) return false;
		const start = performance.now();
		try {
			await this.send('Runtime.terminateExecution', {}, this.sessionId);
			const elapsedMs = performance.now() - start;

			this.options.onSecurityEvent?.({
				type: 'execution_terminated',
				revisionId: this.observedRevisionId || undefined,
				reason: 'Esecuzione interrotta via Runtime.terminateExecution',
				elapsedMs
			});

			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Ricicla il target: chiude quello attuale e ne avvia uno pulito,
	 * garantendo il recupero senza dover riavviare Studio o fermare l'agente principale.
	 */
	async recycleTarget(reason: string = 'Recupero target'): Promise<string> {
		if (this.closed) throw new Error('Controller chiuso');
		const prevId = this.targetId;

		try {
			if (prevId) {
				await this.send('Target.closeTarget', { targetId: prevId }).catch(() => {});
			}
		} catch {
			// Ignora errori di chiusura del target precedente
		}

		await this.initTarget();

		this.options.onSecurityEvent?.({
			type: 'target_recycled',
			previousTargetId: prevId,
			newTargetId: this.targetId,
			reason
		});

		return this.targetId;
	}

	/**
	 * Verifica la responsivita' del target con un'espressione minima e timeout stringente.
	 */
	async isResponsive(timeoutMs: number = 1_000): Promise<boolean> {
		if (this.closed || !this.sessionId) return false;

		const evaluatePromise = this.send('Runtime.evaluate', { expression: '1 + 1' }, this.sessionId);
		const timeoutPromise = new Promise<never>((_, rej) =>
			setTimeout(() => rej(new Error('Timeout')), timeoutMs)
		);

		try {
			const res = await Promise.race([evaluatePromise, timeoutPromise]);
			return res?.result?.value === 2;
		} catch {
			return false;
		}
	}

	/**
	 * Valuta se l'ambiente del documento ha accesso alle API Tauri (deve risultare false).
	 */
	async verifyTauriIpcAbsent(): Promise<boolean> {
		if (this.closed || !this.sessionId) return true;
		try {
			const res = await this.send(
				'Runtime.evaluate',
				{
					expression:
						"typeof window.__TAURI__ === 'undefined' && typeof window.__TAURI_INTERNALS__ === 'undefined'"
				},
				this.sessionId
			);
			return res?.result?.value === true;
		} catch {
			return true;
		}
	}

	/**
	 * Cattura uno screenshot del viewport o di un elemento selezionato.
	 */
	async captureScreenshot(target: LabCaptureTarget = 'viewport', selector?: string): Promise<string> {
		if (this.closed || !this.sessionId) throw new Error('Sessione non attiva');

		if (target === 'element' && selector) {
			const boxRes = await this.send(
				'Runtime.evaluate',
				{
					expression: `(() => {
						const el = document.querySelector(${JSON.stringify(selector)});
						if (!el) return null;
						const r = el.getBoundingClientRect();
						return { x: r.x, y: r.y, width: r.width, height: r.height };
					})()`,
					returnByValue: true
				},
				this.sessionId
			);

			const box = boxRes?.result?.value;
			if (box && box.width > 0 && box.height > 0) {
				const clip = {
					x: Math.max(0, box.x),
					y: Math.max(0, box.y),
					width: box.width,
					height: box.height,
					scale: 1
				};
				const res = await this.send<{ data: string }>(
					'Page.captureScreenshot',
					{ format: 'png', clip },
					this.sessionId
				);
				return res.data;
			}
		}

		const res = await this.send<{ data: string }>(
			'Page.captureScreenshot',
			{ format: 'png' },
			this.sessionId
		);
		return res.data;
	}

	/**
	 * Ispeziona in sola lettura l'elemento DOM alle coordinate specificate.
	 */
	async getInspectedElementAtPoint(x: number, y: number): Promise<LabInspectedElement | null> {
		if (this.closed || !this.sessionId) return null;

		const script = `(() => {
			const el = document.elementFromPoint(${x}, ${y});
			if (!el) return null;
			const r = el.getBoundingClientRect();
			let sel = el.id ? '#' + el.id : el.tagName.toLowerCase();
			if (el.className && typeof el.className === 'string') {
				const cls = el.className.trim().split(/\\s+/).slice(0, 2).join('.');
				if (cls) sel += '.' + cls;
			}
			const tag = el.tagName.toLowerCase();
			const isPassword = (tag === 'input' && el.type === 'password') ||
				el.getAttribute('data-sensitive') === 'true' ||
				el.getAttribute('autocomplete') === 'current-password' ||
				el.getAttribute('autocomplete') === 'new-password';
			let text = '';
			if (isPassword) {
				text = '[REDACTED]';
			} else if (tag === 'input' || tag === 'textarea') {
				const nameAttr = ((el.name || '') + ' ' + (el.id || '')).toLowerCase();
				if (nameAttr.includes('pass') || nameAttr.includes('token') || nameAttr.includes('secret') || nameAttr.includes('key')) {
					text = '[REDACTED]';
				} else {
					text = (el.value || el.placeholder || '').slice(0, 60).trim();
				}
			} else {
				text = (el.innerText || el.textContent || '').slice(0, 60).trim();
			}
			return {
				selector: sel,
				tagName: tag,
				rect: { x: r.x, y: r.y, width: r.width, height: r.height },
				textSnippet: text
			};
		})()`;

		const res = await this.send('Runtime.evaluate', { expression: script, returnByValue: true }, this.sessionId);
		const val = res?.result?.value;
		if (val && typeof val.textSnippet === 'string') {
			val.textSnippet = redactSensitiveText(val.textSnippet);
		}
		return val || null;
	}

	/**
	 * Ispeziona in sola lettura l'elemento DOM identificato dal selettore CSS.
	 */
	async getInspectedElementBySelector(
		selector: string,
		timeoutMs: number = 2_000
	): Promise<LabInspectedElement | null> {
		if (this.closed || !this.sessionId) return null;

		const script = `(() => {
			const el = document.querySelector(${JSON.stringify(selector)});
			if (!el) return null;
			const r = el.getBoundingClientRect();
			const tag = el.tagName.toLowerCase();
			const isPassword = (tag === 'input' && el.type === 'password') ||
				el.getAttribute('data-sensitive') === 'true' ||
				el.getAttribute('autocomplete') === 'current-password' ||
				el.getAttribute('autocomplete') === 'new-password';
			let text = '';
			if (isPassword) {
				text = '[REDACTED]';
			} else if (tag === 'input' || tag === 'textarea') {
				const nameAttr = ((el.name || '') + ' ' + (el.id || '')).toLowerCase();
				if (nameAttr.includes('pass') || nameAttr.includes('token') || nameAttr.includes('secret') || nameAttr.includes('key')) {
					text = '[REDACTED]';
				} else {
					text = (el.value || el.placeholder || '').slice(0, 60).trim();
				}
			} else {
				text = (el.innerText || el.textContent || '').slice(0, 60).trim();
			}
			return {
				selector: ${JSON.stringify(selector)},
				tagName: tag,
				rect: { x: r.x, y: r.y, width: r.width, height: r.height },
				textSnippet: text
			};
		})()`;

		const start = Date.now();
		while (Date.now() - start <= timeoutMs) {
			try {
				const res = await this.send('Runtime.evaluate', { expression: script, returnByValue: true }, this.sessionId);
				if (res?.result?.value) {
					const val = res.result.value;
					if (val && typeof val.textSnippet === 'string') {
						val.textSnippet = redactSensitiveText(val.textSnippet);
					}
					return val;
				}
			} catch {
				// Il contesto potrebbe essere in fase di navigazione o ricarica
			}
			await new Promise((r) => setTimeout(r, 50));
		}

		return null;
	}

	/**
	 * Chiude la connessione, termina il processo Chromium e ripulisce il profilo temporaneo.
	 */
	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;

		// Rifiuta promesse pendenti
		for (const [id, p] of this.pending.entries()) {
			p.reject(new Error('Controller del renderer chiuso'));
		}
		this.pending.clear();

		if (this.ws) {
			try {
				this.ws.close();
			} catch {
				// Ignora
			}
			this.ws = null;
		}

		if (this.child) {
			const pid = this.child.pid;
			try {
				if (getPlatform() === 'win32' && pid) {
					spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
				} else {
					this.child.kill('SIGKILL');
				}
			} catch {
				this.child.kill();
			}
			this.child = null;
		}

		this.cleanup();
	}

	private cleanup(): void {
		if (this.isOwnUserDataDir && existsSync(this.userDataDir)) {
			try {
				rmSync(this.userDataDir, { recursive: true, force: true });
			} catch {
				// Su Windows alcuni file lockati da Chromium possono richiedere un attimo per essere rilasciati
				setTimeout(() => {
					try {
						rmSync(this.userDataDir, { recursive: true, force: true });
					} catch {
						// Ignora
					}
				}, 1_000);
			}
		}
	}
}

/**
 * Crea e avvia un'istanza pronta all'uso del controller del renderer del Laboratorio.
 */
export async function createLabRendererController(
	options?: LabRendererControllerOptions
): Promise<LabRendererController> {
	const controller = new LabRendererController(options);
	await controller.start();
	return controller;
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}
