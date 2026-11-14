<!--
  AppearanceStep.svelte — passo Aspetto (SET-013).

  Una sola scelta per Studio e per omp. Le tessere sono un'anteprima costruita
  dai colori veri del tema (`swatchesFor`), non un disegno fisso: se `omp`
  aggiunge un tema, la griglia lo mostra senza toccare questo file.
  Il clic applica subito il tema a Studio: la finestra stessa cambia colore,
  che è il modo migliore di dire «è questo».
-->
<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { THEMES, THEME_NAMES, anchorsFor, swatchesFor } from '#lib/theme.ts';
	import { setupFlow } from '#lib/stores/setupFlow.svelte.ts';

	// La griglia non elenca cento temi: mostra i più distinti (un scuro di
	// partenza, un chiaro, e alcune famiglie riconoscibili) e lascia il resto
	// alle Impostazioni, dove la scelta si fa con più calma.
	const FEATURED = [
		'titanium',
		'alabaster',
		'dark-github',
		'dark-catppuccin',
		'dark-gruvbox',
		'dark-dracula',
		'dark-arctic',
		'dark-forest'
	];

	const themes = $derived(FEATURED.filter((name) => THEMES[name]));

	const current = $derived(setupFlow.themeName);

	function isLight(name: string): boolean {
		return anchorsFor(THEMES[name]).isLight;
	}

	function label(name: string): string {
		return name;
	}

	// Il conteggio è quello che NON si vede qui: dire «altri 108» quando la
	// griglia ne mostra otto sarebbe falso.
	const otherThemes = $derived(Math.max(0, THEME_NAMES.length - themes.length));
</script>

<div class="appearance">
	<div class="grid" role="radiogroup" aria-label={m.setup2_appearance_aria()}>
		{#each themes as name (name)}
			{@const swatch = swatchesFor(THEMES[name])}
			{@const on = name === current}
			<button
				type="button"
				role="radio"
				aria-checked={on}
				class="tile"
				class:on
				onclick={() => void setupFlow.chooseTheme(name)}
			>
				<!-- Miniatura: barra laterale sul pozzo, righe di testo, un accento. -->
				<span class="preview" style:background={swatch.bg}>
					<span class="preview-side" style:background="color-mix(in oklab, {swatch.bg} 82%, {swatch.text})">
						<span class="line" style:background={swatch.text}></span>
						<span class="line short" style:background={swatch.text}></span>
						<span class="line" style:background={swatch.text}></span>
					</span>
					<span class="preview-body">
						<span class="bubble" style:background="color-mix(in oklab, {swatch.bg} 88%, {swatch.text})"></span>
						<span class="line wide" style:background={swatch.text}></span>
						<span class="line" style:background={swatch.text}></span>
						<span class="accent" style:background={swatch.accent}></span>
					</span>
				</span>
				<span class="caption">
					<span class="name">{label(name)}</span>
					<span class="su-meta kind">{isLight(name) ? m.setup2_appearance_light() : m.setup2_appearance_dark()}</span>
				</span>
			</button>
		{/each}
	</div>

	<p class="su-meta hint">{m.setup2_appearance_hint({ count: otherThemes })}</p>
</div>

<style>
	.appearance {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 10px;
	}

	.tile {
		padding: 6px;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: transparent;
		color: inherit;
		text-align: left;
		cursor: pointer;
		transition:
			border-color 120ms var(--ease-out),
			box-shadow 120ms var(--ease-out);
	}

	.tile:hover {
		border-color: var(--line-strong);
	}

	.tile.on {
		border-color: var(--brand);
		box-shadow: inset 0 0 0 1px var(--brand);
	}

	.preview {
		display: flex;
		height: 78px;
		overflow: hidden;
		border-radius: var(--radius-sm);
	}

	.preview-side {
		display: flex;
		width: 24%;
		flex-direction: column;
		gap: 6px;
		padding: 8px;
	}

	.preview-body {
		display: flex;
		position: relative;
		flex: 1;
		flex-direction: column;
		gap: 6px;
		padding: 8px;
	}

	.line {
		display: block;
		width: 60%;
		height: 3px;
		border-radius: var(--radius-full);
		opacity: 0.26;
	}

	.line.short {
		width: 44%;
	}

	.line.wide {
		width: 88%;
		opacity: 0.4;
	}

	.bubble {
		align-self: flex-end;
		width: 46%;
		height: 14px;
		border-radius: 5px;
	}

	.accent {
		position: absolute;
		right: 8px;
		bottom: 8px;
		width: 22px;
		height: 9px;
		border-radius: 3px;
	}

	.caption {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 6px 4px 2px;
	}

	.name {
		font-size: var(--text-label);
		font-weight: 500;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.kind {
		flex: none;
		color: var(--ink-faint);
	}

	.hint {
		margin: 0;
		color: var(--ink-faint);
	}
</style>
