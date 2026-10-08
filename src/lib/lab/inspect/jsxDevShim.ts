// Mappa sorgente del Laboratorio (Gate R42).
//
// esbuild con `jsxDev: true` chiama `jsxDEV(type, props, key, isStatic, source)`
// con `source = { fileName: 'vfs:/src/App.tsx', lineNumber, columnNumber }`.
// Il compilatore risolve `react/jsx-dev-runtime` verso questo modulo virtuale,
// che delega al runtime di produzione vendorizzato e:
//  - sugli elementi host (`type` stringa) aggiunge `data-lab-loc="src/App.tsx:12:5"`;
//  - sui componenti registra il punto di chiamata in una WeakMap `props -> loc`
//    (`fiber.memoizedProps === element.props`), letta dall'ispettore per gli
//    elementi senza attributo (icone e componenti di librerie esterne).
// Lo shim vive solo nel compilatore di Studio: l'esportazione resta un progetto
// Vite pulito, senza attributi.

/** Nome dell'attributo DOM con `file:riga:colonna` del JSX che ha creato l'elemento. */
export const LAB_LOC_ATTR = 'data-lab-loc';

/** `vfs:/src/App.tsx` + 12 + 5 -> `src/App.tsx:12:5` (percorso relativo al prototipo). */
export function labLocFromSource(fileName: string, lineNumber: number, columnNumber: number): string {
	const path = fileName.replace(/^(?:[a-z-]+:)?\/+/i, '');
	return `${path}:${lineNumber}:${columnNumber}`;
}

/** Sorgente del modulo virtuale `react/jsx-dev-runtime` iniettato dal compilatore. */
export const LAB_JSX_DEV_SHIM = `import { jsx, jsxs, Fragment } from 'react/jsx-runtime';
export { Fragment };
const inspect = (globalThis.__labInspect = globalThis.__labInspect || { callSites: new WeakMap() });
const callSites = inspect.callSites;
function toLoc(source) {
  return String(source.fileName).replace(/^(?:[a-z-]+:)?\\/+/i, '') + ':' + source.lineNumber + ':' + source.columnNumber;
}
export function jsxDEV(type, config, key, isStatic, source) {
  const make = isStatic ? jsxs : jsx;
  if (!source || !source.fileName) return make(type, config, key);
  const loc = toLoc(source);
  if (typeof type === 'string') {
    const props = Object.assign({}, config);
    props['${LAB_LOC_ATTR}'] = loc;
    return make(type, props, key);
  }
  const el = make(type, config, key);
  try {
    if (el && el.props && typeof el.props === 'object') callSites.set(el.props, loc);
  } catch (_) {}
  return el;
}
`;
