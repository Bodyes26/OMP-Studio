# Scorciatoie da tastiera

OMP Studio delega l'intero blocco di tasti e scorciatoie convenzionali (incluse quelle con `Ctrl` e `Alt`) al terminale PTY, tranne quando il fuoco e' nell'editor Monaco. In quel caso le scorciatoie di gestione file agiscono solo sul file attivo, senza intercettare input del terminale.

Le uniche scorciatoie globali catturate dall'app vivono dietro il modificatore **`Ctrl+Alt`**, che non collide con le combinazioni primarie di `omp`.

| Scorciatoia | Contesto | Azione |
|---|---|---|
| `Ctrl+Alt+N` | Globale | Nuovo progetto (apre selettore cartella) |
| `Ctrl+Alt+S` | Globale | Apre una chat Scratchpad (temporanea, `--no-session`) |
| `Ctrl+Alt+U` | Globale | Apre e chiude il pannello consumi (quote) |
| `Ctrl+Alt+,` | Globale | Apre le impostazioni di Studio (Generale, Barra progetti, Editor & Terminale, Task & Agenti, Modelli) |
| `Ctrl+Alt+M` | Globale | Apre le impostazioni direttamente sulla sezione Modelli (Ruoli, Catalogo, Provider) |
| `Ctrl+Alt+T` | Globale | Apre e chiude la vista aggregata dei task in attesa su tutti i progetti |
| `Ctrl+Alt+A` | Globale | Passa tra la superficie TERMINAL e la superficie GUI conservando la sessione |
| `Ctrl+Alt+Freccia Destra` | Globale | Passa al progetto aperto successivo, nell'ordine mostrato in barra |
| `Ctrl+Alt+Freccia Sinistra` | Globale | Passa al progetto aperto precedente, nell'ordine mostrato in barra |
| `Ctrl+Alt+Maiusc+Freccia` | Globale | Sposta la tessera del progetto attivo a destra o a sinistra (ordinamento manuale) |
| `Ctrl+P` | Superficie GUI | Cicla sequenzialmente tra i ruoli configurati (`default` → `plan` → `smol`...) |
| `Alt+R` | Superficie GUI | Apre il menu rapido di selezione del ruolo con filtro e navigazione |
| `Alt+P` | Superficie GUI | Apre il catalogo modelli con filtro rapido e navigazione tastiera |
| `Alt+M` | Superficie GUI | Apre il menu di selezione del livello di thinking (ragionamento) |
| `Alt+T` | Superficie GUI | Cicla direttamente il livello di thinking (`off` → `max`) |
| `Alt+Q` | Superficie GUI | Apre le impostazioni della coda (steering, follow-up, interruzione) |
| `Alt+S` | Superficie GUI | Alterna rapidamente la modalità steering (`one-at-a-time` / `all`) |
| `Alt+C` | Superficie GUI | Interrompe la risposta in corso o cancella il testo scritto |
| `Ctrl+C` | Superficie GUI | Interrompe la risposta in streaming (quando non c'è testo evidenziato) |
| `Alt+E` | Superficie GUI | Mette a fuoco il campo di scrittura del Composer |
| `Alt+H` / `Alt+K` / `F1` | Superficie GUI | Apre la finestra di riepilogo delle scorciatoie da tastiera |
| `/` | Composer GUI | Apre la palette dei comandi slash disponibili |
| `Invio` | Composer GUI | Invia; con la palette aperta seleziona il comando evidenziato |
| `Maiusc+Invio` / `Ctrl+Invio` | Composer GUI | Inserisce una nuova riga |
| `Esc` | Composer GUI | Chiude palette/menu/modale aiuto; durante lo streaming interrompe la risposta |
| `Ctrl+0` | Diagramma a fuoco | Adatta il diagramma alla finestra |
| `Ctrl+S` | Editor | Salva il file corrente e lo notifica |
| `Ctrl+W` | Editor | Chiude il file corrente |
| `Ctrl+F4` | Editor | Chiude il file corrente |
| `Esc` | Popover / Dialog | Chiude la finestra modale aperta |
*Nota: all'interno del terminale `Ctrl+S`, `Ctrl+W` e `Ctrl+F4` non gestiscono i file dell'editor: vengono inviati all'agente se supportati, o restano soggetti al comportamento del terminale nativo.*
