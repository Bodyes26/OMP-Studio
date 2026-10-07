<script module lang="ts">
	// Una sola intro per avvio della finestra (docs/PRODUCT.md, Personalita'):
	// le chat vuote successive mostrano il banner gia' composto.
	let introPlayed = false;
</script>

<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { ompVersionStore } from '$lib/stores/ompVersion.svelte';
	import { ompChangelogStore } from '$lib/stores/ompChangelog.svelte';
	import { motionReduced } from '../motionState.svelte';

	let { visible = true, loading = false }: { visible?: boolean; loading?: boolean } = $props();

	const uid = $props.id();
	const gradId = `${uid}-grad`;
	const strokeId = `${uid}-stroke`;
	const bodyClip = `${uid}-body`;
	const notchClip = `${uid}-notch`;

	// Griglia di PI_LOGO in omp (12 colonne x 5 righe di celle alte il doppio):
	// barra, gamba sinistra con la tacca `▒▒` in fondo, gamba destra piu' lunga.
	const OUTLINE = 'M0 0H12V2H9V10H7V2H5V8H3V2H0Z';
	const BODY = 'M0 0H12V2H9V10H7V2H5V6H3V2H0Z';

	// 'pending' finche' la chat non e' davanti all'utente: una scheda in background
	// non deve consumare l'unica intro della sessione di lavoro. 'loading' e' il
	// lockup in fil di ferro mentre omp si avvia o la sessione si ricarica.
	type Phase = 'pending' | 'loading' | 'intro' | 'rest';
	// La fase iniziale non legge `loading`: l'effetto la allinea prima del primo disegno.
	let phase = $state<Phase>(introPlayed ? 'rest' : 'pending');
	// Dopo il caricamento il contorno e' gia' disegnato: l'intro riparte da li'.
	let fromLoading = $state(false);

	$effect(() => {
		if (loading) {
			phase = 'loading';
			fromLoading = true;
			return;
		}
		if (phase === 'loading') phase = introPlayed ? 'rest' : 'pending';
		if (phase !== 'pending' || !visible) return;
		if (introPlayed || motionReduced()) {
			phase = 'rest';
			return;
		}
		introPlayed = true;
		phase = 'intro';
	});

	$effect(() => {
		ompVersionStore.ensure();
		void ompChangelogStore.checkStatus();
	});
</script>

<div
	class="omp-welcome"
	class:is-pending={phase === 'pending'}
	class:is-loading={phase === 'loading'}
	class:is-intro={phase === 'intro'}
	class:from-loading={fromLoading}
	class:rv-blur={phase === 'rest'}
	style:--dur={phase === 'rest' ? '400ms' : undefined}
	aria-busy={phase === 'loading'}
>
	<div class="lockup" class:shimmer={phase === 'loading' && !motionReduced()}>
		<svg class="mark" viewBox="-0.2 -0.2 12.4 10.4" aria-hidden="true">
			<defs>
				<!-- Stessa palette e stessa diagonale del gradiente della TUI di omp. -->
				<linearGradient
					id={gradId}
					gradientUnits="userSpaceOnUse"
					x1="0"
					y1="0"
					x2="12"
					y2="10"
					spreadMethod="repeat"
				>
					<stop offset="0" stop-color="#f84fcc" />
					<stop offset="0.333" stop-color="#9362f4" />
					<stop offset="0.667" stop-color="#00dbe4" />
					<stop offset="1" stop-color="#f84fcc" />
				</linearGradient>
				<linearGradient id={strokeId} x1="0" y1="0" x2="1" y2="1">
					<stop offset="0" stop-color="#f84fcc" />
					<stop offset="0.5" stop-color="#9362f4" />
					<stop offset="1" stop-color="#00dbe4" />
				</linearGradient>
				<clipPath id={bodyClip}><path d={BODY} /></clipPath>
				<clipPath id={notchClip}><rect x="3" y="6" width="2" height="2" /></clipPath>
			</defs>

			<g clip-path="url(#{bodyClip})">
				<rect class="sweep" x="-1" y="0" width="55" height="10" fill="url(#{gradId})" />
				<rect class="ink" x="0" y="0" width="12" height="10" />
			</g>
			<g class="notch" clip-path="url(#{notchClip})">
				<rect class="sweep" x="-1" y="0" width="55" height="10" fill="url(#{gradId})" />
				<rect class="ink" x="0" y="0" width="12" height="10" />
			</g>
			<path class="outline" d={OUTLINE} pathLength="1" stroke="url(#{strokeId})" />
		</svg>

		<div class="type">
			<span class="word">omp</span>
			<span class="version">{ompVersionStore.current ? `v${ompVersionStore.current}` : ''}</span>
		</div>
	</div>

	<!-- Le due righe occupano la stessa cella: l'altezza resta quella della piu'
	     lunga, cosi' il lockup non salta quando il caricamento finisce. -->
	<div class="hint-slot" aria-live="polite">
		<p class="hint" class:is-off={phase !== 'loading'}>{m.ui_transcript_caricamento_sessione_in_corso_d8f1()}</p>
		<p class="hint" class:is-off={phase === 'loading'}>{m.chat_v2_empty_state()}</p>
	</div>

	{#if phase !== 'loading' && ompChangelogStore.hasUnseenUpdate}
		<div class="update-notice">
			<button
				type="button"
				class="update-notice-btn"
				onclick={() => void ompChangelogStore.openModal()}
				title={m.page_omp_update_notice_tooltip()}
			>
				<span class="sparkle" aria-hidden="true">✦</span>
				<span class="notice-text">
					{#if ompChangelogStore.releaseCount <= 1}
						{#if ompChangelogStore.changeCount === 1}
							{m.page_omp_update_notice_single_one({
								version: ompChangelogStore.currentVersion,
								command: '/changelog'
							})}
						{:else}
							{m.page_omp_update_notice_single({
								version: ompChangelogStore.currentVersion,
								count: ompChangelogStore.changeCount,
								command: '/changelog'
							})}
						{/if}
					{:else}
						{m.page_omp_update_notice_multi({
							version: ompChangelogStore.currentVersion,
							count: ompChangelogStore.changeCount,
							releases: ompChangelogStore.releaseCount,
							command: '/changelog'
						})}
					{/if}
				</span>
			</button>
		</div>
	{/if}
</div>

<style>
	.omp-welcome {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-6);
		max-width: 520px;
		margin: 0 auto;
		width: 100%;
		padding: var(--space-6) var(--space-4);
		text-align: center;
	}

	.is-pending {
		opacity: 0;
	}

	.lockup {
		display: flex;
		align-items: flex-start;
		gap: 28px;
	}

	.mark {
		display: block;
		height: 64px;
		width: auto;
		aspect-ratio: 12.4 / 10.4;
		overflow: visible;
	}

	/* Stato naturale = fotogramma finale (From-Only Rule): pi pieno nel colore
	   d'inchiostro del tema, gradiente e contorno spenti. Con le animazioni
	   azzerate resta questo. */
	.ink {
		fill: var(--ink);
	}
	.sweep {
		opacity: 0;
	}
	.notch {
		opacity: 0.45;
	}
	.outline {
		fill: none;
		stroke-width: 0.18;
		stroke-linejoin: miter;
		stroke-dasharray: 1;
		opacity: 0;
	}

	.type {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		text-align: left;
	}

	.word {
		font-family: var(--font-ui);
		font-size: 60px;
		font-weight: 560;
		line-height: 0.8;
		letter-spacing: -0.035em;
		color: var(--ink);
	}

	.version {
		min-height: 1lh;
		margin-top: 6px;
		padding-left: 3px;
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		letter-spacing: 0.08em;
		color: var(--ink-faint);
	}

	.hint {
		font-size: var(--text-chat);
		line-height: 24px;
		color: var(--ink-muted);
		margin: 0;
	}
	.hint-slot {
		display: grid;
	}
	.hint-slot > .hint {
		grid-area: 1 / 1;
	}
	.hint.is-off {
		visibility: hidden;
	}

	/* Intro, tempi ricavati fotogramma per fotogramma dal banner di Tern:
	   contorno disegnato (0-270ms), scritta (270-570ms), riempimento a
	   gradiente che scorre in diagonale (400-2100ms), approdo sull'inchiostro
	   del tema (1650-2250ms), riga guida (1070-1470ms). */
	.is-intro .outline {
		animation: welcome-outline 670ms linear backwards;
	}
	.is-intro .sweep {
		animation:
			welcome-sweep-fade 1700ms 400ms linear backwards,
			welcome-sweep-move 1700ms 400ms cubic-bezier(0.33, 1, 0.68, 1) backwards;
	}
	.is-intro .ink {
		animation: welcome-fade 600ms 1650ms var(--ease-out) backwards;
	}
	.is-intro .word {
		animation: welcome-text 300ms 270ms var(--ease-out) backwards;
	}
	.is-intro .version {
		animation: welcome-text 300ms 330ms var(--ease-out) backwards;
	}
	.is-intro .hint {
		animation: welcome-text 400ms 1070ms var(--ease-out) backwards;
	}
	.is-intro .update-notice {
		animation: welcome-text 400ms 1200ms var(--ease-out) backwards;
	}

	.update-notice {
		display: flex;
		align-items: center;
		justify-content: center;
		margin-top: calc(-1 * var(--space-2, 8px));
	}

	.update-notice-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px 12px;
		border-radius: var(--radius-full, 9999px);
		border: 1px solid var(--line-subtle, rgba(255, 255, 255, 0.08));
		background: var(--bg-surface-raised, rgba(255, 255, 255, 0.03));
		color: var(--ink-muted);
		font-family: var(--font-ui, sans-serif);
		font-size: var(--text-sm, 13px);
		line-height: 20px;
		cursor: pointer;
		transition: all 140ms ease;
		text-align: center;
	}

	.update-notice-btn:hover {
		color: var(--ink);
		border-color: var(--accent, #f84fcc);
		background: var(--accent-subtle, rgba(248, 79, 204, 0.08));
	}

	.update-notice-btn:focus-visible {
		outline: 2px solid var(--accent, #f84fcc);
		outline-offset: 2px;
	}

	.sparkle {
		color: var(--accent, #f84fcc);
		font-size: 11px;
		flex-shrink: 0;
	}

	.notice-text {
		color: inherit;
	}

	/* Caricamento: lockup in fil di ferro, senza riempimento. Con il movimento
	   attivo una banda di luce lo attraversa in diagonale: la maschera porta
	   tutto al 40% tranne la banda, cosi' pi e scritta brillano come un solo
	   oggetto. Senza movimento resta il contorno fermo in --ink-muted. */
	.is-loading .lockup {
		--wire: var(--ink-muted);
	}
	.is-loading .lockup.shimmer {
		--wire: var(--ink);
		-webkit-mask-image: linear-gradient(110deg, rgb(0 0 0 / 0.4) 42%, #000 50%, rgb(0 0 0 / 0.4) 58%);
		mask-image: linear-gradient(110deg, rgb(0 0 0 / 0.4) 42%, #000 50%, rgb(0 0 0 / 0.4) 58%);
		-webkit-mask-size: 300% 100%;
		mask-size: 300% 100%;
		animation: welcome-shimmer 2400ms linear infinite;
	}
	.is-loading .ink {
		opacity: 0;
	}
	.is-loading .outline {
		opacity: 1;
		stroke: var(--wire);
	}
	.is-loading .word {
		color: transparent;
		-webkit-text-stroke: 1px var(--wire);
	}

	/* Intro dopo il caricamento: il contorno e' gia' tracciato, quindi la
	   sequenza salta i primi 270ms. Il contorno riprende il gradiente e si
	   spegne mentre il riempimento lo raggiunge; la scritta si riempie. */
	.is-intro.from-loading .outline {
		animation: welcome-outline-out 400ms linear backwards;
	}
	.is-intro.from-loading .sweep {
		animation-delay: 130ms;
	}
	.is-intro.from-loading .ink {
		animation-delay: 1380ms;
	}
	.is-intro.from-loading .word {
		-webkit-text-stroke: 1px transparent;
		animation: welcome-ink 400ms var(--ease-out) backwards;
	}
	.is-intro.from-loading .version {
		animation: none;
	}
	.is-intro.from-loading .hint {
		animation-delay: 800ms;
	}

	@keyframes welcome-outline {
		0% {
			opacity: 1;
			stroke-dashoffset: 1;
		}
		40% {
			opacity: 1;
			stroke-dashoffset: 0;
		}
		70% {
			opacity: 1;
		}
	}

	@keyframes welcome-sweep-fade {
		0% {
			opacity: 0;
		}
		12%,
		75% {
			opacity: 1;
		}
	}

	/* Due periodi del gradiente: il periodo lungo x vale |(12,10)|^2 / 12 = 20.33. */
	@keyframes welcome-sweep-move {
		from {
			transform: translateX(-40.67px);
		}
	}

	@keyframes welcome-fade {
		from {
			opacity: 0;
		}
	}

	@keyframes welcome-text {
		from {
			opacity: 0;
			filter: blur(3px);
		}
	}

	@keyframes welcome-outline-out {
		0%,
		50% {
			opacity: 1;
		}
	}

	@keyframes welcome-ink {
		from {
			color: transparent;
			-webkit-text-stroke-color: var(--ink-muted);
		}
	}

	/* Con la maschera larga il triplo, da 100% a 0% la banda entra da sinistra
	   ed esce a destra, con una pausa fuori campo a ogni giro. */
	@keyframes welcome-shimmer {
		from {
			-webkit-mask-position: 100% 0;
			mask-position: 100% 0;
		}
		70%,
		to {
			-webkit-mask-position: 0 0;
			mask-position: 0 0;
		}
	}
</style>
