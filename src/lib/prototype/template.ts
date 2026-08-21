// Template di riferimento per i prototipi UI generati dall'agente.
//
// Un prototipo e' un singolo file .html autonomo: l'agente lo crea nel
// progetto (es. prototypes/quota-card.html) e l'utente lo apre con il
// pulsante "Anteprima" dell'editor. Nessun build step, nessun server.
//
// Stack caricato da CDN (funziona offline solo se le risorse sono in cache:
// per prototipi completamente offline usare HTML+CSS puro senza import):
// - React 18 + ReactDOM (UMD)
// - Babel standalone per JSX inline
// - Tailwind CSS (Play CDN)
// - Lucide (icone SVG)
//
// Istruzioni per l'agente: copia questo file come punto di partenza e
// sostituisci il componente `App` con il prototipo richiesto.

const TEMPLATE = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Prototipo</title>
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"><\/script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"><\/script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"><\/script>
  <script src="https://cdn.tailwindcss.com"><\/script>
  <script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js"><\/script>
  <style>
    body { font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; }
  </style>
</head>
<body class="bg-neutral-950 text-neutral-100 min-h-screen flex items-center justify-center p-6">
  <div id="root"></div>

  <script type="text/babel" data-type="module">
    const { useState } = React;

    function App() {
      return (
        <div className="max-w-sm rounded-xl bg-neutral-900 border border-neutral-800 p-5 shadow-lg">
          <h1 className="text-lg font-semibold mb-2">Prototipo</h1>
          <p className="text-sm text-neutral-400">
            Sostituisci questo componente con il tuo prototipo.
          </p>
        </div>
      );
    }

    ReactDOM.createRoot(document.getElementById('root')).render(<App />);
  <\/script>
</body>
</html>`;

export default TEMPLATE;
