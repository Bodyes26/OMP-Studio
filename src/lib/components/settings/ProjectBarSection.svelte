<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import {
		settingsStore,
		type ProjectBarOrder,
		type QueueBadgeStyle
	} from '$lib/stores/settings.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import Switch from '$lib/ui/Switch.svelte';

	// Ogni opzione di ordinamento porta con se' la sua spiegazione: l'utente
	// deve capire l'effetto prima di cambiarlo, non scoprirlo per tentativi.
	const ORDER_OPTIONS = $derived<{ id: ProjectBarOrder; label: string; desc: string }[]>([
		{ id: 'fixed', label: m.settings_project_bar_order_fixed(), desc: m.settings_project_bar_order_fixed_desc() },
		{ id: 'mru', label: m.settings_project_bar_order_mru(), desc: m.settings_project_bar_order_mru_desc() },
		{ id: 'priority', label: m.settings_project_bar_order_priority(), desc: m.settings_project_bar_order_priority_desc() },
		{ id: 'alpha', label: m.settings_project_bar_order_alpha(), desc: m.settings_project_bar_order_alpha_desc() }
	]);

	// Il contatore vive dentro la tessera del progetto aperto: le tessere degli
	// altri progetti restano mute per scelta, e il conto complessivo sta nel
	// chip "Coda" della barra.
	const QUEUE_BADGE_OPTIONS = $derived<{ id: QueueBadgeStyle; label: string; desc: string }[]>([
		{ id: 'count-state', label: m.ui_projectbarsection_numero_e_stato_1099(), desc: m.settings_project_bar_badge_count_state_desc() },
		{ id: 'count', label: m.settings_project_bar_badge_count(), desc: m.settings_project_bar_badge_count_desc() },
		{ id: 'dot', label: m.settings_project_bar_badge_dot(), desc: m.ui_projectbarsection_un_puntino_se_c_e_almeno_un_4aff() },
		{ id: 'off', label: m.settings_project_bar_badge_off(), desc: m.settings_project_bar_badge_off_desc() }
	]);
</script>

<div class="settings-section">
	<div class="section-header">
		<h4>{m.settings_project_bar_title()}</h4>
		<button type="button" class="ui-button ui-button-secondary" onclick={() => settingsStore.reset('projectBar')}>{m.settings_section_reset()}</button>
	</div>

	<div class="section-block">
		<span class="block-title">{m.settings_project_bar_order_title()}</span>
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
		<span class="block-title">{m.settings_project_bar_badge_title()}</span>
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
				<span id="label-project-bar-name" class="form-row-label">{m.settings_project_bar_name_label()}</span>
				<span id="desc-project-bar-name" class="form-row-desc">{m.ui_projectbarsection_la_sigla_c_e_sempre_il_nome_839b()}</span>
			</div>
			<div class="form-row-control">
				<Segmented
					value={settingsStore.projectBar.label}
					ariaLabelledBy="label-project-bar-name"
					ariaDescribedBy="desc-project-bar-name"
					options={[
						{ value: 'initials', label: m.settings_project_bar_name_open_only() },
						{ value: 'name', label: m.settings_project_bar_name_all() }
					]}
					onChange={(val) => settingsStore.patchProjectBar({ label: val as 'initials' | 'name' })}
				/>
			</div>
		</div>

		<div class="form-row">
			<div class="form-row-copy">
				<span id="label-show-agent-dot" class="form-row-label">{m.ui_projectbarsection_segno_di_stato_agente_b812()}</span>
				<span id="desc-show-agent-dot" class="form-row-desc">{m.settings_project_bar_agent_dot_desc()}</span>
			</div>
			<div class="form-row-control">
				<Switch
					id="settings-show-agent-dot"
					checked={settingsStore.projectBar.showAgentDot}
					ariaLabelledBy="label-show-agent-dot"
					ariaDescribedBy="desc-show-agent-dot"
					onChange={(checked) => settingsStore.patchProjectBar({ showAgentDot: checked })}
				/>
			</div>
		</div>

		<div class="form-row">
			<div class="form-row-copy">
				<span id="label-show-queue-peek" class="form-row-label">{m.settings_project_bar_queue_peek()}</span>
				<span id="desc-show-queue-peek" class="form-row-desc">{m.ui_projectbarsection_mostra_l_elenco_dei_task_in_coda_cd99()}</span>
			</div>
			<div class="form-row-control">
				<Switch
					id="settings-show-queue-peek"
					checked={settingsStore.projectBar.showQueuePeek}
					ariaLabelledBy="label-show-queue-peek"
					ariaDescribedBy="desc-show-queue-peek"
					onChange={(checked) => settingsStore.patchProjectBar({ showQueuePeek: checked })}
				/>
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
		padding-bottom: var(--space-2);
		border-bottom: 1px solid var(--line);
	}

	.section-header h4 {
		margin: 0;
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--ink);
	}

	.section-block {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.block-title {
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
		text-transform: none;
		letter-spacing: normal;
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
		transition: background var(--dur-fast) var(--ease-out);
	}

	.option-row:last-child {
		border-bottom: none;
	}

	.option-row:hover {
		background: var(--bg-hover);
	}

	.option-row.active {
		background: color-mix(in oklab, var(--brand) 7%, var(--bg-raised));
	}

	.option-row input[type='radio'] {
		margin-top: 2px;
	}

	.option-copy {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.option-title {
		font-size: var(--text-label);
		font-weight: 500;
		color: var(--ink);
	}

	.option-desc {
		font-size: var(--text-caption);
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
		transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
	}

	.badge-option:hover {
		background: var(--bg-hover);
		border-color: var(--line-strong);
	}

	.badge-option.active {
		background: color-mix(in oklab, var(--brand) 6%, var(--bg-raised));
		border-color: color-mix(in oklab, var(--brand) 40%, var(--line));
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
		font-size: var(--text-caption);
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
		border-radius: var(--radius-sm);
		background: var(--ink-faint);
	}

	.none-sample {
		color: var(--ink-faint);
		font-size: var(--text-caption);
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
		font-size: var(--text-label);
		font-weight: 500;
		color: var(--ink);
	}

	.form-row-desc {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.form-row-control {
		flex-shrink: 0;
	}

</style>
