import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Helper di logica tab percorsi coerente con ProjectStore
function isPathUnder(filePath: string, targetPath: string, isDir: boolean, isWindows: boolean): boolean {
	const normFile = filePath.replace(/\\/g, '/');
	const normTarget = targetPath.replace(/\\/g, '/').replace(/\/+$/, '');
	if (isDir) {
		if (normFile === normTarget || normFile.startsWith(normTarget + '/')) return true;
		if (isWindows) {
			const lowFile = normFile.toLowerCase();
			const lowTarget = normTarget.toLowerCase();
			return lowFile === lowTarget || lowFile.startsWith(lowTarget + '/');
		}
		return false;
	}
	if (normFile === normTarget) return true;
	if (isWindows) {
		return normFile.toLowerCase() === normTarget.toLowerCase();
	}
	return false;
}

function remapPath(filePath: string, from: string, to: string, isDir: boolean, isWindows: boolean): string | null {
	const normFile = filePath.replace(/\\/g, '/');
	const normFrom = from.replace(/\\/g, '/').replace(/\/+$/, '');
	const normTo = to.replace(/\\/g, '/').replace(/\/+$/, '');

	if (isDir) {
		if (normFile === normFrom || (isWindows && normFile.toLowerCase() === normFrom.toLowerCase())) {
			return to;
		}
		if (normFile.startsWith(normFrom + '/')) {
			const suffix = normFile.slice(normFrom.length);
			const joined = normTo + suffix;
			return (to.includes('\\') || filePath.includes('\\')) ? joined.replace(/\//g, '\\') : joined;
		}
		if (isWindows && normFile.toLowerCase().startsWith(normFrom.toLowerCase() + '/')) {
			const suffix = normFile.slice(normFrom.length);
			const joined = normTo + suffix;
			return (to.includes('\\') || filePath.includes('\\')) ? joined.replace(/\//g, '\\') : joined;
		}
	} else {
		if (normFile === normFrom || (isWindows && normFile.toLowerCase() === normFrom.toLowerCase())) {
			return to;
		}
	}
	return null;
}

function applyRename(openFiles: string[], activeFile: string | null, from: string, to: string, isDir: boolean, isWindows: boolean) {
	let activeChanged = false;
	let newActive = activeFile;
	const updated = openFiles.map((file) => {
		const remapped = remapPath(file, from, to, isDir, isWindows);
		if (remapped) {
			if (activeFile === file) {
				newActive = remapped;
				activeChanged = true;
			}
			return remapped;
		}
		return file;
	});
	return { openFiles: updated, activeFile: activeChanged ? newActive : activeFile };
}

function applyTrash(openFiles: string[], activeFile: string | null, targetPath: string, isDir: boolean, isWindows: boolean) {
	const isUnder = (file: string) => isPathUnder(file, targetPath, isDir, isWindows);
	const activeIsRemoved = activeFile !== null && isUnder(activeFile);
	const activeIndex = activeFile !== null ? openFiles.indexOf(activeFile) : -1;

	const remaining: string[] = [];
	let nextActiveCandidate: string | null = null;
	let prevActiveCandidate: string | null = null;

	for (let i = 0; i < openFiles.length; i++) {
		const file = openFiles[i];
		if (!isUnder(file)) {
			remaining.push(file);
			if (i > activeIndex && nextActiveCandidate === null) {
				nextActiveCandidate = file;
			}
			if (i < activeIndex) {
				prevActiveCandidate = file;
			}
		}
	}

	return {
		openFiles: remaining,
		activeFile: activeIsRemoved ? (nextActiveCandidate ?? prevActiveCandidate ?? null) : activeFile
	};
}
function moveProjectList(projects: Array<{ id: string }>, id: string, targetId: string) {
	if (id === targetId) return projects;
	const from = projects.findIndex(p => p.id === id);
	const targetIdx = projects.findIndex(p => p.id === targetId);
	if (from === -1 || targetIdx === -1) return projects;
	const [moved] = projects.splice(from, 1);
	const to = projects.findIndex(p => p.id === targetId);
	projects.splice(to, 0, moved);
	return projects;
}

function shiftProjectList(projects: Array<{ id: string }>, id: string, delta: number) {
	const from = projects.findIndex(p => p.id === id);
	if (from === -1) return projects;
	const to = Math.max(0, Math.min(projects.length - 1, from + delta));
	if (to === from) return projects;
	const [moved] = projects.splice(from, 1);
	projects.splice(to, 0, moved);
	return projects;
}


describe('Gestione tab e percorsi su rinomina/cestino', () => {
	it('rinomina file singolo aperto aggiornando path e activeFile', () => {
		const open = ['src/a.ts', 'src/b.ts', 'README.md'];
		const active = 'src/b.ts';
		const res = applyRename(open, active, 'src/b.ts', 'src/c.ts', false, false);
		assert.deepEqual(res.openFiles, ['src/a.ts', 'src/c.ts', 'README.md']);
		assert.equal(res.activeFile, 'src/c.ts');
	});

	it('rinomina directory aggiornando tutti i tab discendenti e preservando ordine', () => {
		const open = ['src/components/Button.svelte', 'src/lib/utils.ts', 'src/components/Modal.svelte'];
		const active = 'src/components/Modal.svelte';
		const res = applyRename(open, active, 'src/components', 'src/ui', true, false);
		assert.deepEqual(res.openFiles, ['src/ui/Button.svelte', 'src/lib/utils.ts', 'src/ui/Modal.svelte']);
		assert.equal(res.activeFile, 'src/ui/Modal.svelte');
	});

	it('supporta percorsi case-insensitive su Windows', () => {
		assert.equal(isPathUnder('SRC/LIB/MOD.RS', 'src/lib', true, true), true);
		assert.equal(isPathUnder('SRC/MAIN.RS', 'src/main.rs', false, true), true);
		const res = applyRename(['SRC/MAIN.RS'], 'SRC/MAIN.RS', 'src/main.rs', 'src/app.rs', false, true);
		assert.deepEqual(res.openFiles, ['src/app.rs']);
		assert.equal(res.activeFile, 'src/app.rs');
	});

	it('cestino su file attivo seleziona la scheda adiacente a destra se disponibile', () => {
		const open = ['a.txt', 'b.txt', 'c.txt'];
		const active = 'b.txt';
		const res = applyTrash(open, active, 'b.txt', false, false);
		assert.deepEqual(res.openFiles, ['a.txt', 'c.txt']);
		assert.equal(res.activeFile, 'c.txt');
	});

	it('cestino sull ultimo file attivo seleziona la scheda a sinistra', () => {
		const open = ['a.txt', 'b.txt', 'c.txt'];
		const active = 'c.txt';
		const res = applyTrash(open, active, 'c.txt', false, false);
		assert.deepEqual(res.openFiles, ['a.txt', 'b.txt']);
		assert.equal(res.activeFile, 'b.txt');
	});

	it('cestino su directory elimina tutti i file aperti al suo interno', () => {
		const open = ['src/a.ts', 'src/b.ts', 'docs/index.md'];
		const active = 'src/a.ts';
		const res = applyTrash(open, active, 'src', true, false);
		assert.deepEqual(res.openFiles, ['docs/index.md']);
		assert.equal(res.activeFile, 'docs/index.md');
	});
});

describe('Riordino progetti (manuale e drag&drop)', () => {
	it('moveProject riordina spostando il progetto trascinato nella posizione target', () => {
		const projects = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }];
		moveProjectList(projects, 'p3', 'p1');
		assert.deepEqual(projects.map(p => p.id), ['p3', 'p1', 'p2', 'p4']);
	});

	it('moveProject gestisce spostamento da sinistra a destra', () => {
		const projects = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }];
		moveProjectList(projects, 'p1', 'p4');
		assert.deepEqual(projects.map(p => p.id), ['p2', 'p3', 'p1', 'p4']);
	});

	it('moveProject ignora spostamenti su se stesso o id inesistenti', () => {
		const projects = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }];
		moveProjectList(projects, 'p2', 'p2');
		assert.deepEqual(projects.map(p => p.id), ['p1', 'p2', 'p3']);
		moveProjectList(projects, 'p99', 'p1');
		assert.deepEqual(projects.map(p => p.id), ['p1', 'p2', 'p3']);
	});

	it('shiftProject sposta la scheda a sinistra o a destra rispettando i limiti', () => {
		const projects = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }];
		shiftProjectList(projects, 'p2', -1);
		assert.deepEqual(projects.map(p => p.id), ['p2', 'p1', 'p3']);
		shiftProjectList(projects, 'p2', -1); // al limite sinistro
		assert.deepEqual(projects.map(p => p.id), ['p2', 'p1', 'p3']);
		shiftProjectList(projects, 'p2', 1);
		assert.deepEqual(projects.map(p => p.id), ['p1', 'p2', 'p3']);
	});
});
