# Screenshot e video del README

Le immagini del README stanno in `assets/screenshots/` e vanno rifatte quando
l'interfaccia cambia in modo visibile (ultimo giro: 1.10.0, novembre 2026, da macOS).
Servono l'app desktop vera e la finestra di Studio già aperta: niente cloud, niente
seconda istanza.

## File

| File | Contenuto |
|---|---|
| `screen_hero.png` | Finestra intera sul progetto demo: barra progetti, riga corsie con almeno due corsie worktree e un prototipo del Laboratorio, albero file, editor con un file modificato, chat con gruppo di tool e risposta finale. |
| `demo_lanes.gif` | Animazione di circa 25 s: task in coda → «New lane» → riepilogo della corsia → Review & Integrate → commit nella cronologia Git. |
| `screen_remote.png` | Tre schermate della PWA di Studio Remote dall'iPhone (elenco progetti con le corsie del demo, chat di una corsia, foglio «Nuovo lavoro»), affiancate su fondo trasparente. I nomi di progetti privati vanno pixelati; niente quote con email, niente impostazioni con i nomi delle macchine. |
| `screen_lab.png` | Prototipo del Laboratorio: anteprima a sinistra, chat con il riepilogo dell'agente a destra. |

Formato: PNG largo 1920 px. La cattura della finestra (1440×770 punti su Retina, angoli
arrotondati trasparenti) sta su uno sfondo a gradiente diagonale indaco → viola → rosa
(`#4338CA` → `#8B5CF6` → `#EC4899`, con un bagliore chiaro in alto a sinistra), con il
6% di margine e un'ombra sfocata sotto la finestra. Compressione con `pngquant
--quality=75-95`: 250–350 KB. Per Remote le tre schermate del telefono hanno angoli
arrotondati e la stessa ombra sullo stesso gradiente.

La GIF nasce da una registrazione MP4 (in `ricerca/readme-media/`, fuori da git),
montata con `ffmpeg`: video a 8 fps scalato a 844 px, angoli arrotondati con
`alphamerge`, sovrapposto allo stesso gradiente (960 px di larghezza), poi
`palettegen` a 256 colori e `paletteuse` con dithering bayer: circa 2 MB. Le immagini
in più (`-loop 1`) vanno limitate con `-t` alla durata del video, altrimenti ffmpeg
non termina. Un MP4 si vedrebbe meglio, ma GitHub lo
riproduce nel README solo come allegato `user-attachments`, che si carica dal browser
trascinandolo in una issue: `gh` non ha un comando per farlo.

## Regole

- Repo pubblico: solo il progetto demo. Nessun cliente, server, token, email o
  percorso aziendale; se un'immagine li mostra, va rifatta.
- Tema scuro (`titanium`), lingua inglese; a fine lavoro si rimettono le
  impostazioni dell'utente.
- Mai PowerShell; mai avviare `npm run tauri -- dev` o l'eseguibile.
- Nessun commit: i file restano nel working tree.

## Procedura su macOS

Permessi una tantum in Impostazioni di Sistema → Privacy e sicurezza, per
`omp-studio-app` (l'agente gira dentro Studio): **Registrazione schermo** e
**Accessibilità**. Registrazione schermo vale solo dopo il riavvio di Studio.

1. Progetto demo in `~/demo/omp-demo-app`: piccola app Svelte 5 + TS (lista task),
   due commit con autore `Demo <demo@example.com>`. Aprirlo da `+` → *Browse…*
   (nel pannello di sistema `⌘⇧G` e il percorso).
2. Far lavorare l'agente: un task in Main e due task in coda avviati con
   «New lane»; un prototipo da `+` → *New prototype*.
3. Comandi: `cliclick` (Homebrew) per mouse e tasti; per incollare testo
   `pbcopy` + `osascript -e 'tell application "System Events" to keystroke "v" using command down'`
   (`cliclick t:` e `kp:return` non arrivano sempre alla WebView). I menu a
   comparsa di Studio vogliono un clic lento: `m:`, pausa, `dd:`, 0,1 s, `du:`.
4. Cattura della sola finestra: id con Quartz
   (`CGWindowListCopyWindowInfo`, proprietario `omp-studio-app`, layer 0), poi
   `screencapture -x -o -l <id> file.png`.
5. Video: `ffmpeg -f avfoundation -framerate 30 -capture_cursor 1 -capture_mouse_clicks 1 -i "<schermo>:none"`
   (indice da `-list_devices true`), stop con `q` su stdin. Montaggio: `crop` sulla
   finestra, scala a 1440 px, tagli con `trim`/`concat`, `setpts=PTS/1.4`,
   `libx264 -crf 24 -movflags +faststart`.
