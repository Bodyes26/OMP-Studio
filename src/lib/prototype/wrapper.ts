// Harness per la compilazione e rendering dei prototipi UI in sandbox isolata.
//
// Accetta codice HTML completo o snippet TSX/JSX (React 18 + Tailwind + Lucide)
// e restituisce un documento HTML completo, servito all'iframe dal server di
// anteprima loopback (un `srcdoc` erediterebbe la CSP dell'app).
//
// Le librerie sono a versione fissa: `lucide@latest` e' passato alla 1.x, che
// cambia il formato delle icone, e da un giorno all'altro ogni prototipo con
// icone si e' rotto. `extensions/studio-diagram.ts` contiene la stessa funzione:
// l'estensione e' un file unico incorporato nel binario e non puo' importarla.

export function wrapPrototypeCode(title: string, code: string): string {
	const raw = code.trim();
	if (raw.startsWith('<!DOCTYPE') || raw.startsWith('<html') || (raw.includes('<head') && raw.includes('<body'))) {
		return code;
	}

	// Gli import da `react` e `lucide-react` diventano le globali del documento;
	// gli altri non hanno un modulo da cui leggere e vengono tolti. Il codice
	// gira dentro un blocco: ridichiarare `useState` oscura quello del wrapper.
	let cleanedCode = code
		.replace(/^[ \t]*import\s+([^'";]*?)\s+from\s+['"]([^'"]+)['"];?[ \t]*$/gm, (_match, clause: string, source: string) => {
			const globalName = source === 'react' ? 'React' : source === 'lucide-react' ? 'LucideReact' : null;
			if (!globalName || clause.startsWith('type ')) return '';
			const declarations: string[] = [];
			const namespace = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
			if (namespace) declarations.push(`const ${namespace[1]} = ${globalName};`);
			const named = clause.match(/\{([\s\S]*?)\}/);
			if (named) {
				const specifiers = named[1]
					.split(',')
					.map((specifier) => specifier.trim())
					.filter((specifier) => specifier && !specifier.startsWith('type '))
					.map((specifier) => specifier.replace(/\s+as\s+/, ': '));
				if (specifiers.length) declarations.push(`const { ${specifiers.join(', ')} } = ${globalName};`);
			}
			return declarations.join(' ');
		})
		.replace(/^[ \t]*import\s+['"][^'"]+['"];?[ \t]*$/gm, '')
		.replace(/export\s+default\s+function\s+([A-Za-z0-9_]+)/g, 'function $1')
		.replace(/export\s+default\s+/g, 'const App = ')
		.replace(/export\s+(const|let|var|function|class)\s+/g, '$1 ');

	let compName = 'App';
	const funcMatch = cleanedCode.match(/function\s+([A-Z][A-Za-z0-9_]*)/);
	const constMatch = cleanedCode.match(/(?:const|let|var)\s+([A-Z][A-Za-z0-9_]*)\s*=/);
	if (funcMatch && funcMatch[1]) {
		compName = funcMatch[1];
	} else if (constMatch && constMatch[1]) {
		compName = constMatch[1];
	}

	return `<!DOCTYPE html>
<html lang="it" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <script src="https://cdn.tailwindcss.com/3.4.17"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            border: "hsl(240 3.7% 15.9%)",
            background: "hsl(240 10% 3.9%)",
            foreground: "hsl(0 0% 98%)",
            muted: "hsl(240 3.7% 15.9%)",
            "muted-foreground": "hsl(240 5% 64.9%)",
            card: "hsl(240 10% 3.9%)",
            "card-foreground": "hsl(0 0% 98%)",
            primary: "hsl(0 0% 98%)",
            "primary-foreground": "hsl(240 5.9% 10%)",
            secondary: "hsl(240 3.7% 15.9%)",
            "secondary-foreground": "hsl(0 0% 98%)",
            accent: "hsl(240 3.7% 15.9%)",
            "accent-foreground": "hsl(0 0% 98%)",
            destructive: "hsl(0 62.8% 30.6%)",
            "destructive-foreground": "hsl(0 0% 98%)"
          }
        }
      }
    }
  </script>
  <script crossorigin="anonymous" src="https://unpkg.com/react@18.3.1/umd/react.production.min.js"></script>
  <script crossorigin="anonymous" src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js"></script>
  <script crossorigin="anonymous" src="https://unpkg.com/@babel/standalone@7.29.9/babel.min.js"></script>
  <script crossorigin="anonymous" src="https://unpkg.com/lucide@1.52.0/dist/umd/lucide.js"></script>
  <script>
    // Lo script inline non ha estensione .tsx: senza allExtensions/isTSX il preset
    // typescript lascia passare i generici (useState<string>) come confronti.
    Babel.registerPreset('tsx', { presets: [[Babel.availablePresets['typescript'], { allExtensions: true, isTSX: true }]] });
  </script>
  <style>
    body {
      font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background-color: #09090b;
      color: #f4f4f5;
    }
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 9999px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.25); }
  </style>
</head>
<body class="min-h-screen p-4 sm:p-6 md:p-8 flex flex-col items-center justify-start antialiased selection:bg-neutral-800">
  <div id="root" class="w-full max-w-5xl flex flex-col items-center"></div>
  <div id="error-boundary" class="hidden w-full max-w-2xl mt-4 p-4 rounded-xl border border-red-500/30 bg-red-950/40 text-red-200 text-sm"></div>

  <script type="text/babel" data-presets="react,tsx">
    const { useState, useEffect, useMemo, useRef, useCallback } = React;

    const LucideReact = new Proxy({}, {
      get: (_, iconName) => {
        return (props) => {
          const { size = 18, className = '', ...rest } = props || {};
          const kebab = iconName.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
          const iconDef = window.lucide?.icons?.[iconName] || window.lucide?.icons?.[kebab];
          if (!iconDef) {
            return <span className={"inline-block text-xs " + className} {...rest}>[{iconName}]</span>;
          }
          // lucide 1.x espone solo i figli dell'svg: [[tag, attrs], ...].
          const svgAttrs = {
            xmlns: "http://www.w3.org/2000/svg",
            viewBox: "0 0 24 24",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 2,
            strokeLinecap: "round",
            strokeLinejoin: "round",
            width: size,
            height: size,
            className: "inline-block align-middle " + className,
            ...rest
          };
          return React.createElement(
            'svg',
            svgAttrs,
            iconDef.map(([cTag, cAttrs], i) => React.createElement(cTag, { ...cAttrs, key: i }))
          );
        };
      }
    });
    window.LucideReact = LucideReact;

    window.addEventListener('error', (e) => {
      const eb = document.getElementById('error-boundary');
      if (eb) {
        eb.classList.remove('hidden');
        eb.textContent = 'Errore runtime: ' + (e.message || e.error || 'Errore sconosciuto');
      }
    });

    setTimeout(() => { if (window.lucide?.createIcons) window.lucide.createIcons(); }, 100);

    try {
      ${cleanedCode}

      const rootEl = document.getElementById('root');
      const Comp = typeof App !== 'undefined' ? App : (
        typeof ${compName} !== 'undefined' ? ${compName} : (
          typeof Prototype !== 'undefined' ? Prototype : null
        )
      );
      if (Comp) {
        ReactDOM.createRoot(rootEl).render(<Comp />);
      }
    } catch (err) {
      const eb = document.getElementById('error-boundary');
      if (eb) {
        eb.classList.remove('hidden');
        eb.textContent = 'Errore di inizializzazione: ' + (err.message || String(err));
      }
    }
  </script>
</body>
</html>`;
}
