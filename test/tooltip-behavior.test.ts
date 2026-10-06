import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

describe('Contratto e comportamento Tooltip (Tooltip.svelte)', () => {
	const tooltipSource = readFileSync(join(ROOT, 'src', 'lib', 'ui', 'Tooltip.svelte'), 'utf-8');

	it('supporta ritardo di apertura configurabile (openDelay, default 300ms) con timer e cancellazione', () => {
		assert.ok(
			tooltipSource.includes('openDelay = 300'),
			'Tooltip.svelte deve dichiarare openDelay con default a 300ms'
		);
		assert.ok(
			tooltipSource.includes('function cancelOpen()'),
			'Tooltip.svelte deve definire la funzione cancelOpen per annullare aperture pendenti'
		);
		assert.ok(
			tooltipSource.includes('cancelOpen()'),
			'Tooltip.svelte deve invocare cancelOpen su pointerleave o dismiss'
		);
	});

	it('chiude e annulla istantaneamente alla pressione (pointerdown/click) del trigger', () => {
		assert.ok(
			tooltipSource.includes('function dismiss()'),
			'Tooltip.svelte deve definire la funzione dismiss'
		);
		assert.ok(
			tooltipSource.includes('onpointerdown={dismiss}'),
			'Il trigger wrapper deve intercettare onpointerdown per chiudere immediatamente'
		);
		assert.ok(
			tooltipSource.includes('onclick={dismiss}'),
			'Il trigger wrapper deve intercettare onclick per chiudere immediatamente'
		);
	});

	it('consente apertura rapida (warm-up / quick switch) quando un tooltip era aperto da poco', () => {
		assert.ok(
			tooltipSource.includes('lastCloseTimestamp'),
			'Tooltip.svelte deve memorizzare il timestamp di ultima chiusura a livello di modulo'
		);
		assert.ok(
			tooltipSource.includes('anyTooltipOpen'),
			'Tooltip.svelte deve tracciare la presenza di tooltip attivi a livello di modulo'
		);
		assert.ok(
			tooltipSource.includes('isQuickSwitch'),
			'Tooltip.svelte deve calcolare isQuickSwitch per rendere reattivo lo scorrimento tra tooltip'
		);
	});

	it('evita apertura e permanenza da click controllando :focus-visible sulla navigazione da tastiera', () => {
		assert.ok(
			tooltipSource.includes(':focus-visible'),
			'Tooltip.svelte deve verificare :focus-visible per distinguere focus tastiera da click mouse'
		);
		assert.ok(
			tooltipSource.includes('handleFocusIn'),
			'Tooltip.svelte deve gestire handleFocusIn per prevenire aperture dopo il click'
		);
	});

	it('consente al bubble del tooltip di chiudersi se premuto direttamente', () => {
		assert.ok(
			tooltipSource.includes('class="tooltip-bubble rv-lift"') &&
				tooltipSource.includes('onpointerdown={dismiss}'),
			'La bolla del tooltip deve chiudersi immediatamente al click'
		);
	});
});

describe('Verifica rimozione tooltip ridondanti o fastidiosi', () => {
	it('il pulsante di chiusura del Dialog non mostra tooltip "chiudi"', () => {
		const dialogSource = readFileSync(join(ROOT, 'src', 'lib', 'ui', 'Dialog.svelte'), 'utf-8');
		assert.ok(
			!dialogSource.includes('<Tooltip'),
			'Dialog.svelte non deve avvolgere dialog-close-btn con Tooltip'
		);
		assert.ok(
			dialogSource.includes('class="dialog-close-btn"'),
			'Dialog.svelte deve mantenere il pulsante dialog-close-btn con IconClose'
		);
	});

	it('il badge "OMP sta lavorando" (automation-state) non mostra tooltip ridondante', () => {
		const agentPanelSource = readFileSync(join(ROOT, 'src', 'lib', 'components', 'AgentPanel.svelte'), 'utf-8');
		assert.ok(
			!agentPanelSource.includes('<Tooltip text={`${gate.detail}'),
			'AgentPanel.svelte non deve mostrare un tooltip sopra il pulsante automation-state'
		);
	});

	it('la linguetta delle schede editor (close-tab) non mostra tooltip "Chiudi scheda"', () => {
		const editorSource = readFileSync(join(ROOT, 'src', 'lib', 'editor', 'Editor.svelte'), 'utf-8');
		assert.ok(
			!editorSource.includes('<Tooltip text={m.editor_close_tab_tip()}'),
			'Editor.svelte non deve mostrare tooltip sulle crocette di chiusura delle schede'
		);
	});

	it('i pulsanti di chiusura di finestre, pannelli e modali non mostrano tooltip ridondanti', () => {
		const closeSources = [
			'src/lib/components/AlertBanner.svelte',
			'src/lib/components/CloseConfirmModal.svelte',
			'src/lib/components/QuotaModal.svelte',
			'src/lib/components/QueueDrawer.svelte',
			'src/lib/components/TaskEditor.svelte',
			'src/lib/components/BrowserViewer.svelte',
			'src/lib/components/DiagramViewer.svelte',
			'src/lib/components/PreviewViewer.svelte',
			'src/lib/components/companion/CompanionShell.svelte',
			'src/lib/components/models/CycleDrawer.svelte',
			'src/lib/components/settings/TasksSection.svelte',
			'src/lib/components/settings/SuggestionsSection.svelte',
			'src/lib/agent/components/ComposerTray.svelte',
			'src/routes/+page.svelte'
		];

		for (const relPath of closeSources) {
			const content = readFileSync(join(ROOT, relPath), 'utf-8');
			assert.ok(
				!content.includes('common_close') || !content.includes('<Tooltip text={m.common_close()}'),
				`${relPath} non deve contenere <Tooltip text={m.common_close()}>`
			);
		}
	});

	it('i pulsanti di cancellazione filtro/ricerca (clear-search) non mostrano tooltip ridondanti', () => {
		const searchSources = [
			'src/lib/components/FileTree.svelte',
			'src/lib/agent/components/ShortcutsHelpModal.svelte',
			'src/lib/components/settings/AppearanceSection.svelte'
		];

		for (const relPath of searchSources) {
			const content = readFileSync(join(ROOT, relPath), 'utf-8');
			assert.ok(
				!content.includes('clear-search-btn') || !content.includes('<Tooltip text={m.file_tree_clear_search()}'),
				`${relPath} non deve avvolgere il clear button con Tooltip`
			);
			assert.ok(
				!content.includes('clear-filter-btn') || !content.includes('<Tooltip text="Cancella filtro"'),
				`${relPath} non deve avvolgere il clear filter con Tooltip`
			);
		}
	});
});
