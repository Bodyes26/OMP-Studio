/**
 * Dizionario bilingue italiano/inglese per la PWA di controllo remoto.
 * La lingua e' scelta in base a navigator.language (italiano se inizia con 'it').
 */

export type Language = 'it' | 'en';

export function detectLanguage(): Language {
	if (typeof navigator !== 'undefined' && navigator.language) {
		return navigator.language.toLowerCase().startsWith('it') ? 'it' : 'en';
	}
	return 'it';
}

const DICT = {
	it: {
		appTitle: 'OMP Studio Remote',
		shortTitle: 'Studio',
		offlineBanner: 'Disconnesso dal relay. Riconnessione in corso...',
		settings: 'Impostazioni',
		close: 'Chiudi',
		cancel: 'Annulla',
		confirm: 'Conferma',
		yes: 'Sì',
		no: 'No',
		send: 'Invia',
		submit: 'Invia risposte',
		run: 'Avvia',
		runOn: 'Avvia su {machine}',
		running: 'In avvio...',
		otherOption: 'Altro...',
		recommendedBadge: 'Consigliata',
		recentContext: 'Contesto recente',
		attentionFallbackTitle: "Richiesta dell'agente",
		fullPrompt: 'Prompt completo',
		expiresIn: 'Scade tra {time}',
		expired: 'Scaduto',

		// Pairing
		pairTitle: 'Abbina questo dispositivo',
		pairSubtitle: 'Inserisci il codice di abbinamento generato da un dispositivo già connesso o usa il segreto admin.',
		deviceName: 'Nome di questo dispositivo',
		deviceNamePlaceholder: 'Es. iPhone di Maurizio',
		pairingCode: 'Codice di abbinamento',
		pairingCodePlaceholder: 'XXXX-XXXX',
		useAdminSecret: 'Usa il token di amministrazione',
		adminSecretPlaceholder: 'RELAY_ADMIN_TOKEN',
		usePairingCode: 'Usa un codice di abbinamento',
		pairButton: 'Abbina dispositivo',
		pairingInProgress: 'Abbinamento in corso...',
		errInvalidCode: 'Codice non valido o scaduto.',
		errInvalidSecret: 'Token di amministrazione non valido.',
		errRateLimited: 'Troppi tentativi falliti. Riprova tra qualche minuto.',
		errNetwork: 'Impossibile contattare il relay. Verifica la connessione.',

		// Dashboard
		noMachines: 'Nessuna macchina abbinata',
		noMachinesHint: 'Abbina una macchina dalle Impostazioni per vederne i progetti.',
		online: 'online',
		offline: 'offline',
		offlineSince: 'offline da {time}',
		lastStateAt: 'ultimo stato alle {time}',
		quotaTitle: 'Quote',
		quotaReset: 'reset alle {time}',
		quotaExhausted: 'esaurita',
		quotaWarning: 'in esaurimento',
		waitQuotaReset: 'Aspetta il reset',
		dismissQuotaBlocked: 'Archivia',

		// Projects & Lanes
		projectsTitle: 'Progetti',
		noProjects: 'Nessun progetto aperto',
		hostRenderError: 'Non riesco a mostrare lo stato di questa macchina: aggiorna Studio e il relay.',
		activeProject: 'in primo piano',
		laneMain: 'Principale',
		laneWorktree: 'Worktree',
		laneLab: 'Laboratorio',
		stateOffline: 'offline',
		stateIdle: 'inattivo',
		stateWorking: 'al lavoro',
		stateBackground: 'in background',
		stateAttention: 'richiede attenzione',
		stateError: 'errore',

		// Tasks
		tasksTitle: 'Coda task',
		noTasks: 'Nessun task in coda',
		nextMarker: 'Prossimo',
		resumeMarker: 'Ripresa',
		readBeforeRunTitle: 'Conferma avvio task',
		scheduleReset: 'al reset ~{time}',
		scheduleAt: 'dopo {time}',
		scheduleMissed: 'saltato: decidi in Studio',

		// Settings
		settingsTitle: 'Impostazioni',
		thisDevice: 'Questo dispositivo',
		relayVersion: 'Versione relay: {version}',
		currentDeviceBadge: 'questo',
		devicesList: 'Dispositivi autorizzati',
		revoke: 'Revoca',
		revokeConfirm: 'Revocare questo dispositivo?',
		logout: 'Esci',
		machinesList: 'Macchine abbinate',
		revokeMachine: 'Revoca macchina',
		revokeMachineConfirm: 'Revocare l\'accesso alla macchina "{name}"?',
		addDeviceBtn: 'Aggiungi un dispositivo',
		pairHostBtn: 'Abbina una macchina',
		deviceCodeTitle: 'Nuovo dispositivo',
		deviceCodeDesc: 'Apri la PWA sul nuovo dispositivo e digita questo codice:',
		hostCodeTitle: 'Abbina Studio',
		hostCodeDesc: 'In Studio apri Impostazioni > Controllo remoto, inserisci questo indirizzo del relay:',
		hostCodeStep2: 'e inserisci questo codice di abbinamento:',
		copied: 'Copiato!',
		copyCode: 'Copia codice',
		copyUrl: 'Copia indirizzo',
		codeExpiresIn: 'Scade tra {time}',

		// Errori comandi
		errHostOffline: 'La macchina è offline',
		errTimeout: 'Nessuna risposta entro il tempo limite (30s)',
		errUnsupported: 'Funzione non supportata dalla macchina',
		errNotFound: 'Elemento non trovato (richiesta o task inesistente)',
		errRejected: 'Comando rifiutato dalla macchina',
		errDisabled: 'Controllo remoto disabilitato sulla macchina',
		errFailed: 'Esecuzione del comando fallita',
		errUnknown: 'Errore sconosciuto'
	},
	en: {
		appTitle: 'OMP Studio Remote',
		shortTitle: 'Studio',
		offlineBanner: 'Disconnected from relay. Reconnecting...',
		settings: 'Settings',
		close: 'Close',
		cancel: 'Cancel',
		confirm: 'Confirm',
		yes: 'Yes',
		no: 'No',
		send: 'Send',
		submit: 'Submit answers',
		run: 'Run',
		runOn: 'Run on {machine}',
		running: 'Starting...',
		otherOption: 'Other...',
		recommendedBadge: 'Recommended',
		recentContext: 'Recent context',
		attentionFallbackTitle: 'Agent request',
		fullPrompt: 'Full prompt',
		expiresIn: 'Expires in {time}',
		expired: 'Expired',

		// Pairing
		pairTitle: 'Pair this device',
		pairSubtitle: 'Enter a pairing code from an already connected device, or use the admin token.',
		deviceName: 'Device name',
		deviceNamePlaceholder: 'e.g. iPhone',
		pairingCode: 'Pairing code',
		pairingCodePlaceholder: 'XXXX-XXXX',
		useAdminSecret: 'Use admin secret',
		adminSecretPlaceholder: 'RELAY_ADMIN_TOKEN',
		usePairingCode: 'Use a pairing code',
		pairButton: 'Pair device',
		pairingInProgress: 'Pairing...',
		errInvalidCode: 'Invalid or expired code.',
		errInvalidSecret: 'Invalid admin token.',
		errRateLimited: 'Too many failed attempts. Try again in a few minutes.',
		errNetwork: 'Could not contact relay. Check connection.',

		// Dashboard
		noMachines: 'No machines paired',
		noMachinesHint: 'Pair a machine in Settings to view its projects.',
		online: 'online',
		offline: 'offline',
		offlineSince: 'offline since {time}',
		lastStateAt: 'last state at {time}',
		quotaTitle: 'Quotas',
		quotaReset: 'resets at {time}',
		quotaExhausted: 'exhausted',
		quotaWarning: 'warning',
		waitQuotaReset: 'Wait for reset',
		dismissQuotaBlocked: 'Dismiss',

		// Projects & Lanes
		projectsTitle: 'Projects',
		noProjects: 'No active projects',
		hostRenderError: "Can't display this machine's state: update Studio and the relay.",
		activeProject: 'active',
		laneMain: 'Main',
		laneWorktree: 'Worktree',
		laneLab: 'Lab',
		stateOffline: 'offline',
		stateIdle: 'idle',
		stateWorking: 'working',
		stateBackground: 'in background',
		stateAttention: 'attention needed',
		stateError: 'error',

		// Tasks
		tasksTitle: 'Task queue',
		noTasks: 'No tasks in queue',
		nextMarker: 'Next',
		resumeMarker: 'Resume',
		readBeforeRunTitle: 'Confirm task execution',
		scheduleReset: 'at reset ~{time}',
		scheduleAt: 'after {time}',
		scheduleMissed: 'missed: decide in Studio',

		// Settings
		settingsTitle: 'Settings',
		thisDevice: 'This device',
		relayVersion: 'Relay version: {version}',
		currentDeviceBadge: 'current',
		devicesList: 'Authorized devices',
		revoke: 'Revoke',
		revokeConfirm: 'Revoke this device?',
		logout: 'Log out',
		machinesList: 'Paired machines',
		revokeMachine: 'Revoke machine',
		revokeMachineConfirm: 'Revoke access for machine "{name}"?',
		addDeviceBtn: 'Add a device',
		pairHostBtn: 'Pair a machine',
		deviceCodeTitle: 'New device',
		deviceCodeDesc: 'Open the PWA on the new device and enter this code:',
		hostCodeTitle: 'Pair Studio',
		hostCodeDesc: 'In Studio, open Settings > Remote Control and enter this relay address:',
		hostCodeStep2: 'and enter this pairing code:',
		copied: 'Copied!',
		copyCode: 'Copy code',
		copyUrl: 'Copy address',
		codeExpiresIn: 'Expires in {time}',

		// Command errors
		errHostOffline: 'Host is offline',
		errTimeout: 'No response within timeout (30s)',
		errUnsupported: 'Feature not supported by host',
		errNotFound: 'Item not found (request or task does not exist)',
		errRejected: 'Command rejected by host',
		errDisabled: 'Remote control is disabled on host',
		errFailed: 'Command execution failed',
		errUnknown: 'Unknown error'
	}
} as const;

export type MessageKey = keyof typeof DICT['it'];

let currentLang: Language = detectLanguage();

export function setLanguage(lang: Language): void {
	currentLang = lang;
}

export function getLanguage(): Language {
	return currentLang;
}

export function t(key: MessageKey, params?: Record<string, string | number>): string {
	const table = DICT[currentLang] ?? DICT.it;
	let str: string = (table as Record<string, string>)[key] ?? (DICT.it as Record<string, string>)[key] ?? key;
	if (params) {
		for (const [k, v] of Object.entries(params)) {
			str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
		}
	}
	return str;
}
