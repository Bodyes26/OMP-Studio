// Logica della schermata dell'installer: stati pronto, Studio aperto, installazione,
// fatto, errore. I comandi sono in src-tauri/installer/src/app.rs.

import { mountRuin } from './ruin.js';

const { invoke } = window.__TAURI__.core;

const STRINGS = {
	en: {
		tagline: 'Desktop workspace for the omp coding agent.',
		version: 'Version {v}',
		installedAs: 'Installed: {v}',
		install: 'Install',
		update: 'Update to {v}',
		reinstall: 'Reinstall',
		downgrade: 'Install {v}',
		downgradeNote: 'A newer version ({v}) is installed. This replaces it with an older one.',
		options: 'Options',
		folder: 'Install folder',
		browse: 'Browse…',
		folderLocked: 'OMP Studio is already installed here, so the folder stays the same.',
		desktop: 'Create a desktop shortcut',
		runningTitle: 'OMP Studio is open',
		runningText: 'Close it to continue. Closing it from here loses unsaved work.',
		closeFailed: 'OMP Studio didn’t close. Quit it from its tray icon, then retry.',
		retry: 'Retry',
		closeAndContinue: 'Close Studio and continue',
		installing: 'Installing OMP Studio…',
		updating: 'Updating OMP Studio…',
		installed: 'OMP Studio is ready',
		updated: 'OMP Studio is up to date',
		doneText: 'Installed in {dir}',
		open: 'Open OMP Studio',
		close: 'Close',
		errorTitle: 'Setup didn’t finish',
		errPayload: 'This installer is incomplete: it doesn’t contain OMP Studio. Download it again from the releases page.',
		errFolder: 'Choose a full folder path, without quotation marks.',
		errSpawn: 'The setup couldn’t start: {detail}',
		errExit: 'The setup stopped with code {code}. Retry, or use the classic installer to see each step.',
		errExitUnknown: 'The setup stopped unexpectedly. Retry, or use the classic installer to see each step.',
		errNotRegistered: 'The setup finished, but Windows doesn’t list OMP Studio among the installed apps.',
		errLaunch: 'OMP Studio didn’t start: {detail}',
		classic: 'Use the classic installer',
		foot: 'Installs for your Windows user only. No administrator rights needed.'
	},
	it: {
		tagline: 'Workspace desktop per l’agente di programmazione omp.',
		version: 'Versione {v}',
		installedAs: 'Installata: {v}',
		install: 'Installa',
		update: 'Aggiorna a {v}',
		reinstall: 'Reinstalla',
		downgrade: 'Installa la {v}',
		downgradeNote: 'È installata una versione più recente ({v}): verrà sostituita da una più vecchia.',
		options: 'Opzioni',
		folder: 'Cartella di installazione',
		browse: 'Sfoglia…',
		folderLocked: 'OMP Studio è già installato qui: la cartella resta questa.',
		desktop: 'Crea un collegamento sul desktop',
		runningTitle: 'OMP Studio è aperto',
		runningText: 'Chiudilo per continuare. Chiudendolo da qui il lavoro non salvato si perde.',
		closeFailed: 'OMP Studio non si è chiuso. Esci dall’icona nell’area di notifica, poi riprova.',
		retry: 'Riprova',
		closeAndContinue: 'Chiudi Studio e continua',
		installing: 'Installazione di OMP Studio…',
		updating: 'Aggiornamento di OMP Studio…',
		installed: 'OMP Studio è pronto',
		updated: 'OMP Studio è aggiornato',
		doneText: 'Installato in {dir}',
		open: 'Apri OMP Studio',
		close: 'Chiudi',
		errorTitle: 'L’installazione non è terminata',
		errPayload: 'Questo installer è incompleto: non contiene OMP Studio. Scaricalo di nuovo dalla pagina delle release.',
		errFolder: 'Scegli il percorso completo di una cartella, senza virgolette.',
		errSpawn: 'Il setup non è partito: {detail}',
		errExit: 'Il setup si è fermato con il codice {code}. Riprova, oppure usa l’installer classico per vedere ogni passaggio.',
		errExitUnknown: 'Il setup si è fermato all’improvviso. Riprova, oppure usa l’installer classico per vedere ogni passaggio.',
		errNotRegistered: 'Il setup è terminato, ma Windows non elenca OMP Studio fra le app installate.',
		errLaunch: 'OMP Studio non è partito: {detail}',
		classic: 'Usa l’installer classico',
		foot: 'Si installa solo per il tuo utente di Windows, senza diritti di amministratore.'
	}
};

const $ = (id) => document.getElementById(id);
let t = STRINGS.en;
let info = null;
let ruin = null;

function fmt(key, values = {}) {
	return t[key].replace(/\{(\w+)\}/g, (_, name) => values[name] ?? '');
}

function show(step) {
	for (const id of ['ready', 'working', 'done', 'failed']) $(id).hidden = id !== step;
}

function primaryLabel() {
	switch (info.installedRelation) {
		case 'older':
			return fmt('update', { v: info.version });
		case 'same':
		case 'unknown':
			return t.reinstall;
		case 'newer':
			return fmt('downgrade', { v: info.version });
		default:
			return t.install;
	}
}

function render() {
	document.documentElement.lang = info.lang;
	for (const node of document.querySelectorAll('[data-t]')) node.textContent = t[node.dataset.t];
	const meta = [fmt('version', { v: info.version })];
	if (info.installedVersion) meta.push(fmt('installedAs', { v: info.installedVersion }));
	$('meta').textContent = meta.join('  ·  ');
	$('install').textContent = primaryLabel();
	$('downgrade').hidden = info.installedRelation !== 'newer';
	$('downgrade').textContent = fmt('downgradeNote', { v: info.installedVersion ?? '' });
	$('dir').value = info.installDir;
	$('dir').disabled = info.dirLocked;
	$('browse').disabled = info.dirLocked;
	$('dir-locked').hidden = !info.dirLocked;
	setRunning(info.running);
}

function setRunning(running, failed = false) {
	$('running').hidden = !running;
	$('running-text').textContent = failed ? t.closeFailed : t.runningText;
	$('install').disabled = running;
}

function fail(failure) {
	const detail = failure?.detail;
	const messages = {
		payload: t.errPayload,
		folder: t.errFolder,
		spawn: fmt('errSpawn', { detail }),
		exit: detail == null ? t.errExitUnknown : fmt('errExit', { code: detail }),
		notRegistered: t.errNotRegistered,
		launch: fmt('errLaunch', { detail })
	};
	$('error-text').textContent = messages[failure?.kind] ?? String(failure);
	show('failed');
	$('retry').focus();
}

async function install() {
	const updating = info.installedRelation === 'older';
	$('working-title').textContent = updating ? t.updating : t.installing;
	show('working');
	ruin?.setBusy(true);
	try {
		const dir = await invoke('install', { dir: $('dir').value, desktop: $('desktop').checked });
		$('done-title').textContent = updating ? t.updated : t.installed;
		$('done-text').textContent = fmt('doneText', { dir });
		show('done');
		$('open').focus();
		ruin?.setBusy(false);
		ruin?.finish();
	} catch (failure) {
		ruin?.setBusy(false);
		if (failure?.kind === 'running') {
			show('ready');
			setRunning(true);
		} else {
			fail(failure);
		}
	}
}

function bind() {
	$('install').addEventListener('click', install);
	$('retry').addEventListener('click', async () => {
		info = await invoke('snapshot');
		render();
		show('ready');
		$('install').focus();
	});
	$('toggle-options').addEventListener('click', () => {
		const open = $('options').hidden;
		$('options').hidden = !open;
		$('toggle-options').setAttribute('aria-expanded', String(open));
	});
	$('browse').addEventListener('click', async () => {
		const picked = await invoke('pick_folder', { current: $('dir').value });
		if (picked) $('dir').value = picked;
	});
	$('retry-running').addEventListener('click', async () => {
		setRunning(await invoke('studio_running'));
	});
	$('close-studio').addEventListener('click', async () => {
		$('close-studio').disabled = true;
		const closed = await invoke('close_studio');
		$('close-studio').disabled = false;
		if (closed) {
			setRunning(false);
			install();
		} else {
			setRunning(true, true);
		}
	});
	$('open').addEventListener('click', () =>
		invoke('launch_studio').catch((detail) => fail({ kind: 'launch', detail }))
	);
	$('close').addEventListener('click', () => invoke('quit'));
	$('classic').addEventListener('click', () => invoke('run_classic'));
}

async function start() {
	info = await invoke('snapshot');
	t = STRINGS[info.lang] ?? STRINGS.en;
	document.documentElement.classList.toggle('solid', !info.mica);
	render();
	bind();
	if (!info.payload) fail({ kind: 'payload' });
	else show('ready');
	const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	try {
		ruin = await mountRuin($('ruin'), { reducedMotion });
	} catch {
		// Senza immagini resta il fondo scuro del riquadro: l'installazione funziona lo stesso.
	}
	await invoke('show_window');
	if (!info.payload) $('classic').hidden = true;
	else if (!info.running) $('install').focus();
}

start();
