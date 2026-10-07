// Sorgente Mermaid -> SVG sanificato, condiviso dalla whiteboard dei diagrammi
// e dalle anteprime dei file scritti dall'agente.

import { sanitizeSvg } from '$lib/editor/svgSandbox';
import { tokenHex } from '$lib/theme';

// Mermaid crea un elemento temporaneo con questo id: due render concorrenti
// (piu' anteprime montate insieme) non devono condividerlo.
let renderSeq = 0;

/**
 * SVG sanificato del diagramma, con i colori del tema attivo al momento della
 * chiamata: al cambio tema va richiamata. Lancia se la sorgente non e' valida.
 */
export async function renderMermaidSvg(source: string): Promise<string> {
	// Import dinamico voluto: Mermaid pesa megabyte e questo modulo sta nel
	// percorso della chat; statico finirebbe nel bundle iniziale.
	const mermaidApi = (await import('mermaid')).default;
	mermaidApi.initialize({
		startOnLoad: false,
		securityLevel: 'strict',
		theme: 'base',
		// L'errore lo mostra chi chiama: senza, Mermaid disegna anche il proprio
		// diagramma d'errore prima di lanciare.
		suppressErrorRendering: true,
		// La sanificazione elimina <foreignObject>: le etichette HTML di
		// Mermaid sparirebbero. Con htmlLabels false sono <text> SVG.
		htmlLabels: false,
		flowchart: { htmlLabels: false },
		// I colori seguono i token del tema attivo. Mermaid li passa a
		// khroma, che non legge oklch() ne' color-mix(): servono gli
		// esadecimali risolti dal tema, non le espressioni dei token.
		themeVariables: {
			background: 'transparent',
			fontFamily: '"Inter Variable", "Inter", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
			fontSize: '13px',
			primaryColor: tokenHex('--bg-overlay'),
			primaryTextColor: tokenHex('--ink'),
			primaryBorderColor: tokenHex('--brand'),
			lineColor: tokenHex('--ink-faint'),
			secondaryColor: tokenHex('--bg-raised'),
			tertiaryColor: tokenHex('--bg-base')
		}
	});
	const { svg } = await mermaidApi.render(`studio-mermaid-${++renderSeq}`, source);
	return sanitizeSvg(svg);
}

/** Estensioni dei file Mermaid che omp mostra come diagramma. */
export function isMermaidFileName(path: string | null | undefined): boolean {
	if (!path) return false;
	const ext = path.split(/[\\/]/).pop()?.split('.').pop()?.toLowerCase();
	return ext === 'mmd' || ext === 'mermaid';
}
