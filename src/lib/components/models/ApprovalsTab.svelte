<script lang="ts">
	// Pannello «Approvazioni» nel modale impostazioni.
	//
	// Edita `%LOCALAPPDATA%/omp-studio/approval.json` (o `~/.omp-studio/approval.json`).
	// Mai dentro `~/.omp`: il contratto di PRODUCT.md §8 regge.
	//
	// Con l'overlay `--config` che mette `approvalMode: yolo` per evitare il
	// doppio prompt, gli override di sicurezza argomento-dipendenti di omp
	// non scattano: per questo la policy di default e' `ask-writes`. Va
	// dichiarato nella UI, non nascosto.
	import { invoke } from '@tauri-apps/api/core';
	import { onMount } from 'svelte';

	type Mode = 'ask-writes' | 'ask-all' | 'yolo';

	interface PolicyDto {
		mode: string;
		allow: string[];
		deny: string[];
	}

	let mode = $state<Mode>('ask-writes');
	let allowInput = $state('');
	let denyInput = $state('');
	let allowList = $state<string[]>([]);
	let denyList = $state<string[]>([]);
	let loading = $state(true);
	let saving = $state(false);
	let savedToast = $state(false);
	let errorMessage = $state<string | null>(null);

	async function loadPolicy() {
		loading = true;
		errorMessage = null;
		try {
			const policy: PolicyDto = await invoke('approval_policy_get');
			mode = policy.mode === 'yolo' || policy.mode === 'ask-all' ? policy.mode : 'ask-writes';
			allowList = Array.isArray(policy.allow) ? policy.allow : [];
			denyList = Array.isArray(policy.deny) ? policy.deny : [];
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			loading = false;
		}
	}

	async function savePolicy() {
		saving = true;
		errorMessage = null;
		try {
			await invoke('approval_policy_save', {
				policy: {
					mode,
					allow: $state.snapshot(allowList),
					deny: $state.snapshot(denyList)
				}
			});
			savedToast = true;
			setTimeout(() => (savedToast = false), 2500);
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			saving = false;
		}
	}

	function addAllow() {
		const name = allowInput.trim().toLowerCase();
		if (name && !allowList.includes(name)) {
			allowList = [...allowList, name];
			denyList = denyList.filter((item) => item !== name);
			allowInput = '';
			void savePolicy();
		}
	}

	function removeAllow(name: string) {
		allowList = allowList.filter((item) => item !== name);
		void savePolicy();
	}

	function addDeny() {
		const name = denyInput.trim().toLowerCase();
		if (name && !denyList.includes(name)) {
			denyList = [...denyList, name];
			allowList = allowList.filter((item) => item !== name);
			denyInput = '';
			void savePolicy();
		}
	}

	function removeDeny(name: string) {
		denyList = denyList.filter((item) => item !== name);
		void savePolicy();
	}

	function handleModeChange(newMode: Mode) {
		mode = newMode;
		void savePolicy();
	}

	onMount(() => {
		void loadPolicy();
	});
</script>

<div class="approvals-tab">
	{#if loading}
		<div class="loading">Caricamento policy di approvazione...</div>
	{:else}
		<div class="section">
			<h4>Modalità di approvazione (solo scheda GUI)</h4>
			<p class="desc">
				Nella modalità GUI Studio gestisce le approvazioni con card strutturate. Il gate è per
				<strong>nome di tool</strong>, non per argomenti: <code>ask-writes</code> è il default consigliato.
			</p>

			<div class="mode-options">
				<label class="mode-card" class:active={mode === 'ask-writes'}>
					<input
						type="radio"
						name="mode"
						value="ask-writes"
						checked={mode === 'ask-writes'}
						onchange={() => handleModeChange('ask-writes')}
					/>
					<div class="mode-body">
						<span class="mode-title">Chiedi per scritture (Consigliato)</span>
						<span class="mode-desc">
							Chiede conferma per i tool che modificano file, eseguono comandi shell o avviano processi:
							<code>write</code>, <code>edit</code>, <code>bash</code>, <code>eval</code>, <code>browser</code>, <code>task</code>.
							Letture, ricerche e todo passano senza interruzioni.
						</span>
					</div>
				</label>

				<label class="mode-card" class:active={mode === 'ask-all'}>
					<input
						type="radio"
						name="mode"
						value="ask-all"
						checked={mode === 'ask-all'}
						onchange={() => handleModeChange('ask-all')}
					/>
					<div class="mode-body">
						<span class="mode-title">Chiedi per tutto</span>
						<span class="mode-desc">
							Chiede conferma per ogni tool tranne lettura e memoria locale (<code>read</code>, <code>glob</code>, <code>grep</code>, <code>todo</code>).
						</span>
					</div>
				</label>

				<label class="mode-card" class:active={mode === 'yolo'}>
					<input
						type="radio"
						name="mode"
						value="yolo"
						checked={mode === 'yolo'}
						onchange={() => handleModeChange('yolo')}
					/>
					<div class="mode-body">
						<span class="mode-title">Automatico (YOLO)</span>
						<span class="mode-desc">
							Tutti i tool vengono eseguiti senza conferma, tranne quelli esplicitamente presenti nella lista dei negati sotto.
						</span>
					</div>
				</label>
			</div>
		</div>

		<div class="lists-grid">
			<div class="list-section">
				<h5>Tool sempre consentiti (Allowlist)</h5>
				<p class="list-hint">Non chiedono mai conferma, anche in modalità restrittiva.</p>
				<div class="input-row">
					<input
						type="text"
						placeholder="es. bash, write..."
						bind:value={allowInput}
						onkeydown={(e) => e.key === 'Enter' && addAllow()}
					/>
					<button type="button" class="btn-add" onclick={addAllow}>Aggiungi</button>
				</div>
				<div class="chips">
					{#each allowList as item (item)}
						<span class="chip allow">
							<code>{item}</code>
							<button type="button" class="chip-rm" onclick={() => removeAllow(item)}>×</button>
						</span>
					{:else}
						<span class="empty">Nessun tool nella allowlist</span>
					{/each}
				</div>
			</div>

			<div class="list-section">
				<h5>Tool sempre negati (Denylist)</h5>
				<p class="list-hint">Vengono bloccati immediatamente prima di essere eseguiti.</p>
				<div class="input-row">
					<input
						type="text"
						placeholder="es. eval, browser..."
						bind:value={denyInput}
						onkeydown={(e) => e.key === 'Enter' && addDeny()}
					/>
					<button type="button" class="btn-add" onclick={addDeny}>Aggiungi</button>
				</div>
				<div class="chips">
					{#each denyList as item (item)}
						<span class="chip deny">
							<code>{item}</code>
							<button type="button" class="chip-rm" onclick={() => removeDeny(item)}>×</button>
						</span>
					{:else}
						<span class="empty">Nessun tool nella denylist</span>
					{/each}
				</div>
			</div>
		</div>

		<div class="footer-note">
			<span>Salvato automaticamente in <code>%LOCALAPPDATA%/omp-studio/approval.json</code>. Nessuna scrittura in <code>~/.omp</code>.</span>
			{#if savedToast}
				<span class="saved-badge">✓ Salvato</span>
			{/if}
			{#if errorMessage}
				<span class="error-badge">{errorMessage}</span>
			{/if}
		</div>
	{/if}
</div>

<style>
	.approvals-tab {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-3) 0;
	}

	.loading {
		padding: var(--space-4);
		color: var(--ink-faint);
		font-size: var(--text-sm);
	}

	.section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	h4 {
		margin: 0;
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--ink);
	}

	h5 {
		margin: 0;
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--ink);
	}

	.desc,
	.list-hint {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	code {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--ink);
	}

	.mode-options {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-top: var(--space-1);
	}

	.mode-card {
		display: grid;
		grid-template-columns: 20px 1fr;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-sunken);
		cursor: pointer;
		transition: border-color 0.15s ease;
	}

	.mode-card:hover {
		border-color: var(--line-strong);
	}

	.mode-card.active {
		border-color: var(--brand);
	}

	.mode-card input {
		margin-top: 3px;
		accent-color: var(--brand);
	}

	.mode-body {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.mode-title {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--ink);
	}

	.mode-desc {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		line-height: 1.35;
	}

	.lists-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-4);
	}

	.list-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-sunken);
	}

	.input-row {
		display: flex;
		gap: var(--space-1);
	}

	.input-row input {
		flex: 1;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 4px 8px;
		font-size: var(--text-xs);
		font-family: var(--font-mono);
		color: var(--ink);
	}

	.input-row input:focus {
		border-color: var(--brand);
		outline: none;
	}

	.btn-add {
		background: var(--bg-hover);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 4px 10px;
		font-size: var(--text-xs);
		color: var(--ink);
		cursor: pointer;
	}

	.btn-add:hover {
		background: var(--bg-active);
		border-color: var(--line-strong);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		min-height: 28px;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		font-size: 11px;
		background: var(--bg-base);
	}

	.chip.deny {
		border-color: var(--brand-dim);
	}

	.chip-rm {
		background: transparent;
		border: none;
		padding: 0;
		color: var(--ink-faint);
		cursor: pointer;
		font-size: 13px;
		line-height: 1;
	}

	.chip-rm:hover {
		color: var(--brand-ink);
	}

	.empty {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		font-style: italic;
	}

	.footer-note {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 11px;
		color: var(--ink-faint);
		padding-top: var(--space-2);
		border-top: 1px solid var(--line);
	}

	.saved-badge {
		color: var(--brand);
		font-weight: 500;
	}

	.error-badge {
		color: var(--brand-ink);
	}
</style>
