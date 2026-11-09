; "Apri con… Studio" su Windows (EXT-001, EXT-012).
;
; Non si usa `bundle.fileAssociations`: il template NSIS di Tauri scrive il
; valore predefinito di `HKCU\Software\Classes\.<ext>` e rende Studio il
; programma predefinito per le estensioni senza una scelta dell'utente.
; Qui Studio si aggiunge solo all'elenco "Apri con" (OpenWithProgids e
; SupportedTypes), lasciando invariato il programma predefinito.
;
; Elenco estensioni: tenerlo allineato con `tauri.macos.conf.json` e
; `tauri.linux.conf.json`.

!define STUDIO_PROGID "OMPStudio.File"

!macro STUDIO_FOR_EACH_EXT MACRO
  !insertmacro ${MACRO} "txt"
  !insertmacro ${MACRO} "md"
  !insertmacro ${MACRO} "markdown"
  !insertmacro ${MACRO} "mmd"
  !insertmacro ${MACRO} "json"
  !insertmacro ${MACRO} "jsonc"
  !insertmacro ${MACRO} "yaml"
  !insertmacro ${MACRO} "yml"
  !insertmacro ${MACRO} "toml"
  !insertmacro ${MACRO} "ini"
  !insertmacro ${MACRO} "xml"
  !insertmacro ${MACRO} "csv"
  !insertmacro ${MACRO} "log"
  !insertmacro ${MACRO} "html"
  !insertmacro ${MACRO} "htm"
  !insertmacro ${MACRO} "css"
  !insertmacro ${MACRO} "svg"
  !insertmacro ${MACRO} "env"
  !insertmacro ${MACRO} "ts"
  !insertmacro ${MACRO} "tsx"
  !insertmacro ${MACRO} "js"
  !insertmacro ${MACRO} "jsx"
  !insertmacro ${MACRO} "mjs"
  !insertmacro ${MACRO} "cjs"
  !insertmacro ${MACRO} "svelte"
  !insertmacro ${MACRO} "vue"
  !insertmacro ${MACRO} "py"
  !insertmacro ${MACRO} "rs"
  !insertmacro ${MACRO} "vb"
  !insertmacro ${MACRO} "cs"
  !insertmacro ${MACRO} "sql"
  !insertmacro ${MACRO} "sh"
  !insertmacro ${MACRO} "bat"
  !insertmacro ${MACRO} "cmd"
  !insertmacro ${MACRO} "ps1"
  !insertmacro ${MACRO} "go"
  !insertmacro ${MACRO} "java"
  !insertmacro ${MACRO} "kt"
  !insertmacro ${MACRO} "c"
  !insertmacro ${MACRO} "h"
  !insertmacro ${MACRO} "cpp"
  !insertmacro ${MACRO} "hpp"
  !insertmacro ${MACRO} "rb"
  !insertmacro ${MACRO} "php"
  !insertmacro ${MACRO} "lua"
!macroend

!macro STUDIO_REGISTER_EXT EXT
  WriteRegStr SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "${STUDIO_PROGID}" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".${EXT}" ""
!macroend

!macro STUDIO_UNREGISTER_EXT EXT
  DeleteRegValue SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "${STUDIO_PROGID}"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\${STUDIO_PROGID}" "" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Classes\${STUDIO_PROGID}\DefaultIcon" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
  WriteRegStr SHCTX "Software\Classes\${STUDIO_PROGID}\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe" "FriendlyAppName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  !insertmacro STUDIO_FOR_EACH_EXT STUDIO_REGISTER_EXT
  ; SHCNE_ASSOCCHANGED, SHCNF_FLUSH: Esplora risorse rilegge le associazioni.
  System::Call "shell32::SHChangeNotify(i 0x08000000, i 0x1000, i 0, i 0)"
!macroend

; Anche durante un aggiornamento: il POSTINSTALL della nuova versione,
; che viene dopo, riscrive tutto.
!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro STUDIO_FOR_EACH_EXT STUDIO_UNREGISTER_EXT
  DeleteRegKey SHCTX "Software\Classes\${STUDIO_PROGID}"
  DeleteRegKey SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe"
  System::Call "shell32::SHChangeNotify(i 0x08000000, i 0x1000, i 0, i 0)"
!macroend
