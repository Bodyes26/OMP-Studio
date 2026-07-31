<script lang="ts">
	import { projectStore, PRESET_HUES } from '$lib/stores/projects.svelte';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import { onMount } from 'svelte';

	let { onUsageClick, onNewProject } = $props<{ onUsageClick?: () => void; onNewProject?: () => void }>();

	const appWindow = getCurrentWindow();

	let isMaximized = $state(false);
	let hoveredTabId = $state<string | null>(null);
	let hoverTimer: any = null;
	let mouseInsidePopover = false;
	let colorInputEl = $state<HTMLInputElement | null>(null);

	function hexToHue(hex: string): number {
		let c = hex.replace('#', '');
		if (c.length === 3) c = c.split('').map(x => x + x).join('');
		const num = parseInt(c, 16);
		const r = ((num >> 16) & 255) / 255;
		const g = ((num >> 8) & 255) / 255;
		const b = (num & 255) / 255;

		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		const d = max - min;

		if (d === 0) return 0;

		let h = 0;
		if (max === r) {
			h = ((g - b) / d) % 6;
		} else if (max === g) {
			h = (b - r) / d + 2;
		} else {
			h = (r - g) / d + 4;
		}

		h = Math.round(h * 60);
		if (h < 0) h += 360;
		return h;
	}

	function handleCustomColorChange(projectId: string, hex: string) {
		const hue = hexToHue(hex);
		projectStore.setProjectHue(projectId, hue);
	}

	onMount(() => {
		let unlisten: any;
		appWindow.isMaximized().then(max => isMaximized = max);
		appWindow.onResized(() => {
			appWindow.isMaximized().then(max => isMaximized = max);
		}).then(u => unlisten = u);

		return () => {
			if (unlisten) unlisten();
		};
	});

	function getInitials(name: string) {
		return name.slice(0, 2).toUpperCase();
	}

	function handleTabMouseEnter(id: string) {
		if (hoverTimer) clearTimeout(hoverTimer);
		hoverTimer = setTimeout(() => {
			hoveredTabId = id;
		}, 300);
	}

	function handleTabMouseLeave() {
		if (hoverTimer) clearTimeout(hoverTimer);
		hoverTimer = setTimeout(() => {
			if (!mouseInsidePopover) {
				hoveredTabId = null;
			}
		}, 150);
	}

	function handlePopoverMouseEnter() {
		mouseInsidePopover = true;
		if (hoverTimer) clearTimeout(hoverTimer);
	}

	function handlePopoverMouseLeave() {
		mouseInsidePopover = false;
		hoveredTabId = null;
	}

	function handleMinimize(e: MouseEvent) {
		e.stopPropagation();
		appWindow.minimize().catch(err => console.error("Minimize error:", err));
	}

	async function handleToggleMaximize(e: MouseEvent) {
		e.stopPropagation();
		try {
			await appWindow.toggleMaximize();
			isMaximized = await appWindow.isMaximized();
		} catch (err) {
			console.error("Toggle maximize error:", err);
		}
	}

	function handleClose(e: MouseEvent) {
		e.stopPropagation();
		appWindow.close().catch(err => console.error("Close error:", err));
	}
</script>

<header class="topbar" data-tauri-drag-region="deep">
	<div class="brand-section">
		<div class="app-icon" title="OMP Studio">
			<img src="/logo-topbar.png" alt="OH MY π" class="brand-logo-img" />
		</div>
	</div>

	<div class="tabs">
		{#each projectStore.projects as p}
			<!-- svelte-ignore a11y_mouse_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div 
				class="tab-container"
				onmouseenter={() => handleTabMouseEnter(p.id)}
				onmouseleave={handleTabMouseLeave}
			>
				<button 
					class="tab"
					class:active={projectStore.activeId === p.id}
					class:working={p.agentState === 'working'}
					class:attention={p.agentState === 'attention'}
					class:finished={p.agentState === 'finished'}
					class:scratchpad={!p.path}
					style="--proj-hue: {p.hue}"
					onclick={() => projectStore.setActive(p.id)}
					title={p.name}
				>
					{#if !p.path}
						<svg class="ghost-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M9 10h.01M15 10h.01M12 2a8 8 0 0 0-8 8v12l3-3 3 3 4-4 4 4 3-3V10a8 8 0 0 0-8-8z"/>
						</svg>
					{:else}
						{getInitials(p.name)}
					{/if}

					{#if p.agentState === 'attention'}
						<span class="status-badge attention" title="L'agente richiede un intervento">!</span>
					{:else if p.agentState === 'finished'}
						<span class="status-badge finished" title="L'agente ha completato il lavoro">✓</span>
					{/if}
				</button>

				{#if hoveredTabId === p.id}
					<!-- svelte-ignore a11y_mouse_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div 
						class="tab-popover"
						onmouseenter={handlePopoverMouseEnter}
						onmouseleave={handlePopoverMouseLeave}
					>
						<div class="popover-header">
							<div class="popover-titles">
								<div class="popover-name">{p.name}</div>
								{#if p.path}
									<div class="popover-path-container">
										<div class="popover-path marquee" title={p.path}>{p.path}</div>
									</div>
								{:else}
									<div class="popover-path">Chat temporanea</div>
								{/if}
							</div>
						</div>

						<div class="popover-actions">
							{#if projectStore.activeId !== p.id}
								<button class="popover-btn" onclick={() => { projectStore.setActive(p.id); hoveredTabId = null; }}>
									<span class="btn-icon">✓</span> Seleziona progetto
								</button>
							{/if}
							{#if p.path}
								<button class="popover-btn" onclick={() => { revealItemInDir(p.path); hoveredTabId = null; }}>
									<span class="btn-icon">📁</span> Mostra nella cartella
								</button>
								<div class="popover-divider"></div>
								<div class="popover-section-label">Colore scheda</div>
								<div class="color-picker-grid">
									{#each PRESET_HUES as hue}
										<button 
											class="color-swatch"
											class:selected={p.hue === hue}
											style="--swatch-hue: {hue};"
											onclick={() => projectStore.setProjectHue(p.id, hue)}
											title="Cambia colore"
										></button>
									{/each}
									<button
										class="color-swatch custom-rainbow"
										class:selected={!PRESET_HUES.includes(p.hue)}
										onclick={() => colorInputEl?.click()}
										title="Colore personalizzato (color picker)"
									></button>
									<input
										type="color"
										bind:this={colorInputEl}
										class="hidden-color-input"
										onchange={(e) => handleCustomColorChange(p.id, e.currentTarget.value)}
									/>
								</div>
							{/if}
							<div class="popover-divider"></div>
							<button class="popover-btn danger" onclick={() => { projectStore.closeProject(p.id); hoveredTabId = null; }}>
								<span class="btn-icon">✕</span> Chiudi progetto
							</button>
						</div>
					</div>
				{/if}
			</div>
		{/each}

		<button class="tab-add" onclick={() => onNewProject?.()} title="Nuovo progetto (Ctrl+Alt+N)">+</button>
		<button class="tab-add" onclick={() => projectStore.openScratchpad()} title="Scratchpad (Ctrl+Alt+S)">*</button>
	</div>

	<div class="title">
		{projectStore.activeProject ? projectStore.activeProject.name : 'OMP Studio'}
	</div>

	<div class="controls">
		<button class="usage-chip" onclick={(e) => { e.stopPropagation(); onUsageClick?.(); }}>⚡ Quota</button>

		<div class="window-controls">
			<button class="win-btn" onclick={handleMinimize} title="Riduci a icona">
				<svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
			</button>
			<button class="win-btn" onclick={handleToggleMaximize} title={isMaximized ? "Ripristina" : "Ingrandisci"}>
				{#if isMaximized}
					<svg width="10" height="10" viewBox="0 0 10 10">
						<path d="M2.5 1h6v6h-1v-5h-5v-1zm-1.5 2.5h6v6h-6v-6zm1 1v4h4v-4h-4z" fill="currentColor"/>
					</svg>
				{:else}
					<svg width="10" height="10" viewBox="0 0 10 10">
						<path d="M1 1h8v8h-8v-8zm1 1v6h6v-6h-6z" fill="currentColor"/>
					</svg>
				{/if}
			</button>
			<button class="win-btn close" onclick={handleClose} title="Chiudi">
				<svg width="10" height="10" viewBox="0 0 10 10">
					<path d="M1 1l8 8m0-8l-8 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
				</svg>
			</button>
		</div>
	</div>
</header>

<style>
	.topbar {
		height: 38px;
		background-color: var(--bg-raised);
		border-bottom: 1px solid var(--line);
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 0 0 var(--space-2);
		z-index: var(--z-topbar);
		user-select: none;
		transition: height 0.25s cubic-bezier(0.4, 0, 0.2, 1);
		position: relative;
	}

	.topbar:hover {
		height: 60px;
	}

	.brand-section {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding-right: var(--space-2);
	}

	.app-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 26px;
	}

	.brand-logo-img {
		height: 22px;
		width: auto;
		object-fit: contain;
		transition: height 0.25s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.topbar:hover .brand-logo-img {
		height: 28px;
	}

	.tabs {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		z-index: 2;
		transition: gap 0.25s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.topbar:hover .tabs {
		gap: 14px;
	}

	.tab-container {
		position: relative;
		display: flex;
		align-items: center;
	}

	.tab, .tab-add {
		width: 26px;
		height: 26px;
		border-radius: var(--radius-md);
		border: none;
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 600;
		font-size: var(--text-sm);
		font-family: var(--font-mono);
		cursor: pointer;
		padding: 0;
		transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.topbar:hover .tab,
	.topbar:hover .tab-add {
		width: 36px;
		height: 36px;
		font-size: 13px;
		border-radius: var(--radius-md);
	}

	.tab {
		background-color: var(--bg-sunken);
		border: 1.5px solid oklch(0.65 0.15 var(--proj-hue));
		color: oklch(0.85 0.12 var(--proj-hue));
		position: relative;
	}

	.topbar:hover .tab:not(.active):not(.scratchpad) {
		background-color: oklch(0.25 0.05 var(--proj-hue));
		border: 1.5px solid oklch(0.55 0.12 var(--proj-hue));
		color: oklch(0.88 0.12 var(--proj-hue));
	}

	.tab:hover {
		background-color: oklch(0.28 0.07 var(--proj-hue));
		border-color: oklch(0.75 0.18 var(--proj-hue));
		transform: translateY(-1px);
	}

	.tab.scratchpad {
		background-color: var(--bg-sunken);
		color: var(--ink-muted);
		border: 1.5px dashed var(--line-strong, rgba(255, 255, 255, 0.4));
	}

	.tab.scratchpad:hover {
		background-color: var(--bg-hover);
		border-color: var(--ink-faint);
		color: var(--ink);
	}

	.tab.scratchpad.active {
		background-color: var(--bg-hover);
		color: #ffffff;
		border: 1.5px dashed #a0a0a0;
		box-shadow: 0 0 8px rgba(255, 255, 255, 0.15);
	}


	.ghost-icon {
		width: 14px;
		height: 14px;
		transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.topbar:hover .ghost-icon {
		width: 18px;
		height: 18px;
	}

	.tab-add {
		background-color: transparent;
		color: var(--ink-faint);
	}
	.tab-add:hover {
		color: var(--ink);
		background-color: var(--bg-hover);
	}

	.tab.active {
		background-color: oklch(var(--proj-l-active) var(--proj-c-active) var(--proj-hue));
		border: 1.5px solid oklch(var(--proj-l-active) var(--proj-c-active) var(--proj-hue));
		color: #0b0c10;
		font-weight: 700;
		box-shadow: 0 0 8px oklch(var(--proj-l-active) 0.12 var(--proj-hue) / 0.35);
	}

	.tab.working {
		animation: workingPulse 1.6s ease-in-out infinite alternate;
	}

	.tab.working::after {
		content: '';
		position: absolute;
		inset: -2px;
		border-radius: var(--radius-md);
		border: 2px solid oklch(0.75 0.22 var(--proj-hue));
		animation: workingPulseBorder 1.2s ease-in-out infinite alternate;
	}

	@keyframes workingPulse {
		0% { box-shadow: 0 0 4px oklch(0.7 0.18 var(--proj-hue) / 0.4); }
		100% { box-shadow: 0 0 14px oklch(0.75 0.22 var(--proj-hue) / 0.85); }
	}

	@keyframes workingPulseBorder {
		0% { opacity: 0.3; transform: scale(0.96); }
		100% { opacity: 1; transform: scale(1.04); }
	}

	.tab.attention {
		border-color: #f59e0b !important;
		animation: attentionFlash 0.8s ease-in-out infinite alternate;
	}

	@keyframes attentionFlash {
		0% { box-shadow: 0 0 2px #f59e0b; background-color: oklch(0.35 0.12 50); }
		100% { box-shadow: 0 0 12px #f59e0b; background-color: oklch(0.55 0.22 50); }
	}

	.tab.finished {
		border-color: #10b981 !important;
		animation: finishedGlow 1.8s ease-in-out infinite alternate;
	}

	@keyframes finishedGlow {
		0% { box-shadow: 0 0 3px #10b981; }
		100% { box-shadow: 0 0 10px #10b981; }
	}

	.status-badge {
		position: absolute;
		top: -4px;
		right: -4px;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 8px;
		font-weight: 800;
		line-height: 1;
		z-index: 3;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
	}

	.status-badge.attention {
		background-color: #f59e0b;
		color: #000000;
	}

	.status-badge.finished {
		background-color: #10b981;
		color: #ffffff;
	}

	/* Tab Popover Card */
	.tab-popover {
		position: absolute;
		top: calc(100% + 6px);
		left: 0;
		width: 240px;
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-overlay);
		padding: var(--space-3);
		z-index: var(--z-dialog);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		animation: popoverFadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
		transform-origin: top left;
	}

	@keyframes popoverFadeIn {
		from {
			opacity: 0;
			transform: translateY(-6px) scale(0.96);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	.popover-header {
		display: flex;
		align-items: center;
		gap: var(--space-2.5);
	}


	.popover-titles {
		display: flex;
		flex-direction: column;
		min-width: 0;
		width: 100%;
	}

	.popover-name {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.popover-path-container {
		width: 100%;
		overflow: hidden;
		position: relative;
	}

	.popover-path {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		white-space: nowrap;
		display: inline-block;
		transition: transform 0.3s ease;
	}

	.popover-path-container:hover .popover-path.marquee {
		animation: pathMarquee 7s ease-in-out infinite alternate;
	}

	@keyframes pathMarquee {
		0% { transform: translateX(0); }
		15% { transform: translateX(0); }
		85% { transform: translateX(min(0px, calc(230px - 100%))); }
		100% { transform: translateX(min(0px, calc(230px - 100%))); }
	}
	.popover-actions {
		display: flex;
		flex-direction: column;
		gap: 2px;
		border-top: 1px solid var(--line);
		padding-top: var(--space-2);
	}
	.popover-divider {
		height: 1px;
		background: var(--line);
		margin: 4px 0;
	}

	.popover-section-label {
		font-size: 11px;
		font-weight: 600;
		color: var(--ink-faint);
		padding: 2px 8px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.color-picker-grid {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 8px;
		flex-wrap: wrap;
	}

	.color-swatch {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		border: 2px solid transparent;
		background-color: oklch(0.68 0.16 var(--swatch-hue));
		cursor: pointer;
		padding: 0;
		transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
	}

	.color-swatch:hover {
		transform: scale(1.25);
	}

	.color-swatch.selected {
		border-color: #ffffff;
		transform: scale(1.2);
		box-shadow: 0 0 6px oklch(0.68 0.16 var(--swatch-hue));
	}
	.color-swatch.custom-rainbow {
		background: conic-gradient(from 0deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000);
	}

	.hidden-color-input {
		position: absolute;
		opacity: 0;
		width: 0;
		height: 0;
		pointer-events: none;
	}

	.popover-btn {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		background: transparent;
		border: none;
		color: var(--ink-muted);
		font-size: var(--text-xs);
		padding: 6px 8px;
		border-radius: var(--radius-md);
		cursor: pointer;
		text-align: left;
		transition: background 0.15s ease, color 0.15s ease;
	}

	.popover-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.popover-btn.danger:hover {
		background: rgba(239, 68, 68, 0.15);
		color: var(--brand);
	}

	.btn-icon {
		font-size: 12px;
		width: 14px;
		text-align: center;
	}

	.title {
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--ink-muted);
		flex: 1;
		text-align: center;
		cursor: default;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		padding: 0 var(--space-3);
	}

	.controls {
		display: flex;
		align-items: center;
		height: 100%;
		z-index: 2;
	}

	.usage-chip {
		background: transparent;
		border: 1px solid var(--line);
		color: var(--ink-muted);
		padding: 3px 10px;
		font-size: var(--text-xs);
		border-radius: var(--radius-full);
		cursor: pointer;
		margin-right: var(--space-3);
		transition: all 0.15s ease;
	}

	.usage-chip:hover {
		color: var(--ink);
		border-color: var(--line-strong);
		background: var(--bg-hover);
	}

	/* Native Window Controls */
	.window-controls {
		display: flex;
		align-items: stretch;
		height: 100%;
	}

	.win-btn {
		background: transparent;
		border: none;
		color: var(--ink-muted);
		width: 44px;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: background-color 0.15s ease, color 0.15s ease;
	}

	.win-btn:hover {
		background-color: var(--bg-hover);
		color: var(--ink);
	}

	.win-btn.close:hover {
		background-color: #e81123;
		color: #ffffff;
	}
</style>
