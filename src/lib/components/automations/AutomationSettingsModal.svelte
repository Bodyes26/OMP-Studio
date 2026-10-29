<script lang="ts">
	import { automationsStore } from '#lib/automations/store.svelte.ts';
	import { t } from '#lib/automations/i18n.ts';
	import type { AutomationSettings } from '#lib/automations/types.ts';
	import Dialog from '#lib/ui/Dialog.svelte';
	import { IconSettings, IconCheck, IconWarning } from '#lib/icons.ts';

	interface Props {
		open: boolean;
		onClose: () => void;
	}

	let { open = false, onClose }: Props = $props();

	let currentSettings = $derived(automationsStore.snapshot?.settings);

	let maxAi = $state(1);
	let maxCommands = $state(1);
	let retentionDays = $state(90);
	let outputPerRunMb = $state(10);
	let outputTotalMb = $state(200);
	let assistantModelMode = $state<'role' | 'model'>('role');
	let assistantModel = $state('smol');
	let assistantAllowPayAsYouGo = $state(false);

	let isSaving = $state(false);
	let error = $state<string | null>(null);

	$effect(() => {
		if (currentSettings) {
			maxAi = currentSettings.maxAi ?? 1;
			maxCommands = currentSettings.maxCommands ?? 1;
			retentionDays = currentSettings.retentionDays ?? 90;
			outputPerRunMb = Math.round((currentSettings.outputPerRunBytes ?? 10 * 1024 * 1024) / (1024 * 1024));
			outputTotalMb = Math.round((currentSettings.outputTotalBytes ?? 200 * 1024 * 1024) / (1024 * 1024));
			assistantModelMode = currentSettings.assistantModelMode ?? 'role';
			assistantModel = currentSettings.assistantModel ?? 'smol';
			assistantAllowPayAsYouGo = currentSettings.assistantAllowPayAsYouGo ?? false;
		}
	});

	async function handleSave() {
		isSaving = true;
		error = null;
		try {
			const updated: AutomationSettings = {
				maxAi: Math.max(1, maxAi),
				maxCommands: Math.max(1, maxCommands),
				retentionDays: Math.max(1, retentionDays),
				outputPerRunBytes: Math.max(1, outputPerRunMb) * 1024 * 1024,
				outputTotalBytes: Math.max(10, outputTotalMb) * 1024 * 1024,
				assistantModelMode,
				assistantModel: assistantModel.trim() || 'smol',
				assistantAllowPayAsYouGo
			};
			await automationsStore.saveSettings(updated);
			onClose();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			isSaving = false;
		}
	}
</script>

{#if open}
	<Dialog
		title={t('settings_modal_title')}
		onClose={onClose}
	>
		<div class="settings-modal-body">
			<p class="dialog-subtitle text-xs" style="margin: -6px 0 10px; color: var(--ink-muted);">Limiti operativi e impostazioni generali per l'esecuzione in background</p>
			{#if error}
				<div class="settings-error-banner" role="alert">
					<IconWarning />
					<span>{error}</span>
				</div>
			{/if}

			<div class="settings-form">
				<!-- Concorrenza -->
				<fieldset class="form-section">
					<legend class="section-legend">Concorrenza massima globale</legend>
					<div class="field-row">
						<label for="set-max-ai" class="field-label-text">{t('settings_max_ai')}</label>
						<input
							id="set-max-ai"
							type="number"
							min="1"
							max="10"
							class="ui-input number-input font-mono text-xs"
							bind:value={maxAi}
						/>
					</div>
					<div class="field-row">
						<label for="set-max-cmd" class="field-label-text">{t('settings_max_commands')}</label>
						<input
							id="set-max-cmd"
							type="number"
							min="1"
							max="20"
							class="ui-input number-input font-mono text-xs"
							bind:value={maxCommands}
						/>
					</div>
				</fieldset>

				<!-- Limiti output e ritenzione -->
				<fieldset class="form-section">
					<legend class="section-legend">Conservazione e limiti di output</legend>
					<div class="field-row">
						<label for="set-retention" class="field-label-text">{t('settings_retention_days')}</label>
						<input
							id="set-retention"
							type="number"
							min="1"
							max="365"
							class="ui-input number-input font-mono text-xs"
							bind:value={retentionDays}
						/>
					</div>
					<div class="field-row">
						<label for="set-out-run" class="field-label-text">{t('settings_output_per_run')}</label>
						<input
							id="set-out-run"
							type="number"
							min="1"
							max="100"
							class="ui-input number-input font-mono text-xs"
							bind:value={outputPerRunMb}
						/>
					</div>
					<div class="field-row">
						<label for="set-out-tot" class="field-label-text">{t('settings_output_total')}</label>
						<input
							id="set-out-tot"
							type="number"
							min="10"
							max="5000"
							class="ui-input number-input font-mono text-xs"
							bind:value={outputTotalMb}
						/>
					</div>
				</fieldset>

				<!-- Assistente creazione AI -->
				<fieldset class="form-section">
					<legend class="section-legend">{t('settings_assistant_heading')}</legend>
					<div class="field-row">
						<label for="set-asst-mode" class="field-label-text">Modalità selezione</label>
						<select id="set-asst-mode" class="ui-input text-xs" bind:value={assistantModelMode}>
							<option value="role">Ruolo (es. smol, default)</option>
							<option value="model">Modello esplicito</option>
						</select>
					</div>
					<div class="field-row">
						<label for="set-asst-model" class="field-label-text">{t('settings_assistant_model')}</label>
						<input
							id="set-asst-model"
							type="text"
							class="ui-input font-mono text-xs"
							bind:value={assistantModel}
							placeholder="smol"
						/>
					</div>
					<div class="field-row-check">
						<label class="checkbox-label text-xs">
							<input type="checkbox" bind:checked={assistantAllowPayAsYouGo} />
							<span>{t('allow_pay_as_you_go')}</span>
						</label>
					</div>
				</fieldset>
			</div>

			<div class="modal-footer">
				<button type="button" class="ui-button ui-button-secondary text-xs" onclick={onClose}>
					{t('btn_cancel')}
				</button>
				<button
					type="button"
					class="ui-button ui-button-primary text-xs"
					onclick={handleSave}
					disabled={isSaving}
				>
					<IconCheck />
					<span>{t('settings_save_btn')}</span>
				</button>
			</div>
		</div>
	</Dialog>
{/if}

<style>
	.settings-modal-body {
		display: flex;
		flex-direction: column;
		gap: 16px;
		min-width: 440px;
		max-width: 540px;
	}

	.settings-error-banner {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		background: color-mix(in srgb, var(--danger) 12%, transparent);
		color: var(--danger);
		border-radius: var(--radius-sm);
		font-size: 12px;
	}

	.settings-form {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.form-section {
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: 12px 14px;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.section-legend {
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--ink-muted);
		padding: 0 4px;
	}

	.field-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
	}

	.field-label-text {
		font-size: 12px;
		color: var(--ink);
	}

	.number-input {
		width: 80px;
		text-align: right;
	}

	.field-row-check {
		display: flex;
		align-items: center;
		margin-top: 4px;
	}

	.checkbox-label {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		cursor: pointer;
		user-select: none;
		color: var(--ink);
	}

	.modal-footer {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		padding-top: 12px;
		border-top: 1px solid var(--line);
	}
</style>
