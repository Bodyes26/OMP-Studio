<script lang="ts">
	import { open as openDialog } from '@tauri-apps/plugin-dialog';
	import {
		settingsStore,
		type DefaultSurface,
		type CloseWithQueuedTasks,
		type ChatWidth,
		type ChatReveal,
		type StreamingBehavior,
		type QueueMode,
		type InterruptMode,
		type LanguagePreference
	} from '$lib/stores/settings.svelte';
	import { projectStore } from '$lib/stores/projects.svelte';
	import { studioUpdaterStore } from '$lib/stores/studioUpdater.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import Switch from '$lib/ui/Switch.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';

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
				<label for="settings-language" id="settings-language-label" class="form-row-label">{m.settings_language_title()}</label>
				<span id="settings-language-desc" class="form-row-desc">{m.settings_language_description()}</span>
			</div>
			<div class="form-row-control">
				<select
					id="settings-language"
					class="ui-select"
					value={settingsStore.general.language}
					aria-labelledby="settings-language-label"
					aria-describedby="settings-language-desc"
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
				<label for="settings-default-surface" id="settings-default-surface-label" class="form-row-label">{m.settings_general_start_surface_title()}</label>
				<span id="settings-default-surface-desc" class="form-row-desc">{m.settings_general_start_surface_desc()}</span>
			</div>
			<div class="form-row-control">
				<select
					id="settings-default-surface"
					class="ui-select"
					value={settingsStore.general.defaultSurface}
					aria-labelledby="settings-default-surface-label"
					aria-describedby="settings-default-surface-desc"
					onchange={(e) => settingsStore.patchGeneral({ defaultSurface: (e.currentTarget as HTMLSelectElement).value as DefaultSurface })}
				>
					<option value="terminal">{m.settings_general_terminal()}</option>
					<option value="gui">{m.settings_general_editor_gui()}</option>
				</select>
			</div>
		</div>

		<div class="form-row">
			<div class="form-row-copy">
				<label for="settings-close-queue" id="settings-close-queue-label" class="form-row-label">{m.settings_general_close_queue_title()}</label>
				<span id="settings-close-queue-desc" class="form-row-desc">{m.settings_general_close_queue_desc()}</span>
			</div>
			<div class="form-row-control">
				<select
					id="settings-close-queue"
					class="ui-select"
					value={settingsStore.general.closeWithQueuedTasks}
					aria-labelledby="settings-close-queue-label"
					aria-describedby="settings-close-queue-desc"
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
				<label for="settings-chat-width" id="settings-chat-width-label" class="form-row-label">{m.settings_general_chat_width_title()}</label>
				<span id="settings-chat-width-desc" class="form-row-desc">{m.settings_general_chat_width_desc()}</span>
			</div>
			<div class="form-row-control">
				<select
					id="settings-chat-width"
					class="ui-select"
					value={settingsStore.general.chatWidth}
					aria-labelledby="settings-chat-width-label"
					aria-describedby="settings-chat-width-desc"
					onchange={(e) => settingsStore.patchGeneral({ chatWidth: (e.currentTarget as HTMLSelectElement).value as ChatWidth })}
				>
					<option value="readable">{m.settings_general_chat_readable()}</option>
					<option value="full">{m.settings_general_chat_full()}</option>
				</select>
			</div>
		</div>

		<div class="form-row">
			<div class="form-row-copy">
				<label for="settings-chat-reveal" id="settings-chat-reveal-label" class="form-row-label">{m.settings_general_chat_reveal_title()}</label>
				<span id="settings-chat-reveal-desc" class="form-row-desc">{m.settings_general_chat_reveal_desc()}</span>
			</div>
			<div class="form-row-control">
				<select
					id="settings-chat-reveal"
					class="ui-select"
					value={settingsStore.general.chatReveal}
					aria-labelledby="settings-chat-reveal-label"
					aria-describedby="settings-chat-reveal-desc"
					onchange={(e) => settingsStore.patchGeneral({ chatReveal: (e.currentTarget as HTMLSelectElement).value as ChatReveal })}
				>
					<option value="blur">{m.settings_general_chat_reveal_blur()}</option>
					<option value="stream">{m.settings_general_chat_reveal_stream()}</option>
					<option value="final">{m.settings_general_chat_reveal_final()}</option>
				</select>
			</div>
		</div>

		<div class="form-row">
			<div class="form-row-copy">
				<span id="settings-internal-messages-label" class="form-row-label">{m.settings_general_internal_messages_title()}</span>
				<span id="settings-internal-messages-desc" class="form-row-desc">{m.settings_general_internal_messages_desc()}</span>
			</div>
			<div class="form-row-control">
				<Switch
					id="settings-internal-messages"
					checked={settingsStore.general.showInternalAgentMessages}
					ariaLabelledBy="settings-internal-messages-label"
					ariaDescribedBy="settings-internal-messages-desc"
					onChange={(checked) => settingsStore.patchGeneral({ showInternalAgentMessages: checked })}
				/>
			</div>
		</div>
	</div>

	<div class="section-group">
		<div class="form-row">
			<div class="form-row-copy">
				<span id="settings-lab-alpha-label" class="form-row-label">{m.settings_general_lab_alpha_title()}</span>
				<span id="settings-lab-alpha-desc" class="form-row-desc">{m.settings_general_lab_alpha_desc()}</span>
			</div>
			<div class="form-row-control">
				<Switch
					id="settings-lab-alpha"
					checked={settingsStore.general.labAlphaEnabled}
					ariaLabelledBy="settings-lab-alpha-label"
					ariaDescribedBy="settings-lab-alpha-desc"
					onChange={(checked) => settingsStore.patchGeneral({ labAlphaEnabled: checked })}
				/>
			</div>
		</div>
	</div>

	<div class="section-group">
		<div class="form-row">
			<div class="form-row-copy">
				<span id="settings-sidebar-collapsed-label" class="form-row-label">{m.settings_general_sidebar_title()}</span>
				<span id="settings-sidebar-collapsed-desc" class="form-row-desc">{m.settings_general_sidebar_desc()}</span>
			</div>
			<div class="form-row-control">
				<Switch
					id="settings-sidebar-collapsed"
					checked={!settingsStore.general.sidebarCollapsed}
					ariaLabelledBy="settings-sidebar-collapsed-label"
					ariaDescribedBy="settings-sidebar-collapsed-desc"
					onChange={(checked) => settingsStore.patchGeneral({ sidebarCollapsed: !checked })}
				/>
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
				<button type="button" class="ui-button ui-button-secondary" onclick={browseProjectRoot}>{m.settings_general_change_folder()}</button>
			</div>
		</div>
	</div>

	<div class="section-group">
		<div class="form-row">
			<div class="form-row-copy">
				<span id="settings-update-channel-label" class="form-row-label">{m.settings_general_update_channel_title()}</span>
				<span id="settings-update-channel-desc" class="form-row-desc">{m.settings_general_update_channel_desc()}</span>
			</div>
			<div class="form-row-control">
				<Segmented
					name="settings-update-channel"
					mode="radiogroup"
					disabled={studioUpdaterStore.channelChangeDisabled}
					value={studioUpdaterStore.channel}
					ariaLabelledBy="settings-update-channel-label"
					ariaDescribedBy="settings-update-channel-desc"
					options={[
						{ value: 'stable', label: m.settings_general_stable() },
						{ value: 'nightly', label: 'Nightly' }
					]}
					onChange={(val) => void studioUpdaterStore.setChannel(val as 'stable' | 'nightly')}
				/>
			</div>
		</div>
	</div>

	<div class="section-group">
		<div class="form-row">
			<div class="form-row-copy">
				<label for="settings-submit-behavior" id="settings-submit-behavior-label" class="form-row-label">{m.settings_general_submit_behavior_title()}</label>
				<span id="settings-submit-behavior-desc" class="form-row-desc">{m.settings_general_submit_behavior_desc()}</span>
			</div>
			<div class="form-row-control">
				<select
					id="settings-submit-behavior"
					class="ui-select"
					value={settingsStore.general.defaultStreamingBehavior}
					aria-labelledby="settings-submit-behavior-label"
					aria-describedby="settings-submit-behavior-desc"
					onchange={(e) => settingsStore.patchGeneral({ defaultStreamingBehavior: (e.currentTarget as HTMLSelectElement).value as StreamingBehavior })}
				>
					<option value="steer">{m.settings_general_steer_option()}</option>
					<option value="followUp">{m.settings_general_follow_up_option()}</option>
				</select>
			</div>
		</div>

		<div class="form-row">
			<div class="form-row-copy">
				<label for="settings-steer-dequeue" id="settings-steer-dequeue-label" class="form-row-label">{m.settings_general_steer_dequeue_title()}</label>
				<span id="settings-steer-dequeue-desc" class="form-row-desc">{m.settings_general_steer_dequeue_desc()}</span>
			</div>
			<div class="form-row-control">
				<select
					id="settings-steer-dequeue"
					class="ui-select"
					value={settingsStore.general.steeringMode}
					aria-labelledby="settings-steer-dequeue-label"
					aria-describedby="settings-steer-dequeue-desc"
					onchange={(e) => settingsStore.patchGeneral({ steeringMode: (e.currentTarget as HTMLSelectElement).value as QueueMode })}
				>
					<option value="one-at-a-time">{m.settings_general_one_per_turn()}</option>
					<option value="all">{m.settings_general_all_together()}</option>
				</select>
			</div>
		</div>

		<div class="form-row">
			<div class="form-row-copy">
				<label for="settings-follow-up-dequeue" id="settings-follow-up-dequeue-label" class="form-row-label">{m.settings_general_follow_up_dequeue_title()}</label>
				<span id="settings-follow-up-dequeue-desc" class="form-row-desc">{m.settings_general_follow_up_dequeue_desc()}</span>
			</div>
			<div class="form-row-control">
				<select
					id="settings-follow-up-dequeue"
					class="ui-select"
					value={settingsStore.general.followUpMode}
					aria-labelledby="settings-follow-up-dequeue-label"
					aria-describedby="settings-follow-up-dequeue-desc"
					onchange={(e) => settingsStore.patchGeneral({ followUpMode: (e.currentTarget as HTMLSelectElement).value as QueueMode })}
				>
					<option value="one-at-a-time">{m.settings_general_one_per_turn()}</option>
					<option value="all">{m.settings_general_all_together()}</option>
				</select>
			</div>
		</div>

		<div class="form-row">
			<div class="form-row-copy">
				<label for="settings-tool-interrupt" id="settings-tool-interrupt-label" class="form-row-label">{m.settings_general_tool_interrupt_title()}</label>
				<span id="settings-tool-interrupt-desc" class="form-row-desc">{m.settings_general_tool_interrupt_desc()}</span>
			</div>
			<div class="form-row-control">
				<select
					id="settings-tool-interrupt"
					class="ui-select"
					value={settingsStore.general.interruptMode}
					aria-labelledby="settings-tool-interrupt-label"
					aria-describedby="settings-tool-interrupt-desc"
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
		font-size: var(--text-label);
		font-weight: 500;
		color: var(--ink);
	}

	.form-row-desc {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.form-row-path {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
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

	.form-row-control select {
		min-width: 180px;
	}


</style>
