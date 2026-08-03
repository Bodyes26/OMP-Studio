# Scorciatoie da tastiera

OMP Studio delega l'intero blocco di tasti e scorciatoie convenzionali (incluse quelle con `Ctrl` e `Alt`) al terminale PTY, tranne quando il fuoco e' nell'editor Monaco. In quel caso le scorciatoie di gestione file agiscono solo sul file attivo, senza intercettare input del terminale.

Le uniche scorciatoie globali catturate dall'app vivono dietro il modificatore **`Ctrl+Alt`**, che non collide con le combinazioni primarie di `omp`.

| Scorciatoia | Contesto | Azione |
|---|---|---|
| `Ctrl+Alt+N` | Globale | Nuovo progetto (apre selettore cartella) |
| `Ctrl+Alt+S` | Globale | Apre una chat Scratchpad (temporanea, `--no-session`) |
| `Ctrl+Alt+U` | Globale | Apre e chiude il pannello consumi (quote) |
| `Ctrl+Alt+Freccia Destra` | Globale | Passa al progetto aperto successivo |
| `Ctrl+Alt+Freccia Sinistra` | Globale | Passa al progetto aperto precedente |
| `Ctrl+S` | Editor | Salva il file corrente e lo notifica |
| `Ctrl+W` | Editor | Chiude il file corrente |
| `Ctrl+F4` | Editor | Chiude il file corrente |
| `Esc` | Popover / Dialog | Chiude la finestra modale aperta |

*Nota: all'interno del terminale `Ctrl+S`, `Ctrl+W` e `Ctrl+F4` non gestiscono i file dell'editor: vengono inviati all'agente se supportati, o restano soggetti al comportamento del terminale nativo.*
