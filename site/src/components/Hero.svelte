<script lang="ts">
	import { createAsciiReveal } from 'ascii-reveal/core';
	import { mountRuin } from '../lib/ruin';

	let { version, windowsUrl, macUrl }: { version: string; windowsUrl: string; macUrl: string } = $props();

	let gate: HTMLElement;
	let canvas: HTMLCanvasElement;
	let heroCopy: HTMLElement;
	let scrim: HTMLElement;
	let caption: HTMLElement;
	let grain: HTMLElement;

	// Nell'HTML statico il pulsante e' per Windows; nel browser segue il sistema del visitatore.
	// Linux ha due formati: il pulsante porta alla sezione Download.
	let os = $state<'windows' | 'macos' | 'linux'>('windows');
	const cta = $derived(
		os === 'macos'
			? { label: 'Download for macOS', href: macUrl }
			: os === 'linux'
				? { label: 'Download for Linux', href: '#download' }
				: { label: 'Download for Windows', href: windowsUrl }
	);

	$effect(() => {
		const ua = navigator.userAgent;
		if (/Mac/.test(navigator.platform) || /Mac OS X/.test(ua)) os = 'macos';
		else if (/Linux/.test(navigator.platform) && !/Android/.test(ua)) os = 'linux';
	});

	$effect(() => {
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
		// Grana da pellicola generata una volta: nessun file in piu' da scaricare.
		const [size, c] = [160, document.createElement('canvas')];
		c.width = c.height = size;
		const x = c.getContext('2d')!;
		const d = x.createImageData(size, size);
		for (let i = 0; i < d.data.length; i += 4) {
			const v = Math.random() * 255;
			d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
			d.data[i + 3] = 255;
		}
		x.putImageData(d, 0, 0);
		grain.style.backgroundImage = `url(${c.toDataURL()})`;

		let stop: (() => void) | undefined;
		let disposed = false;
		const reveal = createAsciiReveal(heroCopy, { preset: 'decode', duration: 'cinematic', origin: 'top-left' });
		document.fonts.ready.then(async () => {
			if (disposed) return;
			reveal.reveal();
			const dispose = await mountRuin({ canvas, gate, heroCopy, scrim, caption }, reduced);
			if (disposed) dispose();
			else stop = dispose;
		});
		return () => {
			disposed = true;
			stop?.();
			reveal.destroy();
		};
	});
</script>

<section id="gate" aria-label="Introduction" bind:this={gate}>
	<div class="stage">
		<canvas aria-hidden="true" bind:this={canvas}></canvas>
		<div class="vignette"></div>
		<div class="scrim" bind:this={scrim}></div>
		<div class="grain" bind:this={grain}></div>
		<div class="hero-copy" bind:this={heroCopy}>
			<h1>Every project, its own agent, one window.</h1>
			<p class="lede">
				A desktop workspace for omp. Studio keeps all your projects in one window: switch with a click, run several agents at once,
				and follow each session in the terminal or in a GUI.
			</p>
			<p class="platforms">Windows · macOS · Linux · free and open source</p>
			<div class="ctas">
				<a class="btn" href={cta.href} data-ascii="fade">{cta.label}<small>v{version}</small></a>
				<a class="link" href="#download">Other platforms</a>
			</div>
		</div>
		<div class="caption" bind:this={caption}>
			<h2>Terminal or GUI, the same session.</h2>
			<p>Studio does not replace omp: it runs it. The GUI draws what omp declares, and the TUI is one tab away on the same conversation.</p>
		</div>
	</div>
	<figure class="static-shot wrap">
		<img
			src="/img/studio.webp"
			width="1676"
			height="888"
			alt="OMP Studio: project bar on top, lanes below it, file tree on the left, editor in the middle, the agent's conversation in the GUI tab on the right"
		/>
		<figcaption>
			<h2>Terminal or GUI, the same session.</h2>
			<p>Studio does not replace omp: it runs it. The GUI draws what omp declares, and the TUI is one tab away on the same conversation.</p>
		</figcaption>
	</figure>
</section>

<style>
	#gate {
		position: relative;
		height: 320vh;
	}
	.stage {
		position: sticky;
		top: 0;
		height: 100vh;
		height: 100svh;
		min-height: 560px;
		overflow: hidden;
		/* Prima che la rovina sia pronta resta la foto scurita, cosi' il primo fotogramma non e' nero. */
		background: var(--ground) url('/img/ruin.webp') center / cover no-repeat;
	}
	canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		display: block;
	}
	.vignette {
		position: absolute;
		inset: 0;
		pointer-events: none;
		background: radial-gradient(120% 90% at 50% 45%, transparent 55%, rgb(14 14 12 / 0.75) 100%);
	}
	.scrim {
		position: absolute;
		inset: auto 0 0 0;
		height: 64%;
		pointer-events: none;
		background: linear-gradient(to top, rgb(14 14 12 / 0.94), rgb(14 14 12 / 0.55) 45%, transparent);
	}
	.grain {
		position: absolute;
		inset: -50%;
		pointer-events: none;
		opacity: 0.07;
		mix-blend-mode: overlay;
		animation: grain 0.5s steps(3) infinite;
	}
	@keyframes grain {
		0% {
			translate: 0 0;
		}
		33% {
			translate: -3% 2%;
		}
		66% {
			translate: 2% -3%;
		}
		100% {
			translate: 0 0;
		}
	}
	.hero-copy {
		position: absolute;
		left: var(--gutter);
		right: var(--gutter);
		bottom: clamp(28px, 7vh, 72px);
		max-width: 900px;
	}
	h1 {
		font: 400 clamp(42px, 5.8vw, 86px) / 1 var(--serif);
		letter-spacing: -0.03em;
		margin-left: -0.04em;
		max-width: 15ch;
		text-wrap: balance;
	}
	.lede {
		font-family: var(--serif);
		font-size: clamp(19px, 1.7vw, 24px);
		line-height: 1.35;
		max-width: 42ch;
		margin-top: 22px;
	}
	.platforms {
		font: 400 13px/1.4 var(--mono);
		color: var(--slate);
		margin-top: 10px;
	}
	.ctas {
		display: flex;
		align-items: center;
		gap: 22px;
		flex-wrap: wrap;
		margin-top: 28px;
	}
	.caption {
		position: absolute;
		left: 0;
		right: 0;
		bottom: clamp(20px, 5vh, 48px);
		text-align: center;
		padding: 0 24px;
		opacity: 0;
	}
	.caption h2,
	figcaption h2 {
		font: 400 clamp(28px, 3.2vw, 44px) / 1.1 var(--serif);
		letter-spacing: -0.02em;
	}
	.caption p,
	figcaption p {
		color: var(--slate);
		max-width: 60ch;
		margin: 10px auto 0;
	}
	.static-shot {
		display: none;
	}
	@media (prefers-reduced-motion: reduce) {
		.grain {
			animation: none;
		}
		#gate {
			height: auto;
		}
		.stage {
			position: relative;
		}
		.caption {
			display: none;
		}
		.static-shot {
			display: block;
			padding-top: 72px;
		}
		.static-shot img {
			display: block;
			width: 100%;
			border: 1px solid var(--line);
		}
		figcaption {
			margin-top: 20px;
		}
		figcaption p {
			margin-left: 0;
		}
	}
</style>
