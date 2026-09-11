<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { i18n } from '$lib/i18n/i18n.svelte';
	import { untrack } from 'svelte';
	import {
		modelSettingsStore,
		STANDARD_ROLES,
		type ModelFinding,
		type ModelFixItem
	} from '$lib/stores/modelSettings.svelte';
	import { IconClose, IconArrowRight } from '$lib/icons';
	import AlertBanner from '$lib/components/AlertBanner.svelte';
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';

	let selectedKeys = $state<string[]>([]);

	function getFindingKey(f: ModelFinding): string {
		return `${f.role}:${f.kind}:${f.index ?? 'p'}:${f.code}:${f.currentSelector}`;
	}

	function isActionable(finding: ModelFinding): boolean {
		return Boolean(finding.suggestedSelector) || finding.kind === 'fallback';
	}

	function createFixItem(finding: ModelFinding): ModelFixItem | null {
		if (finding.suggestedSelector) {
			return {
				role: finding.role,
				kind: finding.kind,
				index: finding.index ?? null,
				action: 'replace',
				newSelector: finding.suggestedSelector
			};
		}
		if (finding.kind === 'fallback') {
			return {
				role: finding.role,
				kind: finding.kind,
				index: finding.index ?? null,
				action: 'remove',
				newSelector: null
			};
		}
		return null;
	}

	const allActionableFindings = $derived(
		[
			...(modelSettingsStore.blockingFindings ?? []),
			...(modelSettingsStore.upgradeFindings ?? [])
		].filter(isActionable)
	);

	const allSelected = $derived(
		allActionableFindings.length > 0 && selectedKeys.length === allActionableFindings.length
	);

	const someSelected = $derived(
		selectedKeys.length > 0 && selectedKeys.length < allActionableFindings.length
	);

	$effect(() => {
		if (modelSettingsStore.healthModalOpen) {
			// Seleziona tutti i finding correggibili per default solo all'apertura del modale
			const actionable = untrack(() => [
				...(modelSettingsStore.blockingFindings ?? []),
				...(modelSettingsStore.upgradeFindings ?? [])
			]).filter(isActionable);
			selectedKeys = actionable.map(getFindingKey);
		}
	});

	function toggleSelect(key: string) {
		if (selectedKeys.includes(key)) {
			selectedKeys = selectedKeys.filter((k) => k !== key);
		} else {
			selectedKeys = [...selectedKeys, key];
		}
	}

	function toggleSelectAll() {
		if (allSelected) {
			selectedKeys = [];
		} else {
			selectedKeys = allActionableFindings.map(getFindingKey);
		}
	}

	async function handleApply() {
		const chosenFixes: ModelFixItem[] = [];
		for (const f of allActionableFindings) {
			if (selectedKeys.includes(getFindingKey(f))) {
				const fix = createFixItem(f);
				if (fix) chosenFixes.push(fix);
			}
		}
		if (chosenFixes.length === 0) return;
		await modelSettingsStore.applyFixes(chosenFixes);
	}

	async function handleDismiss() {
		await modelSettingsStore.dismissHealthFindings();
		modelSettingsStore.healthModalOpen = false;
	}

	function handleClose() {
		modelSettingsStore.healthModalOpen = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && modelSettingsStore.healthModalOpen) {
			e.stopPropagation();
			handleClose();
		}
	}

	// Azione per intrappolare e gestire il fuoco dentro il dialogo modale
	function trapFocus(node: HTMLElement) {
		const previouslyFocused = document.activeElement as HTMLElement | null;
		const focusableSelector =
			'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

		const first = node.querySelector<HTMLElement>(focusableSelector);
		if (first) {
			first.focus();
		}

		function onKeydown(e: KeyboardEvent) {
			if (e.key !== 'Tab') return;
			const focusables = Array.from(node.querySelectorAll<HTMLElement>(focusableSelector));
			if (focusables.length === 0) return;
			const firstEl = focusables[0];
			const lastEl = focusables[focusables.length - 1];

			if (e.shiftKey) {
				if (document.activeElement === firstEl) {
					e.preventDefault();
					lastEl.focus();
				}
			} else {
				if (document.activeElement === lastEl) {
					e.preventDefault();
					firstEl.focus();
				}
			}
		}

		node.addEventListener('keydown', onKeydown);

		return {
			destroy() {
				node.removeEventListener('keydown', onKeydown);
				if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
					previouslyFocused.focus();
				}
			}
		};
	}

	function getRoleMeta(roleId: string) {
		return (
			STANDARD_ROLES.find((r) => r.id === roleId) || {
				id: roleId,
				label: roleId,
				abbr: roleId.slice(0, 2).toUpperCase(),
				desc: ''
			}
		);
	}

	function getSlotLabel(kind: string, index: number | null): string {
		if (kind === 'primary') return 'Primario';
		const n = (index ?? 0) + 1;
		return `Riserva #${n}`;
	}

	function formatCheckDate(ts: number): string {
		return i18n.formatDate(ts, {
			day: '2-digit',
			month: '2-digit',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function formatCatalogAge(days: number): string {
		if (days < 0.1) return i18n.formatRelativeTime(-2, 'hour');
		if (days < 1) return i18n.formatRelativeTime(-Math.round(days * 24), 'hour');
		return i18n.formatRelativeTime(-Math.round(days), 'day');
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if modelSettingsStore.healthModalOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-backdrop" onclick={handleClose} transition:fade={{ duration: 150 }}></div>

	<div
		class="health-dialog"
		role="dialog"
		aria-modal="true"
		aria-labelledby="health-dialog-title"
		use:trapFocus
		transition:fly={{ y: -16, duration: 220, easing: cubicOut }}
	>
		<div class="dialog-header">
			<div class="header-titles">
				<h3 id="health-dialog-title">Salute dei Modelli Configurati</h3>
				{#if modelSettingsStore.healthReport}
					<p>
						{m.ui_modelhealthmodal_ultima_verifica_aab9()} {formatCheckDate(modelSettingsStore.healthReport.checkedAt)}
						{#if modelSettingsStore.healthReport.catalogAgeDays != null}
							· Catalogo aggiornato {formatCatalogAge(modelSettingsStore.healthReport.catalogAgeDays)}
						{/if}
					</p>
				{:else}
					<p>Referto di salute dei modelli primari e delle catene di riserva.</p>
				{/if}
			</div>
			<button class="btn-close" aria-label={m.settings_close_window()} onclick={handleClose}><IconClose /></button>
		</div>

		<div class="dialog-body">
			{#if modelSettingsStore.healthReport?.catalogError}
				<AlertBanner
					variant="warning"
					title={m.models_health_incomplete_title()}
					message="Non e stato possibile contattare il catalogo remoto ({modelSettingsStore.healthReport.catalogError}). L'elenco dei modelli non offerti potrebbe non essere affidabile."
				/>
			{/if}

			{#if allActionableFindings.length > 0}
				<div class="selection-bar">
					<label class="select-all-label">
						<input
							type="checkbox"
							checked={allSelected}
							indeterminate={someSelected}
							onchange={toggleSelectAll}
						/>
						<span>{m.ui_modelhealthmodal_seleziona_tutti_cd22()}{selectedKeys.length}/{allActionableFindings.length})</span>
					</label>
				</div>
			{/if}

			{#if modelSettingsStore.blockingFindings && modelSettingsStore.blockingFindings.length > 0}
				<div class="findings-group">
					<h4 class="group-title blocking">
						<span class="group-dot blocking"></span>
						<span>Non piu utilizzabili</span>
						<span class="group-count">({modelSettingsStore.blockingFindings.length})</span>
					</h4>
					<div class="candidates-list">
						{#each modelSettingsStore.blockingFindings as finding (getFindingKey(finding))}
							{@const roleMeta = getRoleMeta(finding.role)}
							{@const slotLabel = getSlotLabel(finding.kind, finding.index)}
							{@const key = getFindingKey(finding)}
							{@const actionable = isActionable(finding)}
							{@const isSelected = selectedKeys.includes(key)}

							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class="candidate-card blocking-card"
								class:selected={isSelected}
								class:non-actionable={!actionable}
								onclick={() => {
									if (actionable) toggleSelect(key);
								}}
							>
								<div class="card-left">
									{#if actionable}
										<input
											type="checkbox"
											checked={isSelected}
											aria-label="Seleziona correzione per ruolo {roleMeta.label} ({slotLabel})"
											onclick={(e) => e.stopPropagation()}
											onchange={() => toggleSelect(key)}
										/>
									{:else}
										<span class="no-action-indicator" title="Configurazione manuale richiesta">
											<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5">
												<circle cx="8" cy="8" r="6" />
												<line x1="8" y1="5" x2="8" y2="8" />
												<circle cx="8" cy="11" r="0.75" fill="currentColor" />
											</svg>
										</span>
									{/if}
								</div>

								<div class="card-content">
									<div class="role-badge-row">
										<span class="role-abbr-badge">{roleMeta.abbr}</span>
										<span class="role-name">{roleMeta.label}</span>
										<span class="slot-badge" class:fallback={finding.kind === 'fallback'}>{slotLabel}</span>
										<span class="provider-tag">{finding.currentProvider}</span>
										<span
											class="action-tag"
											class:replace={Boolean(finding.suggestedSelector)}
											class:remove={!finding.suggestedSelector && finding.kind === 'fallback'}
											class:manual={!actionable}
										>
											{#if finding.suggestedSelector}
												Sostituisci
											{:else if finding.kind === 'fallback'}
												{m.ui_modelhealthmodal_rimuovi_riserva_447f()}
											{:else}
												Configurazione manuale
											{/if}
										</span>
									</div>

									{#if finding.suggestedSelector}
										<div class="diff-row">
											<div class="model-box old">
												<span class="box-label">Attuale</span>
												<span class="box-val">{finding.currentModelId}</span>
												{#if finding.currentThinking}
													<span class="thinking-tag">:{finding.currentThinking}</span>
												{/if}
											</div>

											<span class="diff-arrow"><IconArrowRight /></span>

											<div class="model-box new">
												<span class="box-label">Suggerito</span>
												<span class="box-val">{finding.suggestedModelName || finding.suggestedSelector}</span>
												{#if finding.currentThinking}
													<span class="thinking-tag">:{finding.currentThinking}</span>
												{/if}
											</div>
										</div>
									{:else if finding.kind === 'fallback'}
										<div class="diff-row single">
											<div class="model-box old remove-target">
												<span class="box-label">Riserva da rimuovere</span>
												<span class="box-val">{finding.currentSelector}</span>
											</div>
										</div>
									{:else}
										<div class="diff-row single">
											<div class="model-box old invalid-target">
												<span class="box-label">{m.ui_modelhealthmodal_modello_attuale_non_valido_10a2()}</span>
												<span class="box-val">{finding.currentSelector}</span>
											</div>
										</div>
									{/if}

									<div class="reason-note">
										<span class="reason-text">{finding.reason}</span>
										{#if !actionable && finding.kind === 'primary'}
											<span class="manual-hint">{m.ui_modelhealthmodal_scegli_un_modello_attivo_nella_scheda_ruoli_9727()}</span>
										{/if}
									</div>
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			{#if modelSettingsStore.upgradeFindings && modelSettingsStore.upgradeFindings.length > 0}
				<div class="findings-group">
					<h4 class="group-title upgrade">
						<span class="group-dot upgrade"></span>
						<span>Aggiornamenti disponibili</span>
						<span class="group-count">({modelSettingsStore.upgradeFindings.length})</span>
					</h4>
					<div class="candidates-list">
						{#each modelSettingsStore.upgradeFindings as finding (getFindingKey(finding))}
							{@const roleMeta = getRoleMeta(finding.role)}
							{@const slotLabel = getSlotLabel(finding.kind, finding.index)}
							{@const key = getFindingKey(finding)}
							{@const actionable = isActionable(finding)}
							{@const isSelected = selectedKeys.includes(key)}

							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class="candidate-card"
								class:selected={isSelected}
								class:non-actionable={!actionable}
								onclick={() => {
									if (actionable) toggleSelect(key);
								}}
							>
								<div class="card-left">
									{#if actionable}
										<input
											type="checkbox"
											checked={isSelected}
											aria-label="Aggiorna modello per ruolo {roleMeta.label} ({slotLabel})"
											onclick={(e) => e.stopPropagation()}
											onchange={() => toggleSelect(key)}
										/>
									{/if}
								</div>

								<div class="card-content">
									<div class="role-badge-row">
										<span class="role-abbr-badge">{roleMeta.abbr}</span>
										<span class="role-name">{roleMeta.label}</span>
										<span class="slot-badge" class:fallback={finding.kind === 'fallback'}>{slotLabel}</span>
										<span class="provider-tag">{finding.currentProvider}</span>
										<span class="action-tag replace">Aggiorna</span>
									</div>

									<div class="diff-row">
										<div class="model-box old">
											<span class="box-label">Attuale</span>
											<span class="box-val">{finding.currentModelId}</span>
											{#if finding.currentThinking}
												<span class="thinking-tag">:{finding.currentThinking}</span>
											{/if}
										</div>

										<span class="diff-arrow"><IconArrowRight /></span>

										<div class="model-box new">
											<span class="box-label">Suggerito</span>
											<span class="box-val">{finding.suggestedModelName || finding.suggestedSelector}</span>
											{#if finding.currentThinking}
												<span class="thinking-tag">:{finding.currentThinking}</span>
											{/if}
										</div>
									</div>

									{#if finding.reason}
										<div class="reason-note">
											<span class="reason-text">{finding.reason}</span>
										</div>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			{#if (!modelSettingsStore.blockingFindings || modelSettingsStore.blockingFindings.length === 0) && (!modelSettingsStore.upgradeFindings || modelSettingsStore.upgradeFindings.length === 0)}
				<div class="empty-state">
					<p>Modelli verificati: nessun problema rilevato</p>
				</div>
			{/if}
		</div>

		<div class="dialog-footer">
			<div class="footer-hint">
				I livelli di reasoning configurati verranno preservati per i modelli sostituiti.
			</div>
			<div class="footer-actions">
				<button class="btn btn-secondary" onclick={handleClose}>{m.common_cancel()}</button>
				<button
					class="btn btn-secondary"
					disabled={modelSettingsStore.saving}
					onclick={handleDismiss}
					title={m.ui_modelhealthmodal_nasconde_gli_avvisi_fino_alla_prossima_verifica_3dbb()}
				>
					{m.models_health_dismiss_btn()}
				</button>
				<button
					class="btn btn-primary"
					disabled={selectedKeys.length === 0 || modelSettingsStore.saving}
					onclick={handleApply}
				>
					{#if modelSettingsStore.saving}
						Applicazione...
					{:else}
						Applica {selectedKeys.length} {selectedKeys.length === 1 ? 'Correzione' : 'Correzioni'}
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: color-mix(in srgb, var(--bg-base) 80%, black);
		opacity: 0.75;
		z-index: var(--z-toast);
	}

	.health-dialog {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 640px;
		max-width: 92vw;
		max-height: 85vh;
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-overlay);
		z-index: var(--z-tooltip);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.dialog-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--line);
		background: var(--bg-raised);
	}

	.header-titles h3 {
		margin: 0 0 2px 0;
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--ink);
	}

	.header-titles p {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.btn-close {
		width: 24px;
		height: 24px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		font-size: 18px;
		color: var(--ink-muted);
		cursor: pointer;
		line-height: 1;
		border-radius: var(--radius-sm);
		transition: background var(--dur-fast), color var(--dur-fast);
	}

	.btn-close:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.dialog-body {
		padding: var(--space-3) var(--space-4);
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		flex: 1;
		background: var(--bg-base);
	}

	.selection-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding-bottom: 2px;
	}

	.select-all-label {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: var(--text-xs);
		color: var(--ink-muted);
		cursor: pointer;
		user-select: none;
	}

	.findings-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.group-title {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0;
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.group-title.blocking {
		color: var(--warn);
	}

	.group-title.upgrade {
		color: var(--brand-ink);
	}

	.group-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
	}

	.group-dot.blocking {
		background: var(--warn);
	}

	.group-dot.upgrade {
		background: var(--brand);
	}

	.group-count {
		font-weight: 500;
		color: var(--ink-faint);
	}

	.candidates-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.candidate-card {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--space-3);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: border-color var(--dur-fast), background var(--dur-fast);
	}

	.candidate-card:hover {
		border-color: var(--line-strong);
	}

	.candidate-card.selected {
		border-color: var(--brand);
		background: var(--bg-base);
	}

	.candidate-card.blocking-card {
		border-left: 3px solid var(--warn);
	}

	.candidate-card.non-actionable {
		cursor: default;
	}

	.card-left {
		padding-top: 2px;
	}

	.no-action-indicator {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--warn);
	}

	.card-content {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.role-badge-row {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}

	.role-abbr-badge {
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 600;
		color: var(--ink);
		background: var(--bg-hover);
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
	}

	.role-name {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink);
	}

	.slot-badge {
		font-size: 10px;
		font-weight: 500;
		color: var(--ink-muted);
		background: var(--bg-hover);
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
	}

	.slot-badge.fallback {
		color: var(--ink-faint);
	}

	.provider-tag {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--ink-faint);
		background: var(--bg-hover);
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
	}

	.action-tag {
		font-size: 10px;
		font-weight: 600;
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		margin-left: auto;
	}

	.action-tag.replace {
		background: color-mix(in srgb, var(--brand) 15%, transparent);
		color: var(--brand-ink);
		border: 1px solid color-mix(in srgb, var(--brand) 30%, transparent);
	}

	.action-tag.remove {
		background: color-mix(in srgb, var(--warn) 15%, transparent);
		color: var(--warn);
		border: 1px solid color-mix(in srgb, var(--warn) 30%, transparent);
	}

	.action-tag.manual {
		background: color-mix(in srgb, var(--danger) 12%, transparent);
		color: var(--danger);
		border: 1px solid color-mix(in srgb, var(--danger) 25%, transparent);
	}

	.diff-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.model-box {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 4px 8px;
		border-radius: var(--radius-sm);
		background: var(--bg-base);
		border: 1px solid var(--line);
		min-width: 0;
	}

	.model-box.new {
		border-color: var(--brand-dim);
	}

	.model-box.remove-target {
		border-color: color-mix(in srgb, var(--warn) 35%, transparent);
		background: color-mix(in srgb, var(--warn) 6%, var(--bg-base));
	}

	.model-box.invalid-target {
		border-color: color-mix(in srgb, var(--danger) 35%, transparent);
		background: color-mix(in srgb, var(--danger) 6%, var(--bg-base));
	}

	.box-label {
		font-size: 9px;
		font-weight: 500;
		color: var(--ink-faint);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.box-val {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.model-box.new .box-val {
		color: var(--brand-ink);
		font-weight: 600;
	}

	.thinking-tag {
		color: var(--ink-faint);
		font-size: 10px;
	}

	.diff-arrow {
		color: var(--ink-faint);
		font-size: 13px;
		flex-shrink: 0;
	}

	.reason-note {
		font-size: 11px;
		color: var(--ink-faint);
		line-height: 1.35;
	}

	.manual-hint {
		color: var(--warn);
		font-weight: 500;
	}

	.empty-state {
		padding: var(--space-6) var(--space-4);
		text-align: center;
		color: var(--ink-muted);
		font-size: var(--text-sm);
	}

	.dialog-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-4);
		border-top: 1px solid var(--line);
		background: var(--bg-raised);
		gap: var(--space-3);
		min-height: 48px;
	}

	.footer-hint {
		font-size: 11px;
		color: var(--ink-faint);
	}

	.footer-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-shrink: 0;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 5px 12px;
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
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

	.btn-primary {
		background: var(--brand);
		color: var(--on-brand);
	}

	.btn-primary:hover:not(:disabled) {
		filter: brightness(1.08);
	}

	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
