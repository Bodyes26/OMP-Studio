<!--
  WorkSheet.svelte — Pannello «Nuovo lavoro» / «Lavoro in coda» (Gate R48, R-REM-09…12).

  Un foglio che parte dal testo. Sotto: immagini e direttive, poi progetto e
  «Nuovo worktree» a meta' riga, poi ruolo e modello a tutta larghezza, una
  riga che dice dove partira' il lavoro e le due azioni. Gli stessi controlli
  modificano un lavoro in coda; programmazione, ordine ed eliminazione stanno
  nel menu ⋯. Le conferme di Studio per un nuovo worktree si rispondono qui.
  Montato una volta in App.svelte, sopra la chat.
-->
<script lang="ts">
	import { t } from '../../i18n.ts';
	import { workSheet, type WhenChoice } from '../../work.svelte.ts';
	import { connection } from '../../connection.svelte.ts';
	import { explainDestination, providerResetEstimate } from '../../work.ts';
	import { getProjectStatus, sortProjects } from '../../projectHelpers.ts';
	import { formatScheduleLabel } from '../../schedule.ts';
	import ConfigChips from './ConfigChips.svelte';
	import { IconClose, IconMore, IconImage, IconCheck, IconChevronDown } from '../../icons.ts';
	import { scrim, bottomSheet, popFloat } from '../../motion.ts';
	let promptEl = $state<HTMLTextAreaElement | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);

	const project = $derived(workSheet.project);
	const display = $derived(workSheet.display);
	const withOptions = $derived(workSheet.withOptions);
	const directives = $derived(workSheet.catalog?.directives ?? []);
	const editing = $derived(workSheet.mode === 'edit');
	const hint = $derived(explainDestination(project?.lanes ?? [], workSheet.newWorktree));
	const resetEstimate = $derived(
		providerResetEstimate(connection.hostStates[workSheet.hostId]?.state.quota ?? null, display.provider)
	);
	const queuedIndex = $derived(workSheet.queuedTasks.findIndex((task) => task.id === workSheet.taskId));
	const confirmation = $derived(workSheet.confirmation);
	const canSubmitText = $derived(workSheet.prompt.trim().length > 0 && !workSheet.busy && !workSheet.loading);

	// La conferma arriva con l'istantanea successiva all'esito: si allinea a ogni aggiornamento.
	$effect(() => {
		void workSheet.confirmation;
		void workSheet.busy;
		workSheet.syncConfirmation();
	});

	// Il campo cresce con il testo fino a meta' schermo, poi scorre.
	$effect(() => {
		const el = promptEl;
		if (!el) return;
		void workSheet.prompt;
		el.style.height = 'auto';
		el.style.height = `${Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.4))}px`;
	});

	// Su un lavoro nuovo si scrive subito; sul telefono la tastiera si apre solo al tocco.
	$effect(() => {
		const el = promptEl;
		if (!el || !workSheet.isOpen || editing || workSheet.view !== 'main') return;
		if (!window.matchMedia('(pointer: coarse)').matches) el.focus();
	});

	function onKeydown(event: KeyboardEvent): void {
		if (!workSheet.isOpen || event.key !== 'Escape') return;
		event.preventDefault();
		workSheet.back();
	}

	function pickFiles(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		if (input.files?.length) void workSheet.addFiles(input.files);
		input.value = '';
	}

	function chooseWhen(when: WhenChoice): void {
		workSheet.when = when;
	}

	function openScheduleView(): void {
		const schedule = workSheet.task?.schedule;
		workSheet.when = schedule ? schedule.kind : 'manual';
		workSheet.atTime = workSheet.currentAtTime();
		workSheet.view = 'schedule';
	}

	function formatBytes(bytes: number | null): string {
		if (bytes === null) return '';
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	const whenOptions = $derived<Array<{ id: WhenChoice; label: string; desc: string }>>([
		{ id: 'manual', label: editing ? t('workScheduleNone') : t('workWhenManual'), desc: t('workWhenManualDesc') },
		{
			id: 'reset',
			label: t('workWhenReset'),
			desc: resetEstimate
				? t('workWhenResetDesc', { provider: resetEstimate.provider, window: resetEstimate.window, time: resetEstimate.time })
				: t('workWhenResetDescFallback')
		},
		{ id: 'at', label: t('workWhenAt'), desc: t('workWhenAtDesc') }
	]);
</script>

<svelte:window onkeydown={onKeydown} />

{#if workSheet.isOpen}
	<div
		class="backdrop"
		transition:scrim
		role="presentation"
		onclick={(event) => {
			if (event.target === event.currentTarget) workSheet.back();
		}}
	>
		<div
			class="sheet"
			transition:bottomSheet
			role="dialog"
			aria-modal="true"
			aria-label={editing ? t('workEditTitle') : t('workNewTitle')}
			data-testid="work-sheet"
		>
			<div class="grip" aria-hidden="true"></div>

			{#if workSheet.view === 'main'}
				<header class="head">
					<div class="head-text">
						<h2>{editing ? t('workEditTitle') : t('workNewTitle')}</h2>
						<span class="sub">{t('workOnMachine', { machine: workSheet.hostName })}</span>
					</div>
					{#if editing && workSheet.canQueue}
						<button
							type="button"
							class="icon-btn"
							onclick={() => (workSheet.view = 'menu')}
							aria-label={t('workActionsTitle')}
							title={t('workActionsTitle')}
							data-testid="work-menu"
						>
							<IconMore />
						</button>
					{/if}
					<button type="button" class="icon-btn" onclick={() => workSheet.close()} aria-label={t('close')} title={t('close')}>
						<IconClose />
					</button>
				</header>

				<textarea
					bind:this={promptEl}
					bind:value={workSheet.prompt}
					class="prompt"
					rows="3"
					placeholder={t('workPromptPlaceholder')}
					aria-label={t('workPromptPlaceholder')}
					readonly={workSheet.promptLocked || workSheet.loading}
					data-testid="work-prompt"
				></textarea>
				{#if workSheet.promptLocked}
					<p class="hint warn">{t('workPromptLocked')}</p>
				{/if}

				{#if withOptions}
					<div class="media-bar">
						<button
							type="button"
							class="icon-btn"
							onclick={() => fileInput?.click()}
							aria-label={t('workAttachImage')}
							title={t('workAttachImage')}
							disabled={workSheet.busy}
						>
							<IconImage />
						</button>
						<input bind:this={fileInput} type="file" accept="image/*" multiple hidden onchange={pickFiles} />

						<div class="thumbs">
							{#each workSheet.keptImages as index (index)}
								{@const image = workSheet.existingImages[index]}
								<span class="thumb">
									{#if image?.data}
										<img src={`data:${image.mimeType};base64,${image.data}`} alt="" />
									{:else}
										<span class="thumb-placeholder" title={t('workImagePlaceholder')}><IconImage /></span>
									{/if}
									<button
										type="button"
										class="thumb-remove"
										onclick={() => workSheet.removeExistingImage(index)}
										aria-label={t('workRemoveImage', { name: String(index + 1) })}
									>
										<IconClose />
									</button>
								</span>
							{/each}
							{#each workSheet.newImages as image (image.id)}
								<span class="thumb" class:staging={image.status === 'staging'} class:failed={image.status === 'error'} title={image.error ?? image.name}>
									<img src={image.url} alt="" />
									<button
										type="button"
										class="thumb-remove"
										onclick={() => workSheet.removeNewImage(image.id)}
										aria-label={t('workRemoveImage', { name: image.name })}
									>
										<IconClose />
									</button>
								</span>
							{/each}
						</div>

						{#if directives.length > 0}
							<button type="button" class="chip" onclick={() => (workSheet.view = 'directives')} data-testid="work-directives">
								{workSheet.directiveIds.length > 0
									? t('workDirectivesCount', { count: workSheet.directiveIds.length })
									: t('workDirectives')}
							</button>
						{/if}
					</div>
				{/if}

				<div class="ctx">
					<button
						type="button"
						class="chip"
						disabled={editing}
						onclick={() => (workSheet.view = 'project')}
						aria-label={t('workProject')}
						data-testid="work-project"
					>
						{#if project}
							<span class="dot {getProjectStatus(project)}" aria-hidden="true"></span>
						{/if}
						<span class="trunc">{project?.name ?? t('workProject')}</span>
						{#if !editing}
							<span class="caret" aria-hidden="true"><IconChevronDown /></span>
						{/if}
					</button>
					<button
						type="button"
						class="chip"
						class:on={workSheet.newWorktree}
						aria-pressed={workSheet.newWorktree}
						disabled={!workSheet.canStart}
						onclick={() => (workSheet.newWorktree = !workSheet.newWorktree)}
						data-testid="work-worktree"
					>
						<span class="trunc">{t('workIsolatedWorktree')}</span>
					</button>
					{#if withOptions && workSheet.catalog}
						<div class="cfg-row">
							<ConfigChips
								layout="row"
								catalog={workSheet.catalog}
								role={display.role}
								provider={display.provider}
								modelId={display.modelId}
								modelLabel={display.modelLabel}
								thinking={display.thinking}
								disabled={workSheet.busy}
								onRole={(roleId) => workSheet.setRole(roleId)}
								onModel={(provider, modelId) => workSheet.setModel(provider, modelId)}
								onThinking={(level) => workSheet.setThinking(level)}
							/>
						</div>
					{/if}
				</div>

				{#if workSheet.canStart}
					<p class="hint">{hint}</p>
				{/if}
				{#if editing && workSheet.task?.schedule}
					<p class="hint">{t('workScheduledAs', { schedule: formatScheduleLabel(workSheet.task.schedule) ?? '' })}</p>
				{/if}
				{#if workSheet.error}
					<p class="error" role="alert">{workSheet.error}</p>
				{/if}

				<div class="actions">
					{#if editing}
						{#if workSheet.canQueue}
							<button type="button" disabled={!canSubmitText || workSheet.promptLocked && !workSheet.dirty} onclick={() => void workSheet.save()} data-testid="work-save">
								{t('workSaveBtn')}
							</button>
						{/if}
					{:else if workSheet.canQueue}
						<button type="button" disabled={!canSubmitText || !project} onclick={() => (workSheet.view = 'when')} data-testid="queue-work">
							{t('workQueueBtn')}
						</button>
					{/if}
					{#if workSheet.canStart}
						<button type="button" class="primary" disabled={!canSubmitText || !project} onclick={() => void workSheet.start()} data-testid="start-work">
							{t('workStartBtn')}
						</button>
					{/if}
				</div>
			{:else if workSheet.view === 'project'}
				<header class="head">
					<div class="head-text">
						<h2>{t('workProject')}</h2>
						<span class="sub">{t('workOnMachine', { machine: workSheet.hostName })}</span>
					</div>
					<button type="button" class="icon-btn" onclick={() => (workSheet.view = 'main')} aria-label={t('close')}>
						<IconClose />
					</button>
				</header>
				<div class="list">
					{#each sortProjects(workSheet.projects) as candidate (candidate.id)}
						<button type="button" class="item" onclick={() => workSheet.setProject(candidate.id)} aria-pressed={candidate.id === workSheet.projectId}>
							<span class="dot {getProjectStatus(candidate)}" aria-hidden="true"></span>
							<span class="item-text"><strong>{candidate.name}</strong></span>
							{#if candidate.id === workSheet.projectId}
								<span class="check" aria-hidden="true"><IconCheck /></span>
							{/if}
						</button>
					{/each}
				</div>
			{:else if workSheet.view === 'directives'}
				<header class="head">
					<div class="head-text">
						<h2>{t('workDirectives')}</h2>
						<span class="sub">{project?.name ?? ''}</span>
					</div>
					<button type="button" class="icon-btn" onclick={() => (workSheet.view = 'main')} aria-label={t('close')}>
						<IconClose />
					</button>
				</header>
				<div class="list">
					{#each directives as directive (directive.id)}
						{@const selected = workSheet.directiveIds.includes(directive.id)}
						<button type="button" class="item" role="checkbox" aria-checked={selected} onclick={() => workSheet.toggleDirective(directive.id)}>
							<span class="box" class:on={selected} aria-hidden="true">{#if selected}<IconCheck />{/if}</span>
							<span class="item-text">
								<strong>{directive.name}</strong>
								{#if directive.description}<small>{directive.description}</small>{/if}
							</span>
						</button>
					{/each}
				</div>
				<div class="actions">
					<button type="button" class="primary" onclick={() => (workSheet.view = 'main')}>{t('workDoneBtn')}</button>
				</div>
			{:else if workSheet.view === 'when' || workSheet.view === 'schedule'}
				<header class="head">
					<div class="head-text">
						<h2>{workSheet.view === 'when' ? t('workWhenTitle') : t('workScheduleAction')}</h2>
						<span class="sub">{project?.name ?? ''}</span>
					</div>
					<button type="button" class="icon-btn" onclick={() => workSheet.back()} aria-label={t('close')}>
						<IconClose />
					</button>
				</header>
				<div class="list" role="radiogroup" aria-label={t('workWhenTitle')}>
					{#each whenOptions as option (option.id)}
						<button
							type="button"
							class="item"
							role="radio"
							aria-checked={workSheet.when === option.id}
							onclick={() => chooseWhen(option.id)}
							data-testid={`when-${option.id}`}
						>
							<span class="item-text">
								<strong>{option.label}</strong>
								<small>{option.desc}</small>
							</span>
							{#if workSheet.when === option.id}
								<span class="check" aria-hidden="true"><IconCheck /></span>
							{/if}
						</button>
					{/each}
				</div>
				{#if workSheet.when === 'at'}
					<label class="time-field">
						<span>{t('workTimeLabel')}</span>
						<input type="time" bind:value={workSheet.atTime} />
					</label>
				{/if}
				{#if workSheet.view === 'when'}
					<p class="hint">{workSheet.newWorktree ? t('destNewLaneToggle') : t('workQueueHint')}</p>
				{/if}
				<div class="actions">
					{#if workSheet.view === 'when'}
						<button type="button" class="primary" disabled={workSheet.busy} onclick={() => void workSheet.queue()} data-testid="confirm-queue">
							{t('workQueueBtn')}
						</button>
					{:else}
						<button type="button" class="primary" disabled={workSheet.busy} onclick={() => void workSheet.applySchedule(workSheet.when)} data-testid="confirm-schedule">
							{t('workSaveBtn')}
						</button>
					{/if}
				</div>
			{:else if workSheet.view === 'menu'}
				<header class="head">
					<div class="head-text">
						<h2>{t('workActionsTitle')}</h2>
						<span class="sub">{workSheet.task?.title ?? ''}</span>
					</div>
					<button type="button" class="icon-btn" onclick={() => (workSheet.view = 'main')} aria-label={t('close')}>
						<IconClose />
					</button>
				</header>
				<div class="list">
					<button type="button" class="item" onclick={openScheduleView}>
						<span class="item-text"><strong>{t('workScheduleAction')}</strong></span>
					</button>
					<button type="button" class="item" disabled={queuedIndex <= 0 || workSheet.busy} onclick={() => void workSheet.move(-1)}>
						<span class="item-text"><strong>{t('workMoveUp')}</strong></span>
					</button>
					<button
						type="button"
						class="item"
						disabled={queuedIndex < 0 || queuedIndex >= workSheet.queuedTasks.length - 1 || workSheet.busy}
						onclick={() => void workSheet.move(1)}
					>
						<span class="item-text"><strong>{t('workMoveDown')}</strong></span>
					</button>
					<button type="button" class="item danger" onclick={() => (workSheet.view = 'delete')} data-testid="work-delete">
						<span class="item-text"><strong>{t('workDeleteBtn')}</strong></span>
					</button>
				</div>
			{:else if workSheet.view === 'delete'}
				<header class="head">
					<div class="head-text">
						<h2>{t('workDeleteConfirmTitle')}</h2>
					</div>
				</header>
				<p class="body">
					{t('workDeleteConfirmBody', { title: workSheet.task?.title ?? '', project: project?.name ?? '' })}
				</p>
				<div class="actions">
					<button type="button" disabled={workSheet.busy} onclick={() => (workSheet.view = 'menu')}>{t('workCancelBtn')}</button>
					<button type="button" class="primary danger" disabled={workSheet.busy} onclick={() => void workSheet.remove()} data-testid="confirm-delete">
						{t('workDeleteConfirmBtn')}
					</button>
				</div>
			{:else if workSheet.view === 'confirm'}
				{#if confirmation?.kind === 'concurrency'}
					<header class="head">
						<div class="head-text">
							<h2>{t('workConcurrencyTitle')}</h2>
							<span class="sub">{confirmation.taskTitle}</span>
						</div>
					</header>
					<p class="body">{t('workConcurrencyBody', { count: confirmation.activeLanes.length })}</p>
					<div class="list">
						{#each confirmation.activeLanes as activeLane (activeLane.laneId)}
							<div class="item static">
								<span class="dot {activeLane.state === 'attention' ? 'question' : 'working'}" aria-hidden="true"></span>
								<span class="item-text">
									<strong>{activeLane.title}</strong>
									{#if activeLane.modelLabel}<small>{activeLane.modelLabel}</small>{/if}
								</span>
							</div>
						{/each}
					</div>
					<div class="actions">
						<button type="button" disabled={workSheet.busy} onclick={() => void workSheet.respond({ action: 'cancel' })}>
							{t('workCancelBtn')}
						</button>
						<button type="button" class="primary" disabled={workSheet.busy} onclick={() => void workSheet.respond({ action: 'confirm' })} data-testid="confirm-concurrency">
							{t('workConcurrencyConfirm')}
						</button>
					</div>
				{:else if confirmation?.kind === 'local_files'}
					<header class="head">
						<div class="head-text">
							<h2>{t('workLocalFilesTitle')}</h2>
							<span class="sub">{confirmation.taskTitle}</span>
						</div>
					</header>
					<p class="body">{t('workLocalFilesBody')}</p>
					<div class="list">
						{#each confirmation.files as file (file.path)}
							{@const selected = workSheet.selectedFiles.includes(file.path)}
							<button type="button" class="item" role="checkbox" aria-checked={selected} onclick={() => workSheet.toggleFile(file.path)}>
								<span class="box" class:on={selected} aria-hidden="true">{#if selected}<IconCheck />{/if}</span>
								<span class="item-text">
									<strong class="mono">{file.path}</strong>
									<small>{file.category}{file.bytes !== null ? ` · ${formatBytes(file.bytes)}` : ''}</small>
								</span>
							</button>
						{/each}
					</div>
					<div class="actions">
						<button type="button" disabled={workSheet.busy} onclick={() => void workSheet.respond({ action: 'files', accepted: [] })}>
							{t('workLocalFilesNone')}
						</button>
						<button
							type="button"
							class="primary"
							disabled={workSheet.busy}
							onclick={() => void workSheet.respond({ action: 'files', accepted: [...workSheet.selectedFiles] })}
							data-testid="confirm-files"
						>
							{t('workLocalFilesCopy')}
						</button>
					</div>
					<button type="button" class="link" disabled={workSheet.busy} onclick={() => void workSheet.respond({ action: 'cancel' })}>
						{t('workCancelBtn')}
					</button>
				{:else}
					<div class="waiting" role="status">
						<span class="spinner" aria-hidden="true"></span>
						<span>{t('workConfirmWaiting')}</span>
					</div>
				{/if}
				{#if workSheet.error}
					<p class="error" role="alert">{workSheet.error}</p>
				{/if}
			{/if}
		</div>
	</div>
{/if}

{#if workSheet.toast}
	<div class="toast" role="status" transition:popFloat>{workSheet.toast}</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 300;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		background: color-mix(in oklch, var(--ink) 35%, transparent);
	}

	.sheet {
		width: 100%;
		max-width: 560px;
		max-height: min(92dvh, var(--app-height, 100dvh));
		overflow-y: auto;
		overscroll-behavior: contain;
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 8px 16px calc(16px + env(safe-area-inset-bottom));
		background: var(--bg-raised);
		border-radius: 18px 18px 0 0;
		box-shadow: var(--shadow-overlay);
	}

	.grip {
		width: 36px;
		height: 5px;
		border-radius: 3px;
		background: var(--line-strong);
		margin: 0 auto 2px;
		flex-shrink: 0;
	}

	.head {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.head-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	.head h2 {
		margin: 0;
		font-size: 18px;
		font-weight: 650;
		color: var(--ink);
	}

	.sub {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		flex-shrink: 0;
		border: none;
		border-radius: 12px;
		background: transparent;
		color: var(--ink-muted);
		cursor: pointer;
		--icon-size: 20px;
	}

	.icon-btn:disabled {
		opacity: 0.4;
	}

	.prompt {
		width: 100%;
		min-height: 88px;
		box-sizing: border-box;
		padding: 12px 14px;
		border: 1px solid var(--line-strong);
		border-radius: 14px;
		background: var(--bg-base);
		color: var(--ink);
		font: inherit;
		font-size: 16px;
		line-height: 1.45;
		resize: none;
	}

	.prompt:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: -1px;
	}

	.media-bar {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}

	.thumbs {
		flex: 1;
		display: flex;
		gap: 6px;
		overflow-x: auto;
		scrollbar-width: none;
		min-width: 0;
	}

	.thumb {
		position: relative;
		width: 44px;
		height: 44px;
		flex-shrink: 0;
		border-radius: 10px;
		overflow: hidden;
		border: 1px solid var(--line);
		background: var(--bg-sunken);
	}

	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.thumb.staging img {
		opacity: 0.45;
	}

	.thumb.failed {
		border-color: var(--danger);
	}

	.thumb-placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		color: var(--ink-faint);
		--icon-size: 18px;
	}

	.thumb-remove {
		position: absolute;
		top: 2px;
		right: 2px;
		width: 20px;
		height: 20px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		border-radius: 50%;
		background: rgba(0, 0, 0, 0.6);
		color: #fff;
		cursor: pointer;
		--icon-size: 12px;
	}

	/* Progetto e worktree a meta' riga; ruolo e modello sulla riga intera (R-REM-09). */
	.ctx {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px;
		padding-top: 10px;
		border-top: 1px solid var(--line);
	}

	.cfg-row {
		grid-column: 1 / -1;
		min-width: 0;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		min-width: 0;
		min-height: 44px;
		padding: 0 12px;
		border: 1px solid var(--line);
		border-radius: 22px;
		background: transparent;
		color: var(--ink);
		font: inherit;
		font-size: 14px;
		cursor: pointer;
	}

	.chip:disabled {
		cursor: default;
		opacity: 0.85;
	}

	.chip.on {
		border-color: var(--brand);
		background: color-mix(in oklch, var(--brand) 14%, transparent);
		font-weight: 600;
	}

	.media-bar .chip {
		flex-shrink: 0;
		min-height: 36px;
		font-size: 13px;
	}

	.trunc {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.caret {
		display: inline-flex;
		flex-shrink: 0;
		color: var(--ink-faint);
		--icon-size: 14px;
	}

	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
		background: var(--ink-faint);
	}

	.dot.question {
		background: var(--warn);
	}

	.dot.working {
		background: var(--brand);
	}

	.hint {
		margin: 0;
		font-size: var(--text-caption);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.hint.warn {
		color: var(--warn);
	}

	.error {
		margin: 0;
		font-size: var(--text-caption);
		color: var(--danger);
	}

	.body {
		margin: 0;
		font-size: 15px;
		line-height: 1.45;
		color: var(--ink);
	}

	.actions {
		display: flex;
		gap: 8px;
		padding-top: 4px;
	}

	.actions button {
		flex: 1;
		min-height: 48px;
		border: 1px solid var(--line-strong);
		border-radius: 14px;
		background: transparent;
		color: var(--ink);
		font: inherit;
		font-weight: 560;
		cursor: pointer;
	}

	.actions button.primary {
		background: var(--brand-ink);
		border-color: transparent;
		color: var(--bg-base);
		font-weight: 650;
	}

	.actions button.danger {
		background: var(--danger);
		color: #fff;
	}

	.actions button:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.list {
		display: flex;
		flex-direction: column;
		max-height: 50dvh;
		overflow-y: auto;
	}

	.item {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 52px;
		padding: 8px 6px;
		border: none;
		border-bottom: 1px solid var(--line);
		background: transparent;
		color: var(--ink);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.item:last-child {
		border-bottom: none;
	}

	.item:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.item.static {
		cursor: default;
	}

	.item.danger strong {
		color: var(--danger);
	}

	.item-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.item-text strong {
		font-weight: 560;
		font-size: 15px;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.item-text small {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		line-height: 1.35;
	}

	.mono {
		font-family: var(--font-mono);
		font-size: 13px !important;
		word-break: break-all;
	}

	.check {
		display: inline-flex;
		color: var(--brand-ink);
		--icon-size: 18px;
	}

	.box {
		width: 22px;
		height: 22px;
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1.5px solid var(--line-strong);
		border-radius: 6px;
		color: var(--bg-base);
		--icon-size: 14px;
	}

	.box.on {
		background: var(--brand-ink);
		border-color: var(--brand-ink);
	}

	.time-field {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		font-size: 15px;
		color: var(--ink);
	}

	.time-field input {
		min-height: 44px;
		padding: 0 12px;
		border: 1px solid var(--line-strong);
		border-radius: 12px;
		background: var(--bg-base);
		color: var(--ink);
		font: inherit;
	}

	.link {
		align-self: center;
		min-height: 40px;
		padding: 0 12px;
		border: none;
		background: transparent;
		color: var(--ink-muted);
		font: inherit;
		text-decoration: underline;
		cursor: pointer;
	}

	.waiting {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 80px;
		color: var(--ink-muted);
		font-size: 15px;
	}

	.spinner {
		width: 18px;
		height: 18px;
		border: 2px solid var(--line);
		border-top-color: var(--brand);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	.chip:focus-visible,
	.item:focus-visible,
	.actions button:focus-visible,
	.icon-btn:focus-visible,
	.link:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: -2px;
	}

	.toast {
		position: fixed;
		left: 50%;
		bottom: calc(24px + env(safe-area-inset-bottom));
		transform: translateX(-50%);
		z-index: 400;
		max-width: calc(100% - 32px);
		padding: 10px 16px;
		border-radius: 12px;
		background: var(--ink);
		color: var(--bg-base);
		font-size: 14px;
		pointer-events: none;
	}


	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.backdrop,
		.sheet,
		.toast {
			animation: none;
		}
		.spinner {
			animation-duration: 2s;
		}
	}
</style>
