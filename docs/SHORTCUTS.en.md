# Keyboard Shortcuts

*Italiano: [SHORTCUTS.md](SHORTCUTS.md) · English: this file*

OMP Studio passes standard keys and conventional shortcuts (including those with `Ctrl` and `Alt`) directly through to the PTY terminal, except when focus is inside the Monaco editor. In that case, file management shortcuts operate only on the active file without intercepting terminal input.

Global shortcuts captured by the application live behind the **`Ctrl+Alt`** modifier and the **`Alt+H` / `Alt+K` / `F1`** help cheat sheet, avoiding conflicts with primary `omp` key combinations.

| Shortcut | Context | Action |
|---|---|---|
| `Alt+H` / `Alt+K` / `F1` | Global | Opens the keyboard shortcuts cheat sheet with 2-column layout and search filter |
| `Ctrl+Alt+N` | Global | New project (opens folder picker) |
| `Ctrl+Alt+S` | Global | Open a Scratchpad chat (temporary, `--no-session`) |
| `Ctrl+Alt+U` | Global | Toggle quota & token usage panel |
| `Ctrl+Alt+,` | Global | Open Studio Settings (General, Project Bar, Editor & Terminal, Tasks & Agents, Models) |
| `Ctrl+Alt+M` | Global | Open Settings directly to the Models section (Roles, Catalog, Providers) |
| `Ctrl+Alt+T` | Global | Toggle multi-project pending task queue drawer |
| `Ctrl+Alt+A` | Global | Switch between TERMINAL and GUI surfaces preserving the session |
| `Ctrl+Alt+B` | Global | Toggle left sidebar (Files, Git, Agent) |
| `Ctrl+Alt+L` | Global | Cycle window layout mode (`Auto` → `Horizontal` → `Vertical`) |
| `Ctrl+Alt+Arrow Right` | Global | Switch to next open project, in project bar order |
| `Ctrl+Alt+Arrow Left` | Global | Switch to previous open project, in project bar order |
| `Ctrl+Alt+Shift+Arrow` | Global | Move active project tile left or right (manual reordering) |
| `Ctrl+P` | GUI Surface | Sequentially cycle through configured roles (`default` → `plan` → `smol`...) |
| `Alt+R` | GUI Surface | Open quick role selector with filter and navigation |
| `Alt+P` | GUI Surface | Open model catalog with quick filter and keyboard navigation |
| `Alt+M` | GUI Surface | Open thinking (reasoning) level selector menu |
| `Alt+T` | GUI Surface | Directly cycle thinking level (`off` → `max`) |
| `Alt+C` | GUI Surface | Stop response in progress or clear typed text |
| `Ctrl+C` | GUI Surface | Interrupt streaming response (when no text is selected) |
| `Alt+E` | GUI Surface | Focus Composer input field |
| `Alt+N` | GUI Surface | Open new chat in active project |
| `/` | GUI Composer | Open available slash command palette |
| `Alt+1` … `Alt+6` | GUI Composer | Pre-fill composer with suggestion at that position (does not send) |
| `Enter` | GUI Composer | Send with default mode; when palette is open, selects highlighted command |
| `Alt+Enter` | GUI Composer | Send with alternate queueing mode (opposite of default) |
| `Shift+Enter` / `Ctrl+Enter` | GUI Composer | Insert new line |
| `Esc` | GUI Composer | Close palette/menu/help modal |
| `Ctrl+0` | Focused Diagram | Fit diagram to window |
| `Ctrl+S` | Editor | Save current file and notify |
| `Ctrl+W` | Editor | Close current file |
| `Ctrl+F4` | Editor | Close current file |
| `Right Click` / `Menu` / `Shift+F10` | Project Tile | Open project panel and pin it (replaces default WebView context menu) |
| `Right Click` / `Menu` / `Shift+F10` | Text Fields / Inputs | Open edit context menu (Undo, Redo, Cut, Copy, Paste, Select All) |
| `Right Click` / `Menu` / `Shift+F10` | Code Editor | Open Monaco context menu (Undo, Redo, Cut, Copy, Paste, Select All, Save, Diff) |
| `Right Click` / `Menu` / `Shift+F10` | Open Tabs | Open tab context menu (Save, Diff, Copy Path, Reveal in File Explorer/Finder, Close, Close Others) |
| `Right Click` / `Menu` / `Shift+F10` | File Tree (File/Folder/Root) | Open file or folder context menu (New File/Folder, Refresh, Open in Terminal, Reveal in File Manager, Rename, Move to Trash) |
| `Right Click` / `Menu` / `Shift+F10` | PTY Terminal | Open terminal context menu (Copy, Paste, Select All, Clear Buffer) |
| `Arrow Down` / `Arrow Up` / `Home` / `End` | Open Context Menu | Cycle through context menu items |
| `Enter` / `Space` | Open Context Menu | Execute selected menu item |
| `Esc` | Popover / Dialog | Dismiss open modal dialog |

*Note: inside the terminal, `Ctrl+S`, `Ctrl+W`, and `Ctrl+F4` do not handle editor files: they are passed through to the agent if supported, or remain subject to native terminal behavior.*

*Note on prompt suggestions: `Alt+1` … `Alt+6` numbering is positional: fixed suggestions occupy the first slots, model-generated suggestions are appended, and on-screen chips never shift numbers when new dynamic suggestions arrive.*
