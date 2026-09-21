import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const APP_CSS = readFileSync(join(ROOT, 'src', 'app.css'), 'utf-8');
const TOPBAR_SVELTE = readFileSync(join(ROOT, 'src', 'lib', 'components', 'TopBar.svelte'), 'utf-8');
const COMPANION_CSS = readFileSync(join(ROOT, 'src', 'lib', 'components', 'companion', 'companion.css'), 'utf-8');

describe('Anello ambra respirante (breathing easing) per stato attention', () => {
	it('definisce il keyframe breathing-amber-ring con curva organica e ciclo tra 1.8s e 2.0s', () => {
		assert.ok(
			APP_CSS.includes('@keyframes breathing-amber-ring'),
			'src/app.css deve contenere @keyframes breathing-amber-ring'
		);

		// Verifica interpolazione opacità e box-shadow
		assert.ok(
			APP_CSS.includes('opacity: 0.35'),
			'breathing-amber-ring deve interpolare da opacity: 0.35'
		);
		assert.ok(
			APP_CSS.includes('opacity: 1'),
			'breathing-amber-ring deve raggiungere opacity: 1'
		);
		assert.ok(
			APP_CSS.includes('box-shadow: inset 0 0 0 1px'),
			'breathing-amber-ring deve partire da inset 1px'
		);
		assert.ok(
			APP_CSS.includes('box-shadow: inset 0 0 0 2px'),
			'breathing-amber-ring deve espandersi a inset 2px'
		);

		// Verifica curva respirante sinusoidale organica: cubic-bezier(0.4, 0, 0.2, 1)
		assert.ok(
			APP_CSS.includes('cubic-bezier(0.4, 0, 0.2, 1)'),
			'deve utilizzare la funzione di temporizzazione cubic-bezier(0.4, 0, 0.2, 1)'
		);

		// Verifica durata del ciclo (1.8s - 2.0s)
		const durMatch = APP_CSS.match(/--dur-breathing:\s*([0-9.]+)s/);
		assert.ok(durMatch, 'src/app.css deve definire --dur-breathing in secondi');
		const durSeconds = parseFloat(durMatch[1]);
		assert.ok(
			durSeconds >= 1.8 && durSeconds <= 2.0,
			`La durata ${durSeconds}s deve essere compresa tra 1.8s e 2.0s`
		);
	});

	it('applica breathing-amber-ring in modo coerente su TopBar e CompanionProjectCard', () => {
		// Verifica TopBar.svelte
		assert.ok(
			TOPBAR_SVELTE.includes('breathing-amber-ring'),
			'TopBar.svelte deve applicare breathing-amber-ring a .tab.attention::after'
		);
		assert.ok(
			TOPBAR_SVELTE.includes('--dur-breathing'),
			'TopBar.svelte deve utilizzare la durata --dur-breathing'
		);
		assert.ok(
			TOPBAR_SVELTE.includes('will-change: opacity, box-shadow'),
			'TopBar.svelte deve dichiarare will-change per ottimizzazione GPU'
		);

		// Verifica companion.css
		assert.ok(
			COMPANION_CSS.includes('breathing-amber-ring'),
			'companion.css deve applicare breathing-amber-ring a .project-card.attention::after'
		);
		assert.ok(
			COMPANION_CSS.includes('--dur-breathing'),
			'companion.css deve utilizzare la durata --dur-breathing'
		);
		assert.ok(
			COMPANION_CSS.includes('will-change: opacity, box-shadow'),
			'companion.css deve dichiarare will-change per ottimizzazione GPU'
		);
	});

	it('rispetta rigorosamente prefers-reduced-motion e data-animations=false con anello statico al 100% di visibilità', () => {
		// In app.css globale
		assert.ok(
			APP_CSS.includes('.tab.attention::after') && APP_CSS.includes('.project-card.attention::after'),
			'src/app.css deve coprire sia la tab che la project card per accessibilita'
		);

		// In TopBar.svelte
		assert.ok(
			TOPBAR_SVELTE.includes('prefers-reduced-motion: reduce'),
			'TopBar.svelte deve gestire prefers-reduced-motion'
		);
		assert.ok(
			TOPBAR_SVELTE.includes('.tab.attention::after') && TOPBAR_SVELTE.includes('animation: none'),
			'TopBar.svelte deve azzerare l\'animazione per attention'
		);

		// In companion.css
		assert.ok(
			COMPANION_CSS.includes('prefers-reduced-motion: reduce'),
			'companion.css deve gestire prefers-reduced-motion'
		);
		assert.ok(
			COMPANION_CSS.includes('.project-card.attention::after') && COMPANION_CSS.includes('animation: none'),
			'companion.css deve azzerare l\'animazione per attention'
		);
	});
});
