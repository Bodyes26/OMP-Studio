<!--
  SetupExperience.svelte — la finestra grafica del primo avvio (SET-001…017).

  Sopra la rovina in caratteri ASCII, una finestra 880×600 con l'indice dei passi a
  sinistra, il passo al centro e il piede in basso. Al primo avvio l'ingresso è lungo
  (la rovina si compone, poi la finestra sale); quando la finestra riapre perché manca
  un pezzo o perché la si chiama dal chip, compare subito e si apre sul passo mancante
  con gli altri segnati come fatti (SET-020).

  La finestra non fa il lavoro: lo chiede allo store (`setupFlow`), che è anche il
  posto in cui la pagina legge se il setup è completo. Così la stessa verità vale per
  la barra, per lo stato vuoto e per questa superficie.
-->
<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { motionReduced } from '#lib/agent/motionState.svelte.ts';
	import { trapFocus } from '#lib/focusTrap.ts';
	import Terminal from '#lib/terminal/Terminal.svelte';
	import { IconChevronLeft, IconTerminal, IconWarning } from '#lib/icons.ts';
	import { SETUP_STEPS, setupFlow, type SetupStepId } from '#lib/stores/setupFlow.svelte.ts';
	import { T_DEVELOP_END } from './ruin.ts';
	import RuinBackdrop from './RuinBackdrop.svelte';
	import SetupStepIndex from './SetupStepIndex.svelte';
	import EngineStep from './EngineStep.svelte';
	import AppearanceStep from './AppearanceStep.svelte';
	import UpdatesStep from './UpdatesStep.svelte';
	import ProjectsStep from './ProjectsStep.svelte';
	import GithubStep from './GithubStep.svelte';
	import SummaryStep from './SummaryStep.svelte';
	import ProvidersStep from './ProvidersStep.svelte';
	import RolesStep from './RolesStep.svelte';
	import { saveRoles } from './setupRoles.ts';
	import './setup.css';

	let { onClose }: { onClose: () => void } = $props();

	const WIN_W = 880;
	const WIN_H = 600;

	type Confirm = null | 'exit' | 'tui';

	let confirm = $state<Confirm>(null);
	let windowVisible = $state(setupFlow.mode !== 'first');
	let leaving = $state(false);
	let browsing = $state(false);
	let savingRoles = $state(false);
	let scale = $state(1);
	let skipRuin: (() => void) | null = null;
	/** Vero se omp era già usabile quando si è passati alla TUI (SET-004). */
	let tuiWasUsable = false;

	const reduced = $derived(motionReduced());
	const longIntro = $derived(setupFlow.mode === 'first' && !reduced);
	const idx = $derived(setupFlow.stepIndex);
	const step = $derived(setupFlow.step);
	const status = $derived(setupFlow.status);

	const primaryLabel = $derived.by(() => {
		if (step === 'summary') return m.setup2_btn_enter_studio();
		if (step === 'github' && !setupFlow.githubSkipped) return m.setup2_btn_skip();
		return m.setup2_btn_continue();
	});

	/** Cosa manca perché il passo possa dirsi fatto. */
	const canContinue = $derived.by(() => {
		if (step === 'engine') return setupFlow.engine.phase === 'ready';
		if (step === 'providers') return setupFlow.connectedProviders.length > 0 || (status?.hasCredentials ?? false);
		if (step === 'roles') return !!status?.defaultModel || Object.keys(setupFlow.rolePicks).length > 0;
		return true;
	});

	const missingNotices = $derived.by(() => {
		if (setupFlow.mode !== 'return') return [] as string[];
		const list: string[] = [];
		if (setupFlow.blockingMissing.includes('omp') && step === 'engine') {
			list.push(
				status?.ompBroken
					? m.setup2_notice_engine_broken({ path: status.ompBrokenPath ?? 'omp' })
					: m.setup2_notice_engine_missing()
			);
		}
		if (setupFlow.blockingMissing.includes('credentials') && step === 'providers') {
			list.push(m.setup2_notice_providers_missing());
		}
		if (setupFlow.blockingMissing.includes('model') && step === 'roles') {
			list.push(m.setup2_notice_roles_missing());
		}
		return list;
	});

	// La finestra sta intera anche su uno schermo piccolo: si scala, non si taglia.
	$effect(() => {
		const fit = () => {
			scale = Math.min(1, (window.innerWidth - 40) / WIN_W, (window.innerHeight - 40) / WIN_H);
		};
		fit();
		window.addEventListener('resize', fit);
		return () => window.removeEventListener('resize', fit);
	});

	// L'ingresso lungo è finito quando la rovina ha finito di svilupparsi: la
	// finestra sale sopra il fotogramma finale (SET-003). Il tempo lo misura la
	// scena, che parte quando le immagini sono pronte; il timeout è solo la rete
	// di sicurezza se le immagini non arrivano.
	let riseTimer: number | null = null;
	function scheduleRise() {
		if (riseTimer !== null || windowVisible) return;
		riseTimer = window.setTimeout(() => {
			riseTimer = null;
			windowVisible = true;
		}, Math.max(0, T_DEVELOP_END - 250));
	}

	$effect(() => {
		if (!longIntro || windowVisible) return;
		const fallback = window.setTimeout(() => {
			riseTimer = null;
			windowVisible = true;
		}, T_DEVELOP_END + 900);
		return () => {
			window.clearTimeout(fallback);
			if (riseTimer !== null) window.clearTimeout(riseTimer);
			riseTimer = null;
		};
	});

	$effect(() => {
		if (!longIntro) windowVisible = true;
	});

	// Un clic o un tasto saltano l'ingresso; il listener esiste solo mentre serve.
	$effect(() => {
		if (windowVisible) return;
		const skip = () => {
			skipRuin?.();
			windowVisible = true;
		};
		window.addEventListener('keydown', skip, { once: true });
		window.addEventListener('pointerdown', skip, { once: true });
		return () => {
			window.removeEventListener('keydown', skip);
			window.removeEventListener('pointerdown', skip);
		};
	});

	// Esc chiede conferma; con una conferma già aperta la chiude (SET-041).
	$effect(() => {
		if (!windowVisible || setupFlow.phase !== 'setup') return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			e.preventDefault();
			confirm = confirm ? null : 'exit';
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	// Il passo Motore avvia il download da solo quando omp manca: è il pezzo più
	// lento e deve partire durante l'ingresso (SET-010).
	$effect(() => {
		const engine = setupFlow.engine;
		if (engine.phase !== 'checking' || setupFlow.status === null) return;
		const s = setupFlow.status;
		if (!s.ompInstalled && !s.ompBroken) void setupFlow.runEngineJob('install');
	});

	/** Conferma il passo e passa al primo non ancora fatto. */
	async function goNext() {
		if (!canContinue || savingRoles) return;
		if (step === 'summary') {
			await finish();
			return;
		}
		if (step === 'github' && !setupFlow.githubSkipped) setupFlow.githubSkipped = true;

		// I ruoli si scrivono qui, non nel passo: il passo sceglie, il guscio
		// salva una volta sola quando l'utente conferma (contratto setupRoles).
		if (step === 'roles') {
			savingRoles = true;
			try {
				// La proposta si rilegge qui invece di fidarsi di quella mostrata:
				// fra la card e «Continua» il catalogo può essere cambiato.
				await setupFlow.proposeRoles();
				await saveRoles(setupFlow.rolePicks, setupFlow.roleProposal);
				const next = await setupFlow.readStatus();
				if (next) setupFlow.status = next;
			} catch (e) {
				console.error('Salvataggio dei ruoli', e);
			} finally {
				savingRoles = false;
			}
		}

		const next = SETUP_STEPS.slice(idx + 1).find((id) => !setupFlow.done.includes(id)) ?? 'summary';
		await setupFlow.markStepDone(step, next);
	}

	function goBack() {
		if (idx === 0) return;
		setupFlow.step = SETUP_STEPS[idx - 1];
	}

	/** «Entra in Studio»: setup completo, uscita animata, poi lo stato vuoto. */
	async function finish() {
		leaving = true;
		await setupFlow.complete();
		setupFlow.phase = 'done';
		window.setTimeout(
			() => {
				setupFlow.open = false;
				onClose();
			},
			reduced ? 0 : 480
		);
	}

	function navigate(target: SetupStepId) {
		if (target === setupFlow.step) return;
		if (!setupFlow.done.includes(target) && target !== setupFlow.firstOpenStep) return;
		setupFlow.step = target;
	}

	async function openTui() {
		confirm = null;
		setupFlow.phase = 'tui';
		// Lo stato di partenza va fotografato: se omp era già usabile, il primo
		// giro del polling non deve far credere che la TUI abbia appena finito.
		const current = setupFlow.status;
		tuiWasUsable =
			!!current && current.ompInstalled && !current.ompBroken && current.hasCredentials && !!current.defaultModel;
	}

	/** Studio riconosce la fine della TUI dallo stato reale (SET-004). */
	$effect(() => {
		if (setupFlow.phase !== 'tui') return;
		const timer = window.setInterval(() => {
			void setupFlow.readStatus().then(async (s) => {
				if (!s) return;
				const usable = s.ompInstalled && !s.ompBroken && s.hasCredentials && !!s.defaultModel;
				// Serve un passaggio vero: da «manca qualcosa» a «usabile». Se lo era
				// già, la TUI sta solo mostrando un setup facoltativo.
				if (!usable || tuiWasUsable) return;
				await setupFlow.complete();
				setupFlow.phase = 'done';
				window.setTimeout(() => {
					setupFlow.open = false;
					onClose();
				}, reduced ? 0 : 320);
			});
		}, 1500);
		return () => window.clearInterval(timer);
	});

	function exitSetup() {
		confirm = null;
		void setupFlow.saveProgress(step, false);
		setupFlow.close();
		onClose();
	}

	function onProviderConnected(ids: string[]) {
		setupFlow.connectedProviders = ids;
	}
</script>

<div class="experience">
	<RuinBackdrop
		{reduced}
		intro={longIntro}
		dimmed={setupFlow.phase === 'done' || setupFlow.phase === 'tui'}
		onSkipHandle={(skip) => (skipRuin = skip)}
		onReady={scheduleRise}
	/>

	{#if !windowVisible && longIntro}
		<p class="skip-hint su-meta">{m.setup2_intro_skip_hint()}</p>
	{/if}

	{#if windowVisible && (setupFlow.phase === 'setup' || leaving)}
		<div class="stage">
			<div style:transform="scale({scale})" style:transform-origin="center">
				<div
					class="window"
					class:su-rise={longIntro && !leaving}
					class:su-rise-short={!longIntro && !leaving}
					class:su-leave={leaving}
					role="dialog"
					aria-modal="true"
					aria-labelledby="setup-title"
					use:trapFocus={{}}
				>
					<SetupStepIndex onNavigate={navigate} />

					<main class="content">
						<header class="head">
							<div class="head-row">
								<span class="su-meta counter">
									{m.setup2_step_counter({ current: idx + 1, total: SETUP_STEPS.length })}
									{#if step === 'github'}
										· {m.setup2_step_optional()}
									{/if}
								</span>
								<button type="button" class="ui-button ui-button-ghost ui-button-sm exit" onclick={() => (confirm = 'exit')}>
									{m.setup2_exit()} <span class="ui-kbd">Esc</span>
								</button>
							</div>
							<h2 id="setup-title" class="su-title title">{m.setup2_title()}</h2>
							{#each missingNotices as notice (notice)}
								<div class="trace">
									<span class="trace-icon" aria-hidden="true"><IconWarning /></span>
									<span class="su-trace">{notice}</span>
								</div>
							{/each}
						</header>

						<div class="su-scroll body">
							<!-- La chiave rimonta il contenuto al cambio passo: `rv-lift` è un
							     ingresso, non una transizione, e senza rimontaggio non riparte. -->
							{#key step}
								<div class="rv-lift">
									{#if step === 'engine'}
										<EngineStep />
									{:else if step === 'providers'}
										<ProvidersStep onConnectedChange={onProviderConnected} />
									{:else if step === 'roles'}
										{#if setupFlow.connectedProviders.length > 0 || (status?.hasCredentials ?? false)}
											<RolesStep
												connected={setupFlow.connectedProviders.length > 0 ? setupFlow.connectedProviders : (status?.credentialProviders ?? [])}
												bind:picks={setupFlow.rolePicks}
											/>
										{:else}
											<div class="trace">
												<span class="trace-icon attention" aria-hidden="true"></span>
												<span class="su-trace">{m.setup2_roles_need_provider()}</span>
											</div>
										{/if}
									{:else if step === 'appearance'}
										<AppearanceStep />
									{:else if step === 'updates'}
										<UpdatesStep />
									{:else if step === 'projects'}
										<ProjectsStep onBrowseState={(busy) => (browsing = busy)} />
									{:else if step === 'github'}
										<GithubStep />
									{:else if step === 'summary'}
										<SummaryStep onEdit={navigate} />
									{/if}
								</div>
							{/key}
						</div>

						<footer class="foot">
							<button type="button" class="ui-link quiet su-meta tui" onclick={() => (confirm = 'tui')}>
								<IconTerminal /> {m.setup2_tui_link()}
							</button>
							<span class="spacer"></span>
							{#if idx > 0}
								<button type="button" class="ui-button ui-button-ghost" onclick={goBack}>
									<IconChevronLeft /> {m.setup2_btn_back()}
								</button>
							{/if}
							<button
								type="button"
								class="ui-button primary"
								class:ui-button-primary={primaryLabel !== m.setup2_btn_skip()}
								class:ui-button-secondary={primaryLabel === m.setup2_btn_skip()}
								disabled={!canContinue || browsing || savingRoles}
								onclick={() => void goNext()}
							>
								{primaryLabel}
							</button>
						</footer>
					</main>

					{#if confirm}
						<div
							class="confirm-layer"
							role="presentation"
							onclick={(e) => {
								if (e.target === e.currentTarget) confirm = null;
							}}
						>
							<div class="confirm-card rv-lift" role="alertdialog" aria-labelledby="confirm-title">
								<div id="confirm-title" class="confirm-title">
									{confirm === 'exit' ? m.setup2_confirm_exit_title() : m.setup2_confirm_tui_title()}
								</div>
								<p class="su-label confirm-body">
									{#if confirm === 'exit'}
										{m.setup2_confirm_exit_body()}
									{:else}
										{m.setup2_confirm_tui_body()}
									{/if}
								</p>
								<div class="confirm-actions">
									<button type="button" class="ui-button ui-button-ghost" onclick={() => (confirm = null)}>
										{m.setup2_btn_cancel()}
									</button>
									<button
										type="button"
										class="ui-button ui-button-primary"
										onclick={() => {
											if (confirm === 'exit') exitSetup();
											else void openTui();
										}}
									>
										{confirm === 'exit' ? m.setup2_confirm_exit_action() : m.setup2_confirm_tui_action()}
									</button>
								</div>
							</div>
						</div>
					{/if}
				</div>
			</div>
		</div>
	{/if}

	{#if setupFlow.phase === 'tui'}
		<!-- La TUI vera: `omp setup` in un terminale, non una simulazione. Studio
		     rileva la fine dallo stato reale e chiude da solo (SET-004). -->
		<div class="stage">
			<div style:transform="scale({scale})" style:transform-origin="center">
				<div class="tui-window">
					<div class="tui-head">
						<span class="su-caption tui-title">{m.setup2_tui_window_title()}</span>
						<span class="su-meta tui-note">{m.setup2_tui_window_note()}</span>
					</div>
					<div class="tui-body">
						<Terminal cwd={''} launchArgs={['setup']} />
					</div>
				</div>
				<p class="su-meta tui-foot">
					{m.setup2_tui_waiting()}
					<!-- Se la TUI si chiude senza completare, restare qui sarebbe una
					     trappola: si torna al setup grafico, che riparte dal passo salvato. -->
					<button type="button" class="ui-link tui-back" onclick={() => (setupFlow.phase = 'setup')}>
						{m.setup2_tui_back()}
					</button>
				</p>
			</div>
		</div>
	{/if}

</div>

<style>
	.experience {
		position: fixed;
		inset: 0;
		z-index: var(--z-dialog);
	}

	.skip-hint {
		position: absolute;
		inset-inline: 0;
		bottom: 28px;
		margin: 0;
		text-align: center;
		color: rgb(227 192 106 / 0.55);
		pointer-events: none;
	}

	.stage {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
	}

	.window {
		position: relative;
		display: flex;
		width: 880px;
		height: 600px;
		overflow: hidden;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		background: var(--bg-overlay);
		color: var(--ink);
		box-shadow:
			0 60px 140px -30px oklch(0 0 0 / 0.85),
			0 24px 60px -24px oklch(0 0 0 / 0.7),
			var(--shadow-overlay);
	}

	.content {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
	}

	.head {
		padding: 18px 28px 16px;
	}

	.head-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 24px;
	}

	.counter {
		color: var(--ink-faint);
	}

	.exit {
		margin-right: -8px;
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.title {
		margin: 6px 0 0;
		font-size: 17px;
	}

	.trace {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 26px;
		margin-top: var(--space-3);
		color: var(--ink);
	}

	.trace-icon {
		display: grid;
		place-items: center;
		width: 16px;
		flex: none;
		color: var(--warn);
		--icon-size: 14px;
	}

	.trace-icon.attention {
		width: 16px;
		height: 16px;
	}

	.trace-icon.attention::after {
		content: '';
		width: 10px;
		height: 10px;
		border-radius: var(--radius-full);
		background: var(--warn);
	}

	.body {
		min-height: 0;
		flex: 1;
		padding: 0 28px 24px;
	}

	.foot {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		height: 52px;
		flex: none;
		padding: 0 20px;
		border-top: 1px solid var(--line);
		background: var(--bg-base);
	}

	.spacer {
		flex: 1;
	}

	.tui,
	.exit {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		border: 0;
		background: none;
		padding: 0;
		--icon-size: 13px;
	}

	.tui {
		color: var(--ink-faint);
		cursor: pointer;
	}

	.tui:hover {
		color: var(--ink-muted);
	}

	.primary {
		min-width: 96px;
	}

	.quiet {
		text-decoration: none;
	}

	/* Conferma in-finestra: un velo dentro la finestra, non un dialogo di sistema.
	 * Il setup non è una superficie dell'app da chiudere per sbaglio. */
	.confirm-layer {
		position: absolute;
		inset: 0;
		z-index: 10;
		display: grid;
		place-items: center;
		background: color-mix(in oklab, var(--bg-sunken) 62%, transparent);
	}

	.confirm-card {
		width: 380px;
		padding: var(--space-4);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		background: var(--bg-raised);
		box-shadow: var(--shadow-overlay);
	}

	.confirm-title {
		font-size: var(--text-md);
		font-weight: 550;
		color: var(--ink);
	}

	.confirm-body {
		margin: 6px 0 0;
		color: var(--ink-muted);
	}

	.confirm-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
		margin-top: var(--space-4);
	}

	.tui-window {
		width: 720px;
		overflow: hidden;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		background: var(--bg-sunken);
		box-shadow:
			0 60px 140px -30px oklch(0 0 0 / 0.85),
			var(--shadow-overlay);
	}

	.tui-head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		height: 32px;
		padding: 0 12px;
		border-bottom: 1px solid var(--line);
		background: var(--bg-base);
	}

	.tui-title {
		color: var(--ink-muted);
	}

	.tui-note {
		margin-left: auto;
		color: var(--ink-faint);
	}

	.tui-body {
		height: 420px;
	}

	.tui-foot {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		margin: 12px 0 0;
		color: rgb(242 240 234 / 0.7);
	}

	.tui-back {
		border: 0;
		background: none;
		padding: 0;
		color: rgb(242 240 234);
		cursor: pointer;
	}
</style>
