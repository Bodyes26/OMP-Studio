<script lang="ts">
	import {
		settingsStore,
		type ProjectBarOrder,
		type QueueBadgeStyle
	} from '$lib/stores/settings.svelte';

	// Ogni opzione di ordinamento porta con se' la sua spiegazione: l'utente
	// deve capire l'effetto prima di cambiarlo, non scoprirlo per tentativi.
	const ORDER_OPTIONS: { id: ProjectBarOrder; label: string; desc: string }[] = [
		{ id: 'fixed', label: 'Manuale', desc: "Le tessere non si spostano da sole: riordinabili trascinando." },
		{ id: 'mru', label: 'Ultimo aperto', desc: 'Comportamento storico: il progetto che apri va in prima posizione.' },
		{ id: 'priority', label: 'Priorità task', desc: 'Chi ha task in coda o chiede attenzione va a sinistra.' },
		{ id: 'alpha', label: 'Alfabetico', desc: "Le tessere seguono l'ordine alfabetico del nome." }
	];

	// Il contatore vive dentro la tessera del progetto aperto: le tessere degli
	// altri progetti restano mute per scelta, e il conto complessivo sta nel
	// chip "Coda" della barra.
	const QUEUE_BADGE_OPTIONS: { id: QueueBadgeStyle; label: string; desc: string }[] = [
		{ id: 'count-state', label: 'Numero e stato', desc: 'Quanti task attendono nel progetto aperto, tinti quando sono pronti a partire.' },
		{ id: 'count', label: 'Solo numero', desc: 'Quanti task attendono nel progetto aperto, senza indicazione di prontezza.' },
		{ id: 'dot', label: 'Puntino', desc: "Un puntino se c'è almeno un task in coda, senza contarli." },
		{ id: 'off', label: 'Nessuno', desc: 'Nessun indicatore di coda sulla tessera.' }
	];
</script>

<div class="settings-section">
	<div class="section-header">
		<h4>Barra progetti</h4>
		<button type="button" class="btn btn-secondary" onclick={() => settingsStore.reset('projectBar')}>Ripristina</button>
	</div>

	<div class="section-block">
		<span class="block-title">Ordinamento</span>
		<div class="option-list">
			{#each ORDER_OPTIONS as opt (opt.id)}
				<label class="option-row" class:active={settingsStore.projectBar.order === opt.id}>
					<input
						type="radio"
						name="project-bar-order"
						checked={settingsStore.projectBar.order === opt.id}
						onchange={() => settingsStore.patchProjectBar({ order: opt.id })}
					/>
					<span class="option-copy">
						<span class="option-title">{opt.label}</span>
						<span class="option-desc">{opt.desc}</span>
					</span>
				</label>
			{/each}
		</div>
	</div>

	<div class="section-block">
		<span class="block-title">Badge dei task in coda</span>
		<div class="badge-option-grid">
			{#each QUEUE_BADGE_OPTIONS as opt (opt.id)}
				<button
					type="button"
					class="badge-option"
					class:active={settingsStore.projectBar.queueBadge === opt.id}
					onclick={() => settingsStore.patchProjectBar({ queueBadge: opt.id })}
				>
					<span class="badge-preview">
						{#if opt.id === 'count-state'}
							<span class="badge-sample state">3</span>
						{:else if opt.id === 'count'}
							<span class="badge-sample">3</span>
						{:else if opt.id === 'dot'}
							<span class="dot-sample"></span>
						{:else}
							<span class="none-sample">—</span>
						{/if}
					</span>
					<span class="option-copy">
						<span class="option-title">{opt.label}</span>
						<span class="option-desc">{opt.desc}</span>
					</span>
				</button>
			{/each}
		</div>
	</div>

	<div class="section-group">
		<div class="form-row">
			<div class="form-row-copy">
				<span class="form-row-label">Nome sulle tessere</span>
				<span class="form-row-desc">La sigla c'è sempre. Il nome del progetto compare solo sulla tessera aperta, oppure su tutte.</span>
			</div>
			<div class="form-row-control">
				<div class="segmented">
					<button
						type="button"
						class:active={settingsStore.projectBar.label === 'initials'}
						onclick={() => settingsStore.patchProjectBar({ label: 'initials' })}
					>
						Solo aperta
					</button>
					<button
						type="button"
						class:active={settingsStore.projectBar.label === 'name'}
						onclick={() => settingsStore.patchProjectBar({ label: 'name' })}
					>
						Tutte
					</button>
				</div>
			</div>
		</div>

		<div class="form-row">
			<div class="form-row-copy">
				<span class="form-row-label">Segno di stato agente</span>
				<span class="form-row-desc">Anello ambra che pulsa quando l'agente attende una risposta, anello fermo quando ha finito il lavoro.</span>
			</div>
			<div class="form-row-control">
				<label class="switch">
					<input
						type="checkbox"
						checked={settingsStore.projectBar.showAgentDot}
						onchange={(e) => settingsStore.patchProjectBar({ showAgentDot: (e.currentTarget as HTMLInputElement).checked })}
					/>
					<span class="slider"></span>
				</label>
			</div>
		</div>

		<div class="form-row">
			<div class="form-row-copy">
				<span class="form-row-label">Anteprima coda al passaggio</span>
				<span class="form-row-desc">Mostra l'elenco dei task in coda nel popover della tessera.</span>
			</div>
			<div class="form-row-control">
				<label class="switch">
					<input
						type="checkbox"
						checked={settingsStore.projectBar.showQueuePeek}
						onchange={(e) => settingsStore.patchProjectBar({ showQueuePeek: (e.currentTarget as HTMLInputElement).checked })}
					/>
					<span class="slider"></span>
				</label>
			</div>
		</div>
	</div>
</div>

<style>
	.settings-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-4);
	}

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.section-header h4 {
		margin: 0;
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--ink);
	}

	.section-block {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.block-title {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink-faint);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.option-list {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-raised);
		overflow: hidden;
	}

	.option-row {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--line);
		cursor: pointer;
	}

	.option-row:last-child {
		border-bottom: none;
	}

	.option-row:hover {
		background: var(--bg-hover);
	}

	.option-row.active {
		background: color-mix(in srgb, var(--brand) 6%, var(--bg-raised));
	}

	.option-row input[type='radio'] {
		margin-top: 2px;
		accent-color: var(--brand);
		cursor: pointer;
	}

	.option-copy {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.option-title {
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--ink);
	}

	.option-desc {
		font-size: var(--text-xs);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.badge-option-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: var(--space-2);
	}

	.badge-option {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-raised);
		cursor: pointer;
		text-align: left;
		transition: background var(--dur-fast), border-color var(--dur-fast);
	}

	.badge-option:hover {
		background: var(--bg-hover);
		border-color: var(--line-strong);
	}

	.badge-option.active {
		background: color-mix(in srgb, var(--brand) 6%, var(--bg-raised));
		border-color: color-mix(in srgb, var(--brand) 40%, var(--line));
	}

	.badge-preview {
		flex-shrink: 0;
		width: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	/* L'anteprima mostra il contatore com'e' nella barra: numero mono nudo
	   dentro la tessera, non una pastiglia in overlay. */
	.badge-sample {
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--ink-faint);
	}

	.badge-sample.state {
		color: var(--brand-ink);
	}

	.dot-sample {
		width: 6px;
		height: 6px;
		border-radius: 1px;
		background: var(--ink-faint);
	}

	.none-sample {
		color: var(--ink-faint);
		font-size: var(--text-sm);
	}

	.section-group {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-raised);
		overflow: hidden;
	}

	.form-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		padding: var(--space-3);
		border-bottom: 1px solid var(--line);
	}

	.form-row:last-child {
		border-bottom: none;
	}

	.form-row-copy {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.form-row-label {
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--ink);
	}

	.form-row-desc {
		font-size: var(--text-xs);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.form-row-control {
		flex-shrink: 0;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 6px 14px;
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		font-weight: 500;
		font-family: var(--font-ui);
		cursor: pointer;
		border: 1px solid transparent;
		transition: background var(--dur-fast), color var(--dur-fast), border-color var(--dur-fast);
	}

	.btn-secondary {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--line);
	}

	.btn-secondary:hover {
		background: var(--bg-active);
		border-color: var(--line-strong);
	}

	.segmented {
		display: flex;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.segmented button {
		padding: 6px 12px;
		border: none;
		background: var(--bg-sunken);
		color: var(--ink-muted);
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		cursor: pointer;
		transition: background var(--dur-fast), color var(--dur-fast);
	}

	.segmented button + button {
		border-left: 1px solid var(--line);
	}

	.segmented button:hover {
		background: var(--bg-hover);
	}

	.segmented button.active {
		background: var(--bg-active);
		color: var(--ink);
		font-weight: 600;
	}

	.switch {
		position: relative;
		display: inline-block;
		width: 32px;
		height: 18px;
		cursor: pointer;
	}

	.switch input {
		opacity: 0;
		width: 0;
		height: 0;
	}

	.slider {
		position: absolute;
		inset: 0;
		background: var(--bg-hover);
		border: 1px solid var(--line);
		border-radius: var(--radius-full);
		transition: background var(--dur-fast), border-color var(--dur-fast);
	}

	.slider::before {
		position: absolute;
		content: '';
		height: 12px;
		width: 12px;
		left: 2px;
		bottom: 2px;
		background: var(--ink-muted);
		border-radius: 50%;
		transition: transform var(--dur-fast), background var(--dur-fast);
	}

	input:checked + .slider {
		background: var(--brand);
		border-color: var(--brand);
	}

	input:checked + .slider::before {
		transform: translateX(14px);
		background: var(--bg-sunken);
	}
</style>
