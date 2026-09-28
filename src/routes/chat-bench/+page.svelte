<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { onMount } from 'svelte';
	import Chat from '$lib/agent/components/Chat.svelte';
	import { AgentSession } from '$lib/agent/session.svelte';
	import { FakeOmpRpcClient } from '$lib/agent/bench/fakeClient';
	import { BenchReplayDriver } from '$lib/agent/bench/driver.svelte';
	import { SCENARIOS } from '$lib/agent/bench/scenarios';
	import { THEMES, THEME_GROUPS, anchorsFor, applyAnchors } from '$lib/theme';
	import { settingsStore, type ChatReveal } from '$lib/stores/settings.svelte';
	import { setAgentUiHooks } from '$lib/agent/ui-context';

	// Guardia runtime dev-only
	if (!import.meta.env.DEV) {
		throw new Error('Chat bench è disponibile solo in ambiente di sviluppo (DEV).');
	}

	const client = new FakeOmpRpcClient();
	const session = new AgentSession({
		cwd: 'C:/Users/maurizio.actisalesin/source/repos/omp-studio-app',
		client
	});
	const driver = new BenchReplayDriver(session, client);

	let selectedScenarioKey = $state(SCENARIOS[0]?.key ?? '1');
	let selectedTheme = $state('titanium');
	const speedOptions = [0.25, 0.5, 1, 2, 4];

	setAgentUiHooks({
		openFile: (path, line) => console.log('[Bench] openFile:', path, line),
		openImage: (data, mime) => console.log('[Bench] openImage:', mime, data.slice(0, 30)),
		openSubagent: (id) => console.log('[Bench] openSubagent:', id),
		switchToTerminal: () => console.log('[Bench] switchToTerminal')
	});

	function handleScenarioChange() {
		const target = SCENARIOS.find((s) => s.key === selectedScenarioKey);
		if (target) {
			void driver.loadScenario(target, true);
		}
	}

	function handleThemeChange() {
		const theme = THEMES[selectedTheme];
		if (theme) {
			applyAnchors(anchorsFor(theme));
		}
	}

	function handleSpeedChange(newSpeed: number) {
		driver.setSpeed(newSpeed);
	}

	function handleRevealChange(event: Event) {
		const val = (event.target as HTMLSelectElement).value as ChatReveal;
		settingsStore.general.chatReveal = val;
	}

	function handleAnimationsChange(event: Event) {
		const checked = (event.target as HTMLInputElement).checked;
		settingsStore.accessibility.animations = checked;
	}

	onMount(() => {
		// Applica il tema predefinito all'avvio del bench
		handleThemeChange();

		// Carica il primo scenario
		const initial = SCENARIOS.find((s) => s.key === selectedScenarioKey) ?? SCENARIOS[0];
		if (initial) {
			void driver.loadScenario(initial, true);
		}
	});
</script>

<svelte:head>
	<title>{m.chat_bench_title()} · OMP Studio</title>
</svelte:head>

<div class="bench-layout">
	<header class="bench-toolbar">
		<div class="toolbar-section primary">
			<span class="toolbar-title">{m.chat_bench_title()}</span>

			<label class="control-group">
				<span class="control-label">{m.chat_bench_scenario()}:</span>
				<select
					class="bench-select scenario-select"
					bind:value={selectedScenarioKey}
					onchange={handleScenarioChange}
				>
					{#each SCENARIOS as sc (sc.key)}
						<option value={sc.key}>#{sc.key} — {sc.name}</option>
					{/each}
				</select>
			</label>

			<div class="playback-controls">
				{#if driver.status === 'playing'}
					<button
						type="button"
						class="bench-btn pause-btn"
						onclick={() => driver.pause()}
						title={m.chat_bench_pause()}
					>
						⏸ {m.chat_bench_pause()}
					</button>
				{:else}
					<button
						type="button"
						class="bench-btn play-btn"
						onclick={() => void driver.play()}
						title={m.chat_bench_play()}
					>
						▶ {m.chat_bench_play()}
					</button>
				{/if}

				<button
					type="button"
					class="bench-btn restart-btn"
					onclick={() => void driver.restart()}
					title={m.chat_bench_restart()}
				>
					↺ {m.chat_bench_restart()}
				</button>
			</div>

			<div class="speed-selector">
				<span class="control-label">{m.chat_bench_speed()}:</span>
				{#each speedOptions as sp}
					<button
						type="button"
						class="bench-btn speed-btn"
						class:active={driver.speed === sp}
						onclick={() => handleSpeedChange(sp)}
					>
						{sp}x
					</button>
				{/each}
			</div>
		</div>

		<div class="toolbar-section secondary">
			<label class="control-group">
				<span class="control-label">{m.chat_bench_theme()}:</span>
				<select
					class="bench-select theme-select"
					bind:value={selectedTheme}
					onchange={handleThemeChange}
				>
					{#each THEME_GROUPS as group}
						<optgroup label={group.label}>
							{#each group.names as name}
								<option value={name}>{name}</option>
							{/each}
						</optgroup>
					{/each}
				</select>
			</label>

			<label class="control-group">
				<span class="control-label">{m.chat_bench_reveal()}:</span>
				<select
					class="bench-select reveal-select"
					value={settingsStore.general.chatReveal}
					onchange={handleRevealChange}
				>
					<option value="blur">blur (per frase)</option>
					<option value="stream">stream (token)</option>
					<option value="final">final (tutto insieme)</option>
				</select>
			</label>

			<label class="control-group checkbox-group">
				<input
					type="checkbox"
					checked={settingsStore.accessibility.animations}
					onchange={handleAnimationsChange}
				/>
				<span class="control-label">{m.chat_bench_animations()}</span>
			</label>

			<div class="status-indicator">
				<span class="status-badge {driver.status}">
					{#if driver.status === 'playing'}
						● {m.chat_bench_status_playing()}
					{:else if driver.status === 'paused'}
						❚❚ {m.chat_bench_status_paused()}
					{:else if driver.status === 'waiting_ui'}
						⏳ {m.chat_bench_status_waiting_ui()}
					{:else if driver.status === 'completed'}
						✔ {m.chat_bench_status_completed()}
					{:else}
						○ {m.chat_bench_status_idle()}
					{/if}
				</span>

				{#if driver.totalParts > 0}
					<span class="progress-text">
						{m.chat_bench_part({ current: driver.currentPartIndex, total: driver.totalParts })}
					</span>
				{/if}

				<span class="elapsed-text">
					{(driver.elapsedMs / 1000).toFixed(1)}s
				</span>
			</div>
		</div>
	</header>

	{#if driver.scenario}
		<div class="scenario-banner">
			<span class="scenario-prompt"><strong>Prompt:</strong> “{driver.scenario.prompt}”</span>
			<span class="scenario-hint">{driver.scenario.hint}</span>
		</div>
	{/if}

	<main class="chat-container">
		<Chat
			{session}
			visible={true}
			onOpenFile={(path, line) => console.log('[ChatBench] openFile:', path, line)}
			onOpenImage={(data, mime) => console.log('[ChatBench] openImage:', mime)}
			onNewChat={() => void driver.restart()}
		/>
	</main>
</div>

<style>
	.bench-layout {
		display: flex;
		flex-direction: column;
		height: 100vh;
		width: 100vw;
		background: var(--bg-sunken);
		color: var(--ink);
		font-family: var(--font-ui);
		overflow: hidden;
	}

	.bench-toolbar {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 8px 16px;
		background: var(--bg-base);
		border-bottom: 1px solid var(--line);
		font-size: 12px;
		z-index: 20;
	}

	.toolbar-section {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 12px;
	}

	.toolbar-title {
		font-weight: 600;
		color: var(--brand);
		margin-right: 4px;
	}

	.control-group {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.checkbox-group {
		cursor: pointer;
		user-select: none;
	}

	.control-label {
		color: var(--ink-muted);
		font-size: 11px;
	}

	.bench-select {
		background: var(--bg-sunken);
		color: var(--ink);
		border: 1px solid var(--line);
		border-radius: 4px;
		padding: 3px 8px;
		font-size: 12px;
		font-family: var(--font-ui);
		outline: none;
	}

	.bench-select:focus {
		border-color: var(--brand);
	}

	.scenario-select {
		font-weight: 500;
		max-width: 260px;
	}

	.playback-controls {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}

	.speed-selector {
		display: inline-flex;
		align-items: center;
		gap: 3px;
	}

	.bench-btn {
		background: var(--bg-raised);
		color: var(--ink);
		border: 1px solid var(--line);
		border-radius: 4px;
		padding: 3px 8px;
		font-size: 11px;
		font-family: var(--font-ui);
		cursor: pointer;
		transition: background 0.15s ease, border-color 0.15s ease;
	}

	.bench-btn:hover {
		background: var(--bg-hover);
		border-color: var(--line-strong);
	}

	.bench-btn.active {
		background: var(--brand);
		color: var(--brand-ink);
		border-color: var(--brand);
		font-weight: 600;
	}

	.status-indicator {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		margin-left: auto;
	}

	.status-badge {
		display: inline-block;
		padding: 2px 7px;
		border-radius: 999px;
		font-size: 11px;
		font-weight: 500;
	}

	.status-badge.idle {
		background: var(--bg-raised);
		color: var(--ink-muted);
	}

	.status-badge.playing {
		background: oklch(0.35 0.12 145);
		color: #e5ffe8;
	}

	.status-badge.paused {
		background: oklch(0.45 0.12 75);
		color: #fff9db;
	}

	.status-badge.waiting_ui {
		background: var(--warn);
		color: var(--bg-sunken);
		animation: pulse-waiting 1.5s infinite ease-in-out;
	}

	.status-badge.completed {
		background: oklch(0.35 0.1 220);
		color: #ebf5ff;
	}

	@keyframes pulse-waiting {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.65; }
	}

	.progress-text, .elapsed-text {
		color: var(--ink-faint);
		font-size: 11px;
		font-family: var(--font-mono);
	}

	.scenario-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 4px 16px;
		background: var(--bg-sunken);
		border-bottom: 1px solid var(--line);
		font-size: 11px;
	}

	.scenario-prompt {
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.scenario-hint {
		color: var(--ink-muted);
		flex-shrink: 0;
	}

	.chat-container {
		flex: 1;
		min-height: 0;
		position: relative;
		width: 100%;
	}
</style>
