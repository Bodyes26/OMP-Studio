<script lang="ts">
	import { open as openDialog } from '@tauri-apps/plugin-dialog';
	import {
		settingsStore,
		type DefaultSurface,
		type CloseWithQueuedTasks,
		type ChatWidth,
		type StreamingBehavior,
		type QueueMode,
		type InterruptMode,
		type LanguagePreference
	} from '$lib/stores/settings.svelte';
	import { projectStore } from '$lib/stores/projects.svelte';
	import { studioUpdaterStore } from '$lib/stores/studioUpdater.svelte';
	import { m } from '$lib/paraglide/messages.js';

	async function browseProjectRoot() {
		const sel = await openDialog({ directory: true, defaultPath: projectStore.projectRoot });
		if (typeof sel === 'string') {
			projectStore.setProjectRoot(sel);
		}
	}
</script>

<div class="settings-section">
	<div class="section-group">
		<div class="form-row">
			<div class="form-row-copy">
				<span class="form-row-label">{m.settings_language_title()}</span>
				<span class="form-row-desc">{m.settings_language_description()}</span>
			</div>
			<div class="form-row-control">
				<select
					value={settingsStore.general.language}
					aria-label={m.settings_language_title()}
					onchange={(e) => settingsStore.patchGeneral({ language: (e.currentTarget as HTMLSelectElement).value as LanguagePreference })}
				>
					<option value="system">{m.settings_language_system()}</option>
					<option value="it">{m.settings_language_italian()}</option>
					<option value="en">{m.settings_language_english()}</option>
				</select>
			</div>
		</div>

		<div class="form-row">
			<div class="form-row-copy">
				<span class="form-row-label">{m.settings_general_start_surface_title()}</span>
				<span class="form-row-desc">{m.settings_general_start_surface_desc()}</span>
			</div>
			<div class="form-row-control">
				<select
					value={settingsStore.general.defaultSurface}
					onchange={(e) => settingsStore.patchGeneral({ defaultSurface: (e.currentTarget as HTMLSelectElement).value as DefaultSurface })}
				>
					<option value="terminal">{m.settings_general_terminal()}</option>
					<option value="gui">{m.settings_general_editor_gui()}</option>
				</select>
			</div>
		</div>

		<div class="form-row">
			<div class="form-row-copy">
				<span class="form-row-label">{m.settings_general_close_queue_title()}</span>
				<span class="form-row-desc">{m.settings_general_close_queue_desc()}</span>
			</div>
			<div class="form-row-control">
				<select
					value={settingsStore.general.closeWithQueuedTasks}
					onchange={(e) => settingsStore.patchGeneral({ closeWithQueuedTasks: (e.currentTarget as HTMLSelectElement).value as CloseWithQueuedTasks })}
				>
					<option value="ask">{m.settings_general_ask_confirmation()}</option>
					<option value="keep">{m.settings_general_keep_queue()}</option>
					<option value="discard">{m.settings_general_discard_queue()}</option>
				</select>
			</div>
		</div>

		<div class="form-row">
			<div class="form-row-copy">
				<span class="form-row-label">{m.settings_general_chat_width_title()}</span>
				<span class="form-row-desc">{m.settings_general_chat_width_desc()}</span>
			</div>
			<div class="form-row-control">
				<select
					value={settingsStore.general.chatWidth}
					onchange={(e) => settingsStore.patchGeneral({ chatWidth: (e.currentTarget as HTMLSelectElement).value as ChatWidth })}
				>
					<option value="readable">{m.settings_general_chat_readable()}</option>
					<option value="full">{m.settings_general_chat_full()}</option>
				</select>
			</div>
		</div>

		<div class="form-row">
			<div class="form-row-copy">
				<span class="form-row-label">{m.settings_general_internal_messages_title()}</span>
				<span class="form-row-desc">{m.settings_general_internal_messages_desc()}</span>
			</div>
			<div class="form-row-control">
				<label class="switch">
					<input
						type="checkbox"
						checked={settingsStore.general.showInternalAgentMessages}
						onchange={(e) => settingsStore.patchGeneral({ showInternalAgentMessages: (e.currentTarget as HTMLInputElement).checked })}
					/>
					<span class="slider"></span>
				</label>
			</div>
		</div>
	</div>

	<div class="section-group">
		<div class="form-row">
			<div class="form-row-copy">
				<span class="form-row-label">{m.settings_general_sidebar_title()}</span>
				<span class="form-row-desc">{m.settings_general_sidebar_desc()}</span>
			</div>
			<div class="form-row-control">
				<label class="switch">
					<input
						type="checkbox"
						checked={!settingsStore.general.sidebarCollapsed}
						onchange={(e) => settingsStore.patchGeneral({ sidebarCollapsed: !(e.currentTarget as HTMLInputElement).checked })}
					/>
					<span class="slider"></span>
				</label>
			</div>
		</div>
	</div>

	<div class="section-group">
		<div class="form-row">
			<div class="form-row-copy">
				<span class="form-row-label">{m.settings_general_project_folder_title()}</span>
				<span class="form-row-desc">{m.settings_general_project_folder_desc()}</span>
				<span class="form-row-path" title={projectStore.projectRoot}>{projectStore.projectRoot}</span>
			</div>
			<div class="form-row-control">
				<button type="button" class="btn btn-secondary" onclick={browseProjectRoot}>{m.settings_general_change_folder()}</button>
			</div>
		</div>
	</div>

	<div class="section-group">
		<div class="form-row">
			<div class="form-row-copy">
				<span class="form-row-label">{m.settings_general_update_channel_title()}</span>
				<span class="form-row-desc">{m.settings_general_update_channel_desc()}</span>
			</div>
			<div class="form-row-control">
				<fieldset class="channel-options" disabled={studioUpdaterStore.channelChangeDisabled}>
					<label class="channel-option" class:checked={studioUpdaterStore.channel === 'stable'}>
						<input
							type="radio"
							name="settings-update-channel"
							value="stable"
							checked={studioUpdaterStore.channel === 'stable'}
							onchange={() => void studioUpdaterStore.setChannel('stable')}
						/>
						<span class="channel-name">{m.settings_general_stable()}</span>
					</label>
					<label class="channel-option" class:checked={studioUpdaterStore.channel === 'nightly'}>
						<input
							type="radio"
							name="settings-update-channel"
							value="nightly"
							checked={studioUpdaterStore.channel === 'nightly'}
							onchange={() => void studioUpdaterStore.setChannel('nightly')}
						/>
						<span class="channel-name">Nightly</span>
					</label>
				</fieldset>
			</div>
		</div>
	</div>

	<div class="section-group">
		<div class="form-row">
			<div class="form-row-copy">
				<span class="form-row-label">{m.settings_general_submit_behavior_title()}</span>
				<span class="form-row-desc">{m.settings_general_submit_behavior_desc()}</span>
			</div>
			<div class="form-row-control">
				<select
					value={settingsStore.general.defaultStreamingBehavior}
					onchange={(e) => settingsStore.patchGeneral({ defaultStreamingBehavior: (e.currentTarget as HTMLSelectElement).value as StreamingBehavior })}
				>
					<option value="steer">{m.settings_general_steer_option()}</option>
					<option value="followUp">{m.settings_general_follow_up_option()}</option>
				</select>
			</div>
		</div>

		<div class="form-row">
			<div class="form-row-copy">
				<span class="form-row-label">{m.settings_general_steer_dequeue_title()}</span>
				<span class="form-row-desc">{m.settings_general_steer_dequeue_desc()}</span>
			</div>
			<div class="form-row-control">
				<select
					value={settingsStore.general.steeringMode}
					onchange={(e) => settingsStore.patchGeneral({ steeringMode: (e.currentTarget as HTMLSelectElement).value as QueueMode })}
				>
					<option value="one-at-a-time">{m.settings_general_one_per_turn()}</option>
					<option value="all">{m.settings_general_all_together()}</option>
				</select>
			</div>
		</div>

		<div class="form-row">
			<div class="form-row-copy">
				<span class="form-row-label">{m.settings_general_follow_up_dequeue_title()}</span>
				<span class="form-row-desc">{m.settings_general_follow_up_dequeue_desc()}</span>
			</div>
			<div class="form-row-control">
				<select
					value={settingsStore.general.followUpMode}
					onchange={(e) => settingsStore.patchGeneral({ followUpMode: (e.currentTarget as HTMLSelectElement).value as QueueMode })}
				>
					<option value="one-at-a-time">{m.settings_general_one_per_turn()}</option>
					<option value="all">{m.settings_general_all_together()}</option>
				</select>
			</div>
		</div>

		<div class="form-row">
			<div class="form-row-copy">
				<span class="form-row-label">{m.settings_general_tool_interrupt_title()}</span>
				<span class="form-row-desc">{m.settings_general_tool_interrupt_desc()}</span>
			</div>
			<div class="form-row-control">
				<select
					value={settingsStore.general.interruptMode}
					onchange={(e) => settingsStore.patchGeneral({ interruptMode: (e.currentTarget as HTMLSelectElement).value as InterruptMode })}
				>
					<option value="immediate">{m.settings_general_immediate()}</option>
					<option value="wait">{m.settings_general_wait_turn_end()}</option>
				</select>
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

	.form-row-path {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		margin-top: 2px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 420px;
	}

	.form-row-control {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	select {
		height: 30px;
		padding: 0 var(--space-2);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		outline: none;
		transition: border-color var(--dur-fast);
		min-width: 180px;
	}

	select:focus {
		border-color: var(--brand);
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

	.channel-options {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-sunken);
		margin: 0;
		padding: 3px;
	}

	.channel-options:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.channel-option {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: 5px var(--space-3);
		border-radius: var(--radius-sm);
		border: 1px solid transparent;
		cursor: pointer;
		font-size: var(--text-xs);
		color: var(--ink-muted);
		background: transparent;
		transition: background var(--dur-fast) var(--ease-out),
		            border-color var(--dur-fast) var(--ease-out),
		            color var(--dur-fast) var(--ease-out);
	}

	.channel-option:hover {
		color: var(--ink);
		background: var(--bg-hover);
	}

	.channel-option.checked {
		color: var(--ink);
		font-weight: 500;
		background: var(--bg-raised);
		border-color: var(--line-strong);
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
	}

	.channel-options:disabled .channel-option {
		cursor: not-allowed;
	}

	.channel-name {
		user-select: none;
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

	input:focus-visible + .slider {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
	}
</style>
