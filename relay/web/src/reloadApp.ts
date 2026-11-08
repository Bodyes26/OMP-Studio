/**
 * Ricarica la PWA da zero. Tutto lo stato vive sul relay, quindi la ricarica
 * e' sicura; serve quando la schermata resta ferma e l'unica via d'uscita
 * sarebbe chiudere e riaprire l'app.
 */
export function reloadApp(): void {
	window.location.reload();
}
