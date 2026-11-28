/**
 * Politica dei tooltip: i comandi la cui etichetta e' gia' ovvia (chiudere una
 * finestra, svuotare una ricerca) non mostrano una bolla ridondante. Il
 * controllo resta sul sorgente perche' l'oggetto e' proprio "nessun `<Tooltip>`
 * attorno a questo comando": un test di rendering verificherebbe che il
 * componente disegna la bolla, non che il comando non la riceva.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

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
