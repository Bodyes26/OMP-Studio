// Template di riferimento per i prototipi UI (vibecoding) generati da omp o dall'utente.
//
// Un prototipo e' un singolo file .html autonomo salvato in `proto/` (es. `proto/quota-card.html`).
// Nessun build step, nessun server locale:
// - React 18 + ReactDOM (UMD)
// - Babel standalone per TSX/JSX inline (data-presets="react,typescript")
// - Tailwind CSS (Play CDN con dark mode e palette stile shadcn/zinc)
// - Lucide Icons (SVG proxy + lucide.createIcons)
// - Error boundary e cattura runtime
//
// L'agente puo' generarlo direttamente usando il tool `studio_preview` o creando il file in `proto/`.

import { m } from '#lib/paraglide/messages.js';
import { getLocale } from '#lib/paraglide/runtime.js';

/** Documento di riferimento: la lingua attiva si risolve qui, il template e' statico. */
export default function prototypeTemplate(): string {
	// Testi dell'error boundary: virgolettati con JSON.stringify, cosi' un apostrofo
	// nella traduzione non rompe lo script generato.
	const runtimeErrorPrefix = JSON.stringify(m.l10n_lab_remote_preview_runtime_error_prefix() + ': ');
	const unknownErrorText = JSON.stringify(m.l10n_lab_remote_preview_error_unknown());
	return `<!DOCTYPE html>
<html lang="${getLocale()}" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${m.l10n_lab_remote_prototype_template_title()}</title>
  <script src="https://cdn.tailwindcss.com"></script>
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
            popover: "hsl(240 10% 3.9%)",
            "popover-foreground": "hsl(0 0% 98%)",
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
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"><\/script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"><\/script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"><\/script>
  <script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js"><\/script>
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

  <script type="text/babel" data-presets="react,typescript">
    const { useState, useEffect, useMemo, useRef, useCallback } = React;

    // Proxy Lucide per usare icone come <LucideReact.Sparkles size={18} /> o estrarre const { Check } = LucideReact;
    const LucideReact = new Proxy({}, {
      get: (_, iconName) => {
        return (props) => {
          const { size = 18, className = '', ...rest } = props || {};
          const kebab = iconName.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
          const iconDef = window.lucide?.icons?.[iconName] || window.lucide?.icons?.[kebab];
          if (!iconDef) {
            return <span className={"inline-block text-xs " + className} {...rest}>[{iconName}]</span>;
          }
          const [tag, attrs, children] = iconDef;
          const svgAttrs = {
            ...attrs,
            width: size,
            height: size,
            className: "inline-block align-middle " + className,
            ...rest
          };
          return React.createElement(
            'svg',
            svgAttrs,
            (children || []).map(([cTag, cAttrs], i) => React.createElement(cTag, { ...cAttrs, key: i }))
          );
        };
      }
    });
    window.LucideReact = LucideReact;

    window.addEventListener('error', (e) => {
      const eb = document.getElementById('error-boundary');
      if (eb) {
        eb.classList.remove('hidden');
        eb.textContent = ${runtimeErrorPrefix} + (e.message || e.error || ${unknownErrorText});
      }
    });

    setTimeout(() => { if (window.lucide?.createIcons) window.lucide.createIcons(); }, 100);

    function App() {
      const [count, setCount] = useState(0);
      return (
        <div className="w-full max-w-md rounded-2xl bg-zinc-900/90 border border-zinc-800 p-6 shadow-2xl backdrop-blur-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-400">
              <LucideReact.Sparkles size={20} />
            </div>
            <div>
              <h1 className="text-base font-semibold text-zinc-100">${m.l10n_lab_remote_prototype_template_heading()}</h1>
              <p className="text-xs text-zinc-400">${m.l10n_lab_remote_prototype_template_subtitle()}</p>
            </div>
          </div>
          
          <p className="text-sm text-zinc-300 leading-relaxed mb-6">
            ${m.l10n_lab_remote_prototype_template_body()}
          </p>

          <div className="flex items-center justify-between pt-4 border-t border-zinc-800/80">
            <span className="text-xs text-zinc-400">${m.l10n_lab_remote_prototype_template_interactions()} <strong className="text-zinc-200">{count}</strong></span>
            <button
              onClick={() => setCount((c) => c + 1)}
              className="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-zinc-100 text-zinc-900 hover:bg-white active:scale-95 transition-all shadow-sm"
            >
              <span>${m.l10n_lab_remote_prototype_template_test_click()}</span>
              <LucideReact.ArrowRight size={14} />
            </button>
          </div>
        </div>
      );
    }

    ReactDOM.createRoot(document.getElementById('root')).render(<App />);
  <\/script>
</body>
</html>`;
}

