<script lang="ts">
	/**
	 * Primo avvio guidato (docs/PLAN.md Fase 8, docs/DECISIONS.md Gate R11).
	 *
	 * Non reimplementa l'onboarding di `omp`: lo ospita. La carta centrale e'
	 * una scheda di terminale che esegue `omp setup`, cioe' il wizard nativo
	 * con le sue scene. Studio si limita a cio' che `omp` non sa fare:
	 * installare il binario quando manca, e sapere dove stanno i progetti.
	 *
	 * La chiusura non segue il wizard, segue lo stato reale: `setupVersion`
	 * arriva a 2 anche uscendo con Esc da ogni scena, quindi chiudere su quel
	 * segnale consegnerebbe una GUI senza credenziali ne' modello.
	 */
	import { invoke } from '@tauri-apps/api/core';
	import { listen, type UnlistenFn } from '@tauri-apps/api/event';
	import { open as openDialog } from '@tauri-apps/plugin-dialog';
	import { fade } from 'svelte/transition';
	import Terminal from '$lib/terminal/Terminal.svelte';
	import { projectStore, joinProjectPath } from '$lib/stores/projects.svelte';
	import { themeStore } from '$lib/stores/theme.svelte';
	import type { TerminalSession } from '$lib/terminal/terminal';
	import AlertBanner from '$lib/components/AlertBanner.svelte';
	import { trapFocus } from '$lib/focusTrap';

	export type Step = 'install' | 'wizard' | 'project';

	let {
		open = false,
		startAt = 'wizard',
		onClose
	} = $props<{ open?: boolean; startAt?: Step; onClose?: () => void }>();

	export interface DatabaseStatus {
		name: string;
		exists: boolean;
		readable: boolean;
	}

	export interface SetupStatus {
		ompInstalled: boolean;
		ompPath: string | null;
		ompVersion: string | null;
		setupVersion: number;
		wizardPending: boolean;
		hasCredentials: boolean;
		credentialProviders: string[];
		defaultModel: string | null;
		themeDark: string | null;
		colorBlindMode: boolean;
		nerdFontInstalled: boolean;
		databases: DatabaseStatus[];
		missing: string[];
	}

	export interface InstallProgress {
		status: 'resolving' | 'downloading' | 'verifying' | 'installing' | 'done' | 'error';
		downloadedBytes: number;
		totalBytes: number;
		percentage: number;
		message: string | null;
		error: string | null;
		diagnostic?: string | null;
		retryable?: boolean;
	}

	export interface RootCandidate {
		path: string;
		repoCount: number;
		exists: boolean;
	}

	let status = $state<SetupStatus | null>(null);
	let step = $state<Step>('wizard');
	let installing = $state(false);
	let progress = $state<InstallProgress | null>(null);
	let installError = $state<string | null>(null);
	let installDiagnostic = $state<string | null>(null);
	let checkingStatus = $state(false);
	let roots = $state<RootCandidate[]>([]);
	let chosenRoot = $state<string>('');
	let repos = $state<{ name: string; path: string }[]>([]);
	let reposError = $state<string | null>(null);
	let setupSession = $state<TerminalSession | null>(null);
	let unlisten: UnlistenFn | null = null;
	let pollTimer: number | null = null;

	const REQUIREMENT_LABEL: Record<string, string> = {
		omp: 'omp non è installato',
		credentials: 'nessun provider collegato',
		model: 'nessun modello predefinito'
	};

	const ready = $derived(
		!!status && status.ompInstalled && status.hasCredentials && !!status.defaultModel
	);

	/** Il wizard nativo si è chiuso senza lasciare una configurazione usabile. */
	const wizardIncomplete = $derived(
		!!status && status.ompInstalled && !status.wizardPending && !ready
	);

	const brokenDatabases = $derived(
		status?.databases.filter((db) => db.exists && !db.readable) ?? []
	);

	async function refreshStatus() {
		checkingStatus = true;
		let next: SetupStatus;
		try {
			next = await invoke<SetupStatus>('setup_status');
		} catch (e) {
			console.error('setup_status', e);
			checkingStatus = false;
			return;
		} finally {
			checkingStatus = false;
		}

		// `ready` va letto prima di assegnare `status`: e' il valore del giro
		// precedente, ed e' quello che dice se il setup si e' appena concluso.
		const wasReady = ready;
		status = next;

		// Il passaggio di carta lo decide lo stato, non un indice: riaprire il
		// wizard su una macchina a meta' setup riprende dal punto giusto.
		if (!next.ompInstalled) {
			step = 'install';
		} else if (step === 'install') {
			step = 'wizard';
		}

		// La scena `theme` del wizard ha appena scritto `theme.dark`: il guscio
		// segue quella scelta invece di imporne una propria.
		if (!wasReady && next.hasCredentials && next.defaultModel) {
			await themeStore.adoptFromOmp();
		}
	}

	async function loadRoots() {
		try {
			roots = await invoke<RootCandidate[]>('detect_project_roots');
		} catch (e) {
			console.error('detect_project_roots', e);
			roots = [];
		}
		const best = roots[0]?.path ?? projectStore.projectRoot;
		if (best) await chooseRoot(best);
	}

	async function chooseRoot(path: string) {
		chosenRoot = path;
		reposError = null;
		try {
			const entries = await invoke<{ name: string; path: string; is_dir: boolean }[]>('tree_read', {
				projectPath: path,
				rel: ''
			});
			repos = entries
				.filter((entry) => entry.is_dir && !entry.name.startsWith('.'))
				.map((entry) => ({ name: entry.name, path: joinProjectPath(path, entry.name) }));
		} catch (e) {
			repos = [];
			reposError = String(e);
		}
	}

	async function browseRoot() {
		const selected = await openDialog({
			directory: true,
			defaultPath: chosenRoot || projectStore.projectRoot
		});
		if (typeof selected === 'string') await chooseRoot(selected);
	}

	async function runInstall() {
		if (installing) return;
		installing = true;
		installError = null;
		installDiagnostic = null;
		progress = {
			status: 'resolving',
			downloadedBytes: 0,
			totalBytes: 0,
			percentage: 0,
			message: "Cerco l'ultima release di omp",
			error: null,
			diagnostic: null,
			retryable: false
		};
		try {
			await invoke('install_omp');
			// Il font non serve a Studio (il terminale ha il suo webfont): serve
			// a `omp` in un terminale esterno, dove il preset di glifi scelto
			// nel wizard disegnerebbe tofu. Silenzioso, per-utente, non fatale.
			try {
				await invoke('install_nerd_font');
			} catch (e) {
				console.warn('Font Nerd non installato', e);
			}
			await refreshStatus();
		} catch (e) {
			installError = String(e);
			if (!installDiagnostic) {
				installDiagnostic = 'L\'installazione non è riuscita. Verifica la connessione a GitHub o che un antivirus non stia bloccando il download.';
			}
		} finally {
			installing = false;
		}
	}

	/** Riapre la sola scena provider nella scheda gia' aperta: `/setup` e'
	 *  l'alias TUI che non rimarca il setup come completo. */
	async function reopenProviderSetup() {
		try {
			await setupSession?.sendCommand('/setup');
		} catch (e) {
			console.error('Riapertura del setup provider', e);
		}
	}

	function goToProjects() {
		step = 'project';
		void loadRoots();
	}

	function finish(projectPath?: string) {
		if (chosenRoot) projectStore.setProjectRoot(chosenRoot);
		if (projectPath) projectStore.openProject(projectPath);
		onClose?.();
	}

	function formatBytes(bytes: number): string {
		if (bytes <= 0) return '0 MB';
		const mb = bytes / (1024 * 1024);
		return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
	}

	function handleKeydown(event: KeyboardEvent) {
		// Il wizard non intrappola: l'app resta usabile anche senza setup, e
		// chiuderlo e' sempre possibile. Non durante il download, che
		// perderebbe il progresso senza dirlo.
		if (open && event.key === 'Escape' && !installing) {
			event.preventDefault();
			onClose?.();
		}
	}

	$effect(() => {
		if (!open) return;

		step = startAt;
		void refreshStatus();
		// Il wizard nativo scrive `config.yml` e `agent.db` da un altro
		// processo: si rilegge lo stato a intervalli invece di osservare due
		// file scritti con lock e debounce.
		pollTimer = window.setInterval(() => void refreshStatus(), 1500);
		void listen<InstallProgress>('setup://install-progress', (event) => {
			progress = event.payload;
			if (event.payload.status === 'error') {
				installError = event.payload.error ?? 'Errore durante l\'installazione.';
				installDiagnostic = event.payload.diagnostic ?? null;
			}
		}).then((fn) => {
			unlisten = fn;
		});

		return () => {
			if (pollTimer !== null) window.clearInterval(pollTimer);
			pollTimer = null;
			unlisten?.();
			unlisten = null;
		};
	});
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="setup-backdrop"
		onclick={(e) => { if (e.target === e.currentTarget && !installing) onClose?.(); }}
		transition:fade={{ duration: 150 }}
	>
		<div
			class="setup-dialog"
			role="dialog"
			aria-modal="true"
			aria-labelledby="setup-title"
			use:trapFocus={{ onEscape: () => { if (!installing) onClose?.(); } }}
		>
			<header class="setup-head">
				<div class="titles">
				<h1 id="setup-title">Primo avvio</h1>
				<p class="subtitle">
					{#if step === 'install'}
						Studio ha bisogno di <code>omp</code>: lo installa qui, senza uscire dall'app.
					{:else if step === 'wizard'}
						Il setup qui sotto è quello di <code>omp</code>: provider, modello, glifi,
						composer, tema.
					{:else}
						Dove tieni i tuoi repository.
					{/if}
				</p>
			</div>
			<div class="head-right">
				<ol class="steps" aria-label="Avanzamento">
					<li class:done={step !== 'install'} class:current={step === 'install'}>omp</li>
					<li class:done={step === 'project'} class:current={step === 'wizard'}>setup</li>
					<li class:current={step === 'project'}>progetti</li>
				</ol>
				<button
					type="button"
					class="btn-refresh"
					onclick={() => void refreshStatus()}
					disabled={checkingStatus || installing}
					title="Aggiorna e verifica lo stato del setup"
					aria-label="Aggiorna e verifica stato configurazione"
				>
					{checkingStatus ? '...' : '↻ Verifica'}
				</button>
				<button type="button" class="quiet" onclick={() => onClose?.()} disabled={installing} aria-label="Chiudi configurazione guidata">
					Chiudi
				</button>
			</div>
		</header>

			{#if step === 'install'}
				<div class="card">
					<p class="lead">
						Il binario viene scaricato dalle release ufficiali di <code>oh-my-pi</code>, verificato
						con l'impronta SHA-256 pubblicata accanto ad esso e installato in
						<code>%LOCALAPPDATA%\omp</code>. Nessuno script remoto viene eseguito.
					</p>
					{#if progress && installing}
						<div class="progress">
							<div class="progress-track">
								<div
									class="progress-fill"
									style:transform="scaleX({Math.min(1, progress.percentage / 100)})"
								></div>
							</div>
							<p class="progress-line">
								{#if progress.status === 'downloading'}
									{formatBytes(progress.downloadedBytes)} di {formatBytes(progress.totalBytes)} ({progress.percentage.toFixed(0)}%)
								{:else}
									{progress.message ?? progress.status}
								{/if}
							</p>
						</div>
					{/if}

					{#if installError}
						<AlertBanner
							variant="error"
							title="Installazione di OMP interrotta"
							message={installError}
							diagnostic={installDiagnostic ?? undefined}
							onRetry={runInstall}
							retryLabel="Riprova installazione"
						/>
					{/if}

					<div class="actions">
						<button type="button" class="primary" onclick={runInstall} disabled={installing}>
							{installing ? 'Installazione in corso...' : 'Installa omp'}
						</button>
					</div>
				</div>
			{:else if step === 'wizard'}
				<div class="terminal-card">
					<Terminal cwd={''} launchArgs={['setup']} sessionRef={(s) => (setupSession = s)} />
				</div>
				<footer class="setup-foot">
					{#if ready}
						<p class="ok">
							<span class="dot" aria-hidden="true"></span>
							{status?.credentialProviders.length ?? 0} provider collegati, modello
							<code>{status?.defaultModel}</code>
						</p>
						<button type="button" class="primary" onclick={goToProjects}>Continua</button>
					{:else if wizardIncomplete}
						<div class="incomplete-banner-wrap">
							<AlertBanner
								variant="warning"
								title="Setup incompleto"
								message="Il wizard nativo si è chiuso prima di completare i requisiti minimi."
								diagnostic={status?.missing?.length ? `Requisiti mancanti: ${status.missing.map(m => REQUIREMENT_LABEL[m] ?? m).join(', ')}` : undefined}
								actions={[
									{ label: 'Riapri setup provider', onClick: reopenProviderSetup, variant: 'primary' },
									{ label: 'Verifica stato', onClick: () => void refreshStatus(), variant: 'secondary' }
								]}
							/>
						</div>
					{:else}
						<p class="hint">
							Completa le scene qui sopra. Studio si accorge da solo di quando hai finito.
						</p>
					{/if}
				</footer>
			{:else}
				<div class="card">
					{#if roots.length > 0}
						<ul class="roots">
							{#each roots as candidate (candidate.path)}
								<li>
									<button
										type="button"
										class="root"
										class:selected={candidate.path === chosenRoot}
										onclick={() => chooseRoot(candidate.path)}
									>
										<span class="root-path">{candidate.path}</span>
										<span class="root-count">{candidate.repoCount} repository</span>
									</button>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="lead">
							Nessuna cartella di repository trovata nei percorsi soliti. Scegline una.
						</p>
					{/if}

					<div class="actions">
						<button type="button" onclick={browseRoot}>Sfoglia…</button>
						<button type="button" class="primary" onclick={() => finish()} disabled={!chosenRoot}>
							Usa questa cartella
						</button>
					</div>

					{#if reposError}
						<AlertBanner
							variant="error"
							title="Errore lettura cartella"
							message={reposError}
							onRetry={() => (chosenRoot ? void chooseRoot(chosenRoot) : void loadRoots())}
							retryLabel="Riprova lettura"
						/>
					{:else if repos.length > 0}
						<p class="repos-title">Apri subito un progetto</p>
						<ul class="repos">
							{#each repos as repo (repo.path)}
								<li>
									<button type="button" class="repo" onclick={() => finish(repo.path)}>
										{repo.name}
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/if}

			{#if brokenDatabases.length > 0}
				<div class="broken-db-wrap">
					<AlertBanner
						variant="warning"
						title="Database OMP non leggibili"
						message={`Database danneggiati o non accessibili: ${brokenDatabases.map((db) => db.name).join(', ')}. Storico e statistiche resteranno vuoti.`}
						diagnostic="Verifica i permessi di lettura della cartella ~/.omp/agent o l'integrità dei file SQLite."
					/>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.setup-backdrop {
		position: fixed;
		inset: 0;
		z-index: var(--z-dialog);
		display: grid;
		place-items: center;
		background: var(--backdrop);
		padding: var(--space-6);
	}

	.setup-dialog {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		width: min(980px, 100%);
		height: min(680px, 100%);
		padding: var(--space-5);
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-overlay);
	}

	.setup-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-4);
	}

	.head-right {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	h1 {
		margin: 0;
		font-size: var(--text-xl);
		font-weight: 650;
		color: var(--ink);
	}

	.subtitle {
		margin: var(--space-1) 0 0;
		max-width: 62ch;
		font-size: var(--text-base);
		color: var(--ink-muted);
	}

	.steps {
		display: flex;
		gap: var(--space-3);
		margin: 0;
		padding: 0;
		list-style: none;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--ink-faint);
	}

	.steps .done {
		color: var(--ink-muted);
	}

	.steps .current {
		color: var(--brand-ink);
	}

	.btn-refresh {
		padding: 3px 8px;
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		cursor: pointer;
		transition: color 0.12s ease, border-color 0.12s ease;
	}

	.btn-refresh:hover:not(:disabled) {
		color: var(--ink);
		border-color: var(--line-strong);
	}

	.btn-refresh:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.card {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: var(--space-3);
		min-height: 0;
		overflow-y: auto;
	}

	.lead {
		margin: 0;
		max-width: 68ch;
		font-size: var(--text-base);
		line-height: 1.55;
		color: var(--ink-muted);
	}

	/* Il terminale e' il contenuto: nessun padding decorativo, nessuna
	   sovrapposizione sopra la viewport. */
	.terminal-card {
		position: relative;
		flex: 1;
		min-height: 0;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.setup-foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		min-height: 32px;
	}

	.incomplete-banner-wrap {
		width: 100%;
	}

	.broken-db-wrap {
		margin-top: var(--space-2);
	}

	.hint,
	.ok {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--ink-faint);
	}

	.ok {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--ink-muted);
	}

	.dot {
		width: 6px;
		height: 6px;
		border-radius: var(--radius-full);
		background: var(--brand);
	}

	.progress {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.progress-track {
		height: 4px;
		background: var(--bg-hover);
		border-radius: var(--radius-full);
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		width: 100%;
		background: var(--brand);
		transform-origin: left;
		transition: transform var(--dur-base) var(--ease-out);
	}

	.progress-line {
		margin: var(--space-1) 0 0;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.actions {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		margin-top: var(--space-2);
	}

	button {
		padding: var(--space-2) var(--space-4);
		font-family: var(--font-ui);
		font-size: var(--text-base);
		color: var(--ink);
		background: var(--bg-raised);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: background var(--dur-fast) var(--ease-out);
	}

	button:hover:not(:disabled) {
		background: var(--bg-hover);
	}

	button:disabled {
		opacity: 0.5;
		cursor: default;
	}

	button.primary {
		color: var(--on-brand);
		background: var(--brand);
		border-color: transparent;
	}

	button.primary:hover:not(:disabled) {
		background: var(--brand-ink);
	}

	button.quiet {
		padding: var(--space-1) var(--space-2);
		font-size: var(--text-sm);
		color: var(--ink-faint);
		background: transparent;
		border-color: transparent;
	}

	.roots,
	.repos {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.roots {
		flex-direction: column;
		flex-wrap: nowrap;
	}

	.root {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-4);
		width: 100%;
		text-align: left;
	}

	.root.selected {
		border-color: var(--brand);
	}

	.root-path {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
	}

	.root-count {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		white-space: nowrap;
	}

	.repos-title {
		margin: var(--space-2) 0 0;
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.repo {
		padding: var(--space-1) var(--space-3);
		font-family: var(--font-mono);
		font-size: var(--text-sm);
	}

	code {
		font-family: var(--font-mono);
		font-size: 0.92em;
		color: var(--ink);
	}
</style>
