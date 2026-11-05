// Segnali verso i terminali montati. Vive fuori da terminal.ts perche' quel
// modulo importa xterm: chi deve solo inviare un segnale (gli store caricati
// all'avvio) non deve tirarsi dietro la libreria del terminale.

export const OMP_TERMINALS_RESTART_EVENT = 'omp-terminals-restart';

export function restartOmpTerminals(targetCwd?: string) {
	window.dispatchEvent(new CustomEvent(OMP_TERMINALS_RESTART_EVENT, { detail: { targetCwd } }));
}
