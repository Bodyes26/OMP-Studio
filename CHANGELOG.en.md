# Changelog

*Italiano: [CHANGELOG.md](CHANGELOG.md) · English: this file*

All notable changes to omp-studio-app.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

The `[Unreleased]` section tracks completed work not yet released:
it is closed into a version with `npm run release -- <version>`.

## [Unreleased]

### Added

- Bilingual Italian/English interface with a selector in "Settings → General": the language follows the operating system by default and can be pinned to Italian or English. Switching is immediate and never reloads the window, so agent sessions, terminals, and live previews stay alive while the text rewrites itself. Dates, times, numbers, and amounts follow the user's region, and the user documentation (README, shortcuts, changelog) is available in both languages.
- Automatic detection of input waiting and post-turn quick replies via Companion and OS notifications: extended turn analysis using the lightweight `smol` model to detect when the agent finishes by asking questions, seeking plan confirmations, or requesting decisions without formally invoking the `ask` tool; the project immediately transitions to the attention state "Needs response", highlighted in the project bar and surfacing an interactive card at the top of the Companion with the extracted question and clickable options, routed directly as a new prompt to the chat; when the app is in the background, an OS desktop notification triggers immediately with the question text so users can reply within 5 minutes, preserving the Anthropic cache hit.
- Safety confirmation modal when closing a project, protecting running and queued tasks: closing a single project warns about queued tasks or an active run and lets you keep or discard the queue; closing during active processing aborts the run and moves the task prompt and settings to the top of `.omp/tasks.json`, intact on reopening. Quitting the application asks nothing instead: queues stay with their projects, any interrupted task returns to the top of its queue, and the window closes right away.
- React 19 + Tailwind v4 frontend prototype lab: dedicated GUI space in Studio's central column to design, compare 3-5 component variants, and iterate multi-screen flows with mock data in an isolated and secure sandbox, running concurrently with the main agent in the same project.
- Interactive preview with element selection and revision-bound annotations: responsive toolbar with Desktop (1280x800), Tablet (768x1024), and Mobile (375x667) presets, zoom, refresh, and on-screen visual inspection mode featuring automatic redaction of passwords and Bearer tokens, alongside preventive blocking of annotations sent on inactive revisions.
- Offline compilation and execution without external CDNs: local `esbuild-wasm` compiler with closed VFS resolver, isolated worker thread, and pinned dependency catalog (React 19.2.8, Tailwind v4.3.3, Lucide, Radix Dialog, Recharts, Motion) with trusted local precompiled bundles for instant startup without an internet connection.
- Managed Chromium renderer with active network policy and crash-recovery watchdog: dedicated Chrome for Testing process with an ephemeral profile free of personal data, virtual origin `http://lab.virtual` without native Tauri bridge, CDP interception in the controller blocking `location.href` navigations and unauthorized external requests via `BlockedByClient`, and watchdog with instant termination of infinite loops in under 2 ms and target recycling.
- Confined write broker on real paths and deny-by-default tool allowlist as a standalone OMP extension: blocks shells (`bash`), runtimes (`eval`), generic file writes, host browser, debugger, and MCP; enforces canonical path validation preventing `..` traversal, absolute paths, cross-prototype boundaries, and symlink/junction traversal; preserves delegation to author subagents who inherit the same constraints.
- Local revisions per change request with atomic file state, outcome, and explicit status (`rendering-ready`, `verified`, `interrupted`): non-destructive rollback to a previous revision without rewriting history and prototype duplication with recorded provenance (history and contents remain outside Git within Studio's local store).
- Stable project context acquisition with targeted selection: reads the effective working tree including uncommitted user changes, SHA-256 cryptographic digests, and provenance; strictly excludes credentials and secret files; multi-pass consistency verification against concurrent writes by the main agent; frozen read for context tools and drift detection with refresh only upon explicit user request without regenerating the prototype.
- Standalone export and adaptive handoff to main agent: exports any revision as a standard independent React project with Vite + Tailwind v4 build, and provides a structured delivery package for adaptation by the main agent to the project's actual stack (including Svelte 5) without forced auto-merges.
- Backward compatibility and reversible `.gitignore` migration: legacy HTML prototypes generated by `studio_preview` (`proto/*.html`) remain readable and viewable, while the automated `.gitignore` rule is updated to `proto/*.html` to enable Git tracking of new prototypes under `proto/<id>/` without altering user-defined rules.
- Companion composer with `!` suggestions for all configured roles and most frequently used models across projects, selectable via keyboard, alongside image attachments via file picker, paste, or drag-and-drop with preview and removal prior to saving.
- Out-of-quota stop detection and assisted recovery across GUI, TUI, and Companion: detects in real time when an agent halts due to exhausted quota, credits, or provider spending limits without configured fallbacks, establishing a persistent attention state; offers a one-click switch to the next healthy role and relaunches the failed turn via `/retry` while preserving context and avoiding non-idempotent re-execution of already applied tools; extended to the Companion with a priority card and automatic one-click terminal-to-GUI switching; introduces a non-blocking "no reserves" preventive warning in the composer for models lacking fallback chains.

### Changed

- Smooth animation for opening and closing the sidebar: sidebar appearance and dismissal triggered by the Pi icon in the top left (and the `Ctrl+Alt+B` shortcut) is now animated with a smooth grid layout transition, fade, and content slide without stutter or reflow recalculations, featuring tactile feedback when pressing the icon and automatic respect for reduced motion preferences.
- Inline token rendering and removal of duplicate text in Companion: recognized tokens (`@project`, `/directive`, `!role`, or `!model`) are rendered directly as colored semantic pills (blue for projects, green for directives, purple for roles and models) inside the writing area, maintaining perfect cursor alignment and smooth text editing; eliminates duplicate prompt and tag displays beneath the field, reserving the bottom area solely for genuine warnings or ambiguities.
- Always-visible task configuration options integrated into layout: removed the collapsible accordion and card container in TaskEditor in favor of a natural flow directly beneath the prompt text area, featuring dedicated sections for profile/role, specific model, thinking effort level, and a directive grid with active counts.
- Companion task input transformed into a chat composer: a single rounded surface that expands with text (one line when empty, up to eight), Enter to save and Shift+Enter for a new line, clickable `@project`, `/directive`, and `!role` pills in place of help text, and a round submit button that spins while saving. The interpretation preview is now a strip beneath the field rather than a card containing a box, and an unrecognized project is flagged as a warning rather than an error.
- More forgiving model search: hyphens, dots, slashes, and spaces are ignored and terms can be entered in any order, so "gpt 5.6", "gpt 56", or "gpt sol" all find `codex-openai/gpt-5.6-sol`. Applies to the composer model menu, model picker, Settings Catalog tab, and Companion `!` suggestions.
- Agent system messages are no longer walls of text with raw XML. Background subagent results become a compact row displaying status, role, duration, response size, and summary, with a click opening the full transcript in the drawer; messages exchanged between agents display sender, formatted body, and what they reply to, omitting service text intended for the model; reminders and internal instructions that `omp` writes for the agent rather than the user remain hidden, and the new "Show agent internal messages" toggle under Settings → General displays them as compact rows when needed to understand what guides the agent. Three or more consecutive system notices collapse into a single expandable row. Unresolved todo reminders are no longer printed in chat; the todo strip instead shows a reminder counter (`1/3`), turning amber on the final attempt when the agent stalls. The same treatment applies inside the subagent transcript drawer.

### Fixed

- Removed accidental agent interruption with the Esc key: pressing Esc inside a project now closes only modals, menus, or palettes and no longer interrupts running execution, which can only be stopped via the dedicated stop button.
- Custom answer and "Other" option in Companion: clicking "Other (type your own)" in the Companion quick reply card immediately opens the input field for entering a custom reply using the Enter shortcut, no longer sending the literal string to the process and preventing unformatted CLI terminal dumps (with `▮` characters and duplicate prompts) from appearing as question detail text; cleaned CLI artifacts from detail messages and added the "Recommended" label to suggested options.
- Background agents failing due to quota exhaustion or provider errors are no longer masked as "Completed": project state correctly preserves the attention condition, preventing the green checkmark icon from misleading the user.
- Closing projects and scratchpads from project popover works again: command is dispatched before the panel unmounts, preserving confirmation dialogs for projects with queued or running tasks.
- Project popover styling and badge: replaced legacy fixed-size square box with a proportional geometric chip matching the queue drawer; custom abbreviations (such as "OMP-S") no longer wrap or overflow, and headers align with consistent spacing and heights across name and path.
- Queue popover styling and project badge: replaced legacy fixed-size circular dot with a proportional geometric chip neatly accommodating any project abbreviation (including custom tags like "OMP-S") without line breaks or overflow; reorganized group headers with clean column alignment between project name and run status, eliminating misaligned fixed indentation.
- Tool call grouping and model footer deduplication in GUI chat: narrative or explanatory commentary emitted before and between tool calls (typical of models such as Muse Spark or contributor models that do not use a dedicated thinking channel) is now bundled into the compact `ToolGroup` execution rather than breaking tools into isolated individual cards; inside the expanded group, text steps render with clean formatting and the model badge with cost is deduplicated, appearing only at the bottom of the assistant's final response.
- Companion once again displays the agent's question and allows answering: previously, a project requesting a reply displayed only the "Needs response" status without the question, because the request was discarded whenever the agent did not attach a detail message (which was almost always the case). The card now displays the question, its sequence position (`1/2`), descriptions for each option, recent chat messages with a button to view more, and a text field for freeform replies. System notifications and the project popover also display the question text instead of remaining blank.
- Fast task input in Companion interprets project, directives, and role locally while typing and invokes the `smol` model only upon saving when needed, avoiding continuous background processes and the Windows error 206 caused by excessively long command arguments.
- Companion monitor now displays the actual status of each project and, exclusively for agents actively working or awaiting replies, shows the model and account quota currently in use.
- Toolcall deltas during streaming are no longer mistaken for thinking blocks, eliminating spurious "Thinking · 1 line" boxes between responses and tools.
- Companion colors restored: pills, warnings, confirmations, and accent borders previously used color names absent from the theme and were discarded by the browser, rendering inherited color text over transparent backgrounds (missing projects appeared as bare red text and warnings as blue text without borders).
- Companion `@project` and `/directive` suggester is no longer clipped: opens below the input field in the top window layer, whereas previously it opened upwards and was cut off by the screen boundary or scroll container.
- Colored project dot in Companion now matches project bar tint in main window: theme tint was previously parsed as HSL degrees, causing each project to render in an unexpected hue.
- Focus is no longer stolen while typing a prompt: agent questions arriving from background projects no longer steal focus from the composer or TaskEditor, global type-to-focus no longer hijacks keystrokes from controls on other surfaces, live browser viewport reclaims focus only when lost following remounting, and Esc/Ctrl+Enter pressed outside TaskEditor no longer dismisses it.
- Fixed false modified state when opening documents in editor: Monaco now preserves the UTF-8 BOM (`﻿`) and aligns initial baseline on load, preventing unjustified dirty indicators and "Save" button visibility on freshly opened files from the filetree or GUI links.
- Companion window remembers its configured size: previously widened upon every reopen. Dimensions were saved only upon pinning (including invisible resize borders that accumulated with each cycle), while pinning via the top bar button in the main window completely cleared saved dimensions back to 560x520. Window position and size now persist when closing the window and quitting the app, persisting upon reopen in both Spotlight and pinned modes.

## [1.5.0] - 2026-09-08

### Added

- Customizable layout supporting vertical (portrait) displays and sidebar collapsing: automatic or manual switching between a 3-column horizontal view and a vertical view with editor on top and terminal/chat on the bottom separated by a horizontal splitter; `Ctrl+Alt+L` shortcut and status chip in the top bar to cycle modes; and the ability to hide or show the sidebar (File/Git/Agent) via `Ctrl+Alt+B` or by clicking the &pi; logo in the top left to dedicate full width to the editor and conversation.
- Two styles for the quota popover, selectable under "Settings → Appearance" alongside chip styling: "Telemetry", featuring a thin bar, hatched consumed area, and `OK / WARN / CRIT` status readouts for each window; and "Ring", with a circular meter per window that drains and displays a status pill as quota drops. Both cards render a live preview that updates with your choice, applying to both the main window and the Companion.
- Separately toggleable traffic light colors for the quota popover: chips and popovers now feature independent toggles, allowing the top bar to follow theme colors while displaying green/amber/red in limit details (or vice versa).
- Model check under "Settings → Models" now verifies each role's fallbacks in addition to primary models, and goes beyond seeking newer versions: flags models that can no longer be used—withdrawn from provider catalogs, no longer offered under active credentials, belonging to disabled providers, or lacking credentials—preventing quota exhaustion from leading to unexplained failures on missing fallbacks. The diagnostic report suggests replacement with available equivalent models or removal of obsolete fallbacks, never altering configuration without confirmation.
- Background model check: runs on Studio startup and repeats every 12 hours, refreshing provider catalogs only when older than one day. Warnings do not interrupt workflow: the "Settings" chip displays an orange exclamation mark when a configured model is unusable and a blue dot when only version updates are available; clicking opens the Models section directly, highlighting each affected role and fallback with the reason.
- Companion window featuring dual Spotlight and persistent Widget modes (`Alt+Space`), Quick Reply with chat context for agent inquiries, and natural language quick task entry: answer background agent questions and capture tasks for any project without interrupting reading or navigation in other applications; includes AI text parsing (automatic extraction of project, role, model, and directives), preventive quota exhaustion checks with explicit alerts, multi-monitor memory for pinned window position and size, dedicated Companion button in Studio's top bar, and quick interactive popovers on flagged project cards without switching workspaces or active views.
- Comprehensive hardening, automatic recovery, and accessibility for Browser Studio: automatic live stream reconnection with bounded backoff and instant retry button on disconnections; clean, deterministic teardown of all browser channels on chat termination or failure to eliminate orphan processes or files; keyboard isolation to the active surface supporting navigation (back, forward, reload with standard shortcuts); complete focus trap handling Escape on in-page dialogs and the Chrome Relay tab picker; and strict memory and queue message limits ensuring smooth, stable multi-project sessions.
- Explicit connection of a single personal Chrome tab to Browser Studio via the existing OMP Relay: picker displays only title, origin, and state necessary for selection; single-use grant binds project, chat, and target; screencast, input, and inspector reuse the same `BrowserViewer`, control epochs, and private takeover; revocation instantly halts frames and controls without closing Chrome or dropping login and SSO sessions; missing Relay capabilities yield targeted diagnostics limited to the granted tab.
- Explicit handling of dialogs, popups, files, permissions, and video recording for Browser Studio: alerts, confirms, prompts, and beforeunload dialogs triggered by pages display in a dedicated modal within `BrowserViewer` without blocking the runtime supervisor (immediate, safe interruption of agent actions in the absence of automated policy and tracked responses); new windows and popups opened by the page are automatically adopted as tabs within the same chat; downloads from remote origins are held in secure project quarantine and converted to conversation artifacts only upon explicit user consent; file uploads (`<input type="file">`) are restricted to opening the native OS file picker, preventing unmonitored or broad filesystem access by the agent (`UPLOAD_NOT_AUTHORIZED`); four distinct origin-level capabilities (clipboard read/write, geolocation, notifications) configurable directly from the toolbar; local tab video recording into standard MJPEG/AVI containers via a pure deterministic generator requiring no external `ffmpeg`, with coordinated save and purge paths.
- Targeted inspector for Browser Studio: integrated directly into the `BrowserViewer` surface without embedding the full Chrome DevTools; features Element Picker with non-invasive highlight overlay and semantic tooltip on native viewport CSS coordinates extracting tag, ARIA role, accessible name, text, unique CSS selector, bounding box, relevant computed styles, React/Svelte component, and cropped PNG screenshot; Console (500 items with consecutive message deduplication and stack traces), Network (200 items with in-place updates, advanced filtering, and on-demand response body download), and Actions timeline (100 items) panels managed via bounded ring buffers with automatic redaction of URL credentials, sensitive headers, and Bearer tokens; collapsible bottom dock with keyboard navigation shielded from leaking input to the browser and buttons to selectively insert structured context and cropped screenshots directly into the Composer prompt.
- Top-level origin policy, persistent per-project consent, and security redaction for Browser Studio: automatic navigation for local and loopback origins (localhost, 127.0.0.1, [::1]); explicit upfront consent for new remote origins via banner and status badge in BrowserViewer; persistent per-project storage with instant revocation from settings or toolbar; automatic suspension of agent actions upon top-level redirects to unauthorized origins; strict separation between document navigations and secondary resource loading (images, scripts, CDNs, APIs); automatic redaction of URL credentials, Authorization headers, cookies, and tokens across logs, events, and artifacts; and complete isolation of the Svelte frontend from raw CDP endpoints and internal secrets.
- Exclusive page control arbitration and private takeover for Browser Studio: rigorous management of alternating control between agent and user via monotonically increasing control epochs; atomic takeover on first human click or keystroke with buffered, single-dispatch interaction forwarding to Chromium; instant cancellation with structured CONTROL_INTERRUPTED error for any running agent operation alongside blocking of new commands; dedicated toolbar button to explicitly return control to the agent with a fresh page snapshot; and private takeover mode (activated manually or automatically on password/CAPTCHA fields) that continues streaming video to the user in the local viewer while completely blanking and sanitizing transcripts, screenshots, DOM, console, and network for the agent.
- New Browser surface in central column (`BrowserViewer`) for Browser Studio: opens automatically upon launching the `browser` tool or opening a managed tab, preserving Monaco editor state, open files, and static previews; includes toolbar with URL, navigation (back, forward, reload), tab selector, operating mode, responsive viewport selector (Desktop, Tablet 768px, Mobile 390px), controller status badge (Agent, User, Private), and instant screenshot capture to clipboard; renders live JPEG video stream as frames arrive using a latest-frame-wins policy and exact geometric coordinate mapping for cursor and scroll in native Chromium viewport CSS pixels invariant to window resizing, zoom, and DPI scaling.
- New contextual quota chip for the active project in the top bar with selectable styles ("Progressive ring" and "Filled pill"), option to always display percentage or only during alerts, toggle for provider name, and reorganized "Settings → Appearance" section with automatic theme gallery synchronization.
- Studio and the `omp` runtime now negotiate a versioned `browser-live-v1` capability upon session startup: serving as the foundation for the upcoming Browser Studio. Until the runtime exposes the live channel, nothing changes visually—the `browser` tool continues displaying summaries and screenshots as before—and Studio attempts no connection when the capability is absent from the runtime.
- The `omp` runtime now includes a browser session broker (`BrowserSessionBroker`) and a headless managed Chromium engine: isolates cookies and storage per project in dedicated directories, addresses tabs via identifiers tied to the specific chat session (preventing tab collisions across concurrent conversations), routes all CDP control through the broker, and cleanly terminates processes without leaving orphans.
- Binary loopback live channel and backpressure for Browser Studio: high-frequency video streams bypass the RPC channel via a compact fixed-length binary framing protocol (BLF1), featuring strictly bounded memory management and deterministic frame dropping for slow clients, instant reconnection without state loss, and direct screenshot capture at native viewport dimensions.
- Optional traffic light colors for quota under "Settings → Appearance": green when quota is plentiful, yellow below 30%, red below 10% or when exhausted, with dedicated palettes for light and dark themes. Disabled by default; when off, the chip continues following theme colors.
- Quota chip indicates via a small dot when a longer window (such as weekly) is nearly exhausted while the session window remains open, without altering the displayed percentage.
- More legible queued task rows with two selectable views under "Settings → Appearance": "Compact" (default) featuring full-width title and summary across three tiers with all badges beneath text and a two-line summary; and "Card" presenting each task as a separate card with a two-line title and three-line summary. Applies to both the Queue tab and global drawer.

### Changed

- Moved window layout configuration from "Settings → General" to "Settings → Appearance" with a new visual tabbed selector (Automatic, 3-Column Horizontal, Stacked Vertical) featuring integrated graphical previews, and removed layout chip from the top bar to streamline the application header (the `Ctrl+Alt+L` shortcut remains active for quick toggling).

### Fixed

- Studio no longer crashes abruptly due to web page content: dialogs, console messages, or download filenames containing specific non-Latin uppercase letters previously caused the application to crash during sensitive data masking, resulting in loss of unsaved work.
- Sensitive data masking in browser logs now covers all authorization tokens in a message (previously only the first was redacted while subsequent tokens appeared in plaintext in transcripts and artifacts) and also applies to the origin of permissions requested by pages.
- Browser Studio remote origin consent takes effect: "Allow for this project", "Deny", and "Revoke" are now propagated to the `omp` runtime, which enforces the agent's origin allowlist. Previously these were purely local Studio writes, meaning consent failed to unblock navigation, revocation failed to stop the agent, and badges reported states that were not actually enforced. When running against an `omp` runtime that does not yet recognize the request, decisions are no longer treated as applied; Studio explicitly warns and prompts to update the runtime.
- Keyboard no longer becomes unresponsive after page state changes: live surface is no longer unmounted on tab reconnections or reloads (stream status is now an overlay atop the last frame), focus returns to the surface upon reappearance, and key release events are reliably forwarded, preventing pages from getting stuck with pressed keys or modifiers.
- Tab updates (navigation, loading, taking control) no longer re-establish the live channel from scratch: previously each event consumed a single-use ticket, opened a new session counting toward the limit of 32, and reset the reconnect retry counter, leaving two open sessions instead of one upon opening the panel.
- Single-action rejections (already handled dialog, disallowed download, inactive recording) no longer tear down the entire stream forcing a full reconnection: only ticket, session, or stream errors close the channel.
- Private takeover no longer leaks page data: inspected element crop is neither produced nor attached to the prompt, inspection is disabled, and collected data is discarded as soon as private mode activates.
- Page dialogs no longer remain covering the panel after chat ends or tabs close, users can no longer double-reply to the same dialog (including holding down Escape), and commands sent while the channel is down now provide explicit feedback rather than failing silently.
- Merely hovering over the page no longer interrupts agent commands: control yields to the user only upon deliberate gestures (clicks, keystrokes, scroll wheel).
- Permissions menu no longer displays "Deny" as active for unconfigured permissions: without a page response, status displays as "Ask" per protocol specification.
- Companion window reliably reopens when clicking the top bar chip and via keyboard shortcut: resolved native webview creation failures on Windows caused by misaligned browser parameters between windows, guaranteeing visual and focus restoration on every invocation.
- Accurate active account detection for the quota chip: when conversations use specific provider credentials (e.g., a secondary account with different limits), the chip retrieves the exact pin from transcripts in both graphical chat and terminal without falling back to empty caches or losing associations when generation ends or recent sessions expire.
- Quota popover bars update consistently after initial opening: animation previously triggered only once on mount, so refreshing usage while the popover was open updated text percentages but left bars static. Bars and rings now track values with consistent animations both on appearance and subsequent updates.
- Remaining quotas are now announced to screen readers as level meters (with percentage and reset time) rather than progress bars, which previously suggested non-existent file downloads or operations.
- Attention ring on project cards and "Waiting" entry in the status bar now reliably trigger on agent questions: if inquiries arrived before the `ask` tool event—which occurs intermittently—status previously reverted to "Running", leaving cards without rings and resetting app icon badges despite having dispatched system notifications.
- Studio no longer hangs on startup with loading spinners across all panels: Companion window synchronization previously rewrote attention requests on every pass even when unchanged, and because that write occurred within the effect observing the list, it triggered recursive rerenders halting UI drawing. Writes now execute only when state genuinely changes.
- Fixed abnormal icon animation on "Verify Models" button under "Settings → Models": checking models now replaces the magnifying glass with a dedicated circular loading indicator, preventing improper rotation of static icons.
- Corrected keyboard focus ring clipping across the application: theme picker cards, window titlebar buttons, open tabs, session history rows, and context menus now utilize inset rings or dedicated margins to ensure focus indicators are never clipped by scroll containers, and restored visual keyboard focus indicators on toggle switches and model dropdowns.
- Accurate provider names in agent/model selector menu: models served through gateways with identifiers like `provider/model` are no longer conflated with native providers, correctly attributing providers in roles, fallbacks, and quick cycle drawers.
- File paths output by the assistant in fenced code blocks now render as compact clickable chips opening directly in the editor (supporting multi-line lists with dedicated copy buttons), resolving complex paths and line numbers via `resolve_project_file`.
- Intelligent version detection for model families (e.g., upgrading Gemini 3.7 Flash to Gemini 3.8 Flash): update checks now automatically refresh catalogs, respect active roles in the settings modal before saving, normalize numbering and preview formats, and ensure snapshot dates do not override semantic versions.
- Removed unwanted outline rings on file tree rows and root folder upon launching the application, aligning keyboard focus styles with background highlights.
- Quota chip percentage now matches current operational window: with Anthropic 5-hour windows intact at 100%, the bar previously showed two-thirds due to reporting the 7-day window. Bars and percentages now track the shortest limiting window; if any window is exhausted, the chip indicates exhaustion as requests will be rejected.
- Quota chip and popover bars now fill in consistent directions: previously the chip showed available quota while the popover showed consumed quota. Both now fill based on remaining quota and drain as it is consumed.
- When using multiple accounts for the same provider, displayed quota could belong to an account other than the one actively in use, and the "In use by" label appeared across all provider accounts. Studio now accurately identifies the account active in the session.
- For providers grouping multiple model families (such as Google Antigravity, which tracks separate counters for Gemini, Claude, and GPT), the chip now displays the counter for the active model family rather than the lowest across all families.
- Chip no longer reports "Quota exhausted" when an inactive account has an exhausted window while another account under the same provider retains available quota.

## [1.4.0] - 2026-09-02

### Added

- Instant queue mode selection when sending: while the agent is streaming, the submit button splits (split button) to send using default behavior or open a dropdown to force Steer or Follow-up mode, with `Enter` (default mode) and `Alt+Enter` (opposite mode) keyboard shortcuts.
- New queue preferences under "Settings → General" to select default submission behavior (Steer or Follow-up), message extraction modes (single or all at once), and interruption mode.
- "New chat" button in the right column header, with `Alt+N` shortcut.
- Quota popover can also display providers that `omp` cannot query on its own (e.g. those added via a plugin): describe the source in a JSON file under `%LOCALAPPDATA%/omp-studio/usage-sources/` specifying the command to run, and its quotas will appear alongside the others. Without that directory, behavior remains unchanged.

### Changed

- Queued message chips in chat are now read-only informational badges with contextual explanations, clearly indicating that messages already picked up by `omp` cannot be modified or reordered.

### Removed

- Removed queue configuration popover with gear icon from the chat composer and `Alt+Q` / `Alt+S` shortcuts, superseded by general settings and quick submission selection.
- Removed orphan, non-functional `Alt+Q Queue options` shortcut from the empty state of the task column.

### Fixed

- Reliable focus synchronization and direct typing in chat: smooth animated cursor shuts off promptly when the window or application loses focus, preventing false blank blinking; clicking anywhere in the input box area transfers focus to the textarea; typing does not intercept keys when modals or dialogs are open, preserving spacebar usage on interactive elements; and cursor position remains aligned during scrolling.
- Reliable completion of multiple-choice questions with custom option ("Other"): freeform text replies to multiple-choice questions are routed with the correct closing step, preserving the execution of the entire response plan for all wizard questions.
- Coalesced loading of models and providers: background initialization eliminates duplicate concurrent calls to `omp models` on application startup and eliminates reactive reload loops on error.
- Security and resilience of quota sources: strict path confinement with safe fallback for empty environment variables, streaming bounded output buffers for child processes, and defensive validation of numeric values in the quota popover.
- Unified form and unrestricted navigation for multiple agent questions (`ask`): the card receives and displays all questions from the initial prompt through immediate bidirectional enrichment as tool arguments arrive, allowing free navigation back and forth between steps and verifying summaries before final submission, eliminating fragmented cards and lost navigation across previous questions.
- Preservation of notes in multiple choices and strict delivery queue validation: adding notes to multiple-choice answers is correctly routed without generating phantom options for the agent, and queued automated steps are validated by method, option signature, and call ID before delivery to `omp`, halting the sequence with a clear warning on mismatch.
- Model menus display capabilities as icons: context window, eye icon for image support, and extended reasoning symbol appear next to each model, with effort levels in tooltips. Previously the expanded list spelled out "Vision" and "Reasoning" as text only in the task selector and displayed nothing in the chat quick menu.
- Advanced task options remain accessible even with long prompts: as the prompt box grows, the editor body scrolls rather than clipping the accordion, restoring access to all modes.
- Dropdown menus are no longer clipped: model picker, catalog role assignment menu, "Add provider" menu, and chat role, model, thinking, and send mode menus open above other content, flip when space below is insufficient, and scroll internally.
- Role fallbacks, primary model, quick cycle, and suggestion model only suggest models from actively configured and enabled providers, rather than the entire OMP catalog.
- AI suggestions for roles no longer propose models from unconfigured providers: validation evaluates against the genuinely available list, and custom providers defined in `models.json` (including local servers) are now included rather than systematically excluded.
- Panels and lists with bounded height scroll instead of truncating content: role list and role detail, provider list and provider detail, quick cycle drawer, subagent panel and drawer, project selector, and quota popover.

## [1.3.0] - 2026-09-01

### Added

- Full build and distribution support for Linux systems (x86_64): automated packaging for Debian (`.deb`) and universal portable (`.AppImage`) in GitHub Actions Nightly and stable Release channels with candidate promotion without recompilation, local build scripts, and POSIX shell fallback optimization.
- Suggested replies in composer: clickable chips above the input field that prefill the prompt with a click or via Alt+1, Alt+2, Alt+3; sending remains an explicit user action.
- New "Suggestions" settings section to create, edit, reorder, hide, or restore pinned suggestions.
- Suggestions generated by lightweight model at the end of each agent response, reading the latest message and offering up to three ready-to-use replies; disabled by default, with configurable model and limit.
- Fuzzy search in project file tree: search bar always accessible at the top of the FILE panel with instant filtering, matching character highlights in filename and path, rapid keyboard navigation (Arrows, Enter, Esc), and context menus on results.
- Fully customizable task directives and modes: new library under "Settings → Tasks & Agents" to create, edit, reorder, hide, or restore prompt modes (including Plan, Discussion, Minimal, and Research presets), configuring placement before or after main text.
- AI Assistant for directives: guided generation of new modes from natural language descriptions, prompt enhancement and refinement with change previews, and on-demand frequency analysis of recent project prompts to suggest useful new directives.
- Deterministic snapshots and controlled upgrades: each queued task freezes the exact directive version at creation time, with visual warnings and an "Update" button when the library contains a newer version.
- New "Appearance" section in Settings modal with visual grid gallery of all available themes (dark and light), real-time search, graphical preview with color swatches (background, accent, text), and active theme indicator with instant application.
- Advanced provider management and full plugin support: "Settings → Models → Providers" adopts a two-column layout dynamically detecting all built-in, plugin (such as Command Code), and custom providers, displaying enabled state, available model count, and associated accounts.
- Multi-account management with credentials and selective disconnection: transparent display of email, account ID, and organization/plan for each stored credential, with ability to disconnect individual accounts via confirmation dialog without invalidating the entire provider.
- Model catalog based on actually available models: "Catalog" tab organizes models by provider with contextual badges (context window, max output tokens, reasoning with thinking levels and costs), quick filters (Vision, Reasoning, Free), full-text search, and targeted catalog refresh.
- Terminal indicates status while launching: during environment startup, a muted waiting line replaces the black box with context-sensitive text (starting, resuming session, guided setup). Disappears automatically on first output and displays a diagnostic warning if the environment does not respond within ten seconds.
- Togglable file previews: for Markdown and SVG, the editor displays a three-state toggle in the top bar (code only, side-by-side code and preview, preview only) remembering preference per tab. `Ctrl+Shift+V` cycles through the three views.
- Editor tabs can be reordered by dragging, closed with middle-click, scrolled via mouse wheel, and show scroll arrows when open files exceed the tab bar; active tab always remains in view.
- New "Close All" option in tab context menu, with `Ctrl+Shift+W` shortcut.

### Changed

- Usage quota popover: active project indications per provider now display project name directly (e.g. "ContrattiImmobili"), eliminating redundant application prefix ("OMP Studio").
- Disabled automatic expansion of accordions and tool cards on error: steps remain compact and closed accordions display microcopy indicating failed tool and brief reason, reserving full expansion for manual click.
- Optimized build and release times: adopted Thin LTO and parallel code generation in Rust release profile, eliminated redundant chunks in Vite frontend build, and introduced Rust dependency caching (rust-cache) in GitHub Actions workflows, drastically reducing local and CI build times.
- Removed left highlight bar and bold styling on active section in Settings left column for cleaner, more uniform navigation.
- Moved theme selector from top bar (TopBar) to new dedicated Appearance section in Settings, removing badge and floating popover for a cleaner header.
- Radio button controls across the entire application redesigned with custom styling matching active theme (reactive ring and centered inner dot in brand color), refreshing update channel selector (in general settings and bottom bar update dialog, with dedicated tabs and "Recommended"/"Preview" badges) and project bar sorting options.
- Simplified description of "Last opened" sorting option in project bar settings, removing redundant "Historical behavior:" prefix.
- Editor tabs no longer have "Diff" button inside the tab: comparison with HEAD is now a top bar icon active only on foreground file, remaining in tab context menu as "Compare with HEAD". Tab shows filename in italic when unsaved changes exist and swaps dot with close button on hover so tab width never changes; active tab is marked by colored top bar.
- Editor Markdown preview uses same engine as chat: tables, fenced code blocks with syntax highlighting, nested lists, links, and blockquotes render properly where previously ignored.
- Slash commands `/login` and `/logout` support optional provider argument (e.g. `/login anthropic`, `/logout openai-codex`) to open Providers tab directly with target provider preselected.

### Fixed

- Confinement and security of file operations: blocked creation or renaming of paths with Windows drive prefixes (`C:`) or non-normal components outside project root, providing deterministic protection against accidental file loss.
- Resilient file search with Unicode characters: fuzzy matching properly handles variable-length expansion of lowercase characters (e.g. `İ`), eliminating index-out-of-bounds crashes and ensuring exact matching character highlights.
- Keyboard-accessible tree navigation: enabled full file tree exploration via ARIA standards (`role="tree"`, `role="treeitem"`, `aria-expanded`, roving tabindex) with smooth navigation (`Up/Down/Left/Right Arrows`, `Home`, `End`, `Enter`) and clear error display if moving to Trash fails.
- Secure storage of settings and API keys: atomic writes on macOS and Linux preserve restrictive `0600` permissions preventing accidental credential exposure in local filesystem.
- `studio_preview` tool bound to write permissions and anti-traversal: registered with explicit approval (`approval: "write"`), rejection of symlinks on `.gitignore` or `proto/` directory, and instant return of prototype save errors.
- Restored session history scrolling in chat: "Load earlier" button returns to displaying hidden entries in batches of 300 while preserving current scroll position without viewport jumping.
- Unified global shortcut listening: pressing `Alt+H`, `Alt+K`, or `F1` from chat, terminal, or editor opens shortcuts guide in a single keystroke without immediate dismissal from concurrent double toggles.
- Targeted model refresh without truncation: reload command for individual providers preserves models of other active providers, maintaining configured roles and quick cycles.
- Pipeline integrity and signature verification: restored Authenticode signing for Windows binaries and installers, deterministic Node version isolation in quality gate, and flat staging of cross-platform assets to guarantee SHA-256 checksum consistency across Windows, macOS, and Linux.
- Visual consistency of window controls on Linux: top bar disables Windows-style custom controls on Linux distributions, preserving native GTK/system decorations.
- PNG, JPEG, GIF, WebP, BMP, and ICO images visible again in editor: viewer no longer uses Tauri's `asset:` protocol (disabled by default and restricted to fixed paths), reading file bytes directly into a local blob. When reading fails, a descriptive error message appears instead of a blank box without explanation.
- `Ctrl+W` and `Ctrl+F4` close file tabs again: previously worked only with cursor inside text area and stopped functioning entirely after switching between preview and code files. Now valid across entire window except in terminal (where `Ctrl+W` erases word in shell) and text inputs, without closing window when no files are open. `Ctrl+S` received the same fix.
- Studio agent tools restored (`studio_diagram`, `studio_preview`, and `project_tasks`, with `/tasks` command): during terminal startup the extensions previously failed to load with warnings "Failed to load extension … Type.String is not a function" and "Type.Literal is not a function" due to schema builder changes in newer omp versions. Updated tool result formats to avoid "Tool returned an invalid result" rejections.
- Project tab reordering via drag & drop: restored dragging project cards in top bar when sort order is set to "Manual", resolving drag failure and window conflicts on WebView2/Chromium.
- Restored `/compact` and `/handoff` slash commands in GUI chat: resolved command palette freeze upon submit, added visual compaction progress feedback with animated line, immediate transcript and token count updates on completion, and clear warnings when history is too short.
- Compact update dialog for Nightly channel: abbreviated build ID nomenclature and made version display responsive in update modal, eliminating horizontal scrolling.
- Agent questions (`ask`) respond to clicks again: changing options after first choice previously had no effect, leaving checkmark on initial option and sending a different response to the agent.
- Up/Down arrow keys in single-choice questions move response selection, not just focus ring: previously users could scroll to desired option and confirm, while the recommended option was sent to the agent.
- In multi-question sequences, card displays the question the agent is actually asking, with "Question 2 of 3" and `Next` button in place of `Confirm`: previously initial question was repeated and subsequent answers were shifted by one position.
- Multiple-choice answers for a single question are sent in full: previously only first checked option was sent and same question reappeared.
- `Enter` on a multiple-choice question no longer empties card leaving agent waiting.
- Resuming chat from history immediately after launching Studio no longer leaves conversation blank: clicking a session while project process was still starting spawned a second process, attaching chat to wrong session (new, empty session) where messages never appeared despite agent responding with full history. User-selected resume now takes precedence, superseded process terminates rather than lingering in background, and transcript reconstructs on every new attachment.
- In multi-question forms, subsequent questions no longer mark as "ok" before being read: recommended option remains preselected as suggestion, but counts as answer only once question has been viewed. Summary indicates unseen questions and submission remains blocked until all are reviewed, preventing uninspected answers from being sent.
- Already submitted questions in an `ask` sequence remain visible in step bar, marked as "sent" and read-only: previously disappeared entirely, making remaining question numbering confusing.

## [1.2.1] - 2026-08-28

### Added

- Animated loading and smooth session reveal: loading spinners and staggered entry of items in session history, micro-indicators during search, and animated skeleton stream with soft transitions when resuming or opening sessions in GUI chat.
- New "Accessibility" section in Settings with toggle to disable interface animations and transitions, ensuring instant visual response with minimal resource consumption.
- Loading indicators and smooth transitions in Git panel (repository status and recent commits) and Rules tab during friction analysis.
- Smooth animated cursor in GUI chat input box: smooth, responsive travel during typing, navigation, and selection, with gentle resting pulse and respect for system reduced-motion preferences.
- New interactive wizard for agent questions (`ask`): tabbed navigation across multiple questions (`Left/Right Arrow`), optional notes or specifications for any answer (`N`), checkboxes for multiple choice with instant visual state, and final summary screen to review all answers before submission.
- Chat history renderer for `ask` tool displays all posed questions with selected choices, custom answers, and user notes.
- Project panel also opens via **right-click** on card (or `Menu` key): remains pinned until you choose a command, press `Esc`, or click outside. WebView context menu (with items like "Reload" and "Print") no longer appears anywhere in the app except in text inputs, editor, and terminal where needed for copy/paste.
- Uniform themed context menu across entire application: right-clicking in text inputs, code editor, terminal, and file tree opens a menu consistent with active theme, complete with icons, system shortcuts (`Ctrl+Z`, `Ctrl+Y`, `Ctrl+X`, `Ctrl+C`, `Ctrl+V`, `Ctrl+A`, `Ctrl+S`, `Ctrl+W`), and full keyboard navigation (`Up/Down Arrows`, `Home`, `End`, `Enter`, `Esc`).
- File and directory management from file tree: quick inline creation of files and folders, renaming, and moving to Trash with immediate editor tab updates, Git badge sync, and protection against losing unsaved changes.
- Editor tab context menu to save, open diff, copy path, reveal file in system file manager (File Explorer / Finder), close tab, or close others.
- New actions in project panel: copy path, open in terminal, open in external editor, new task, task auto-start toggle, move card, and close other projects.
- Project panel explains in one line what the agent is doing and, when a queued task cannot start, the reason it is blocked.
- New "Chat width" option in general settings: choose between centered layout with balanced margins for readability or full-column layout.
- New **Rules** tab in AGENT panel: lists project context files (`AGENTS.md`, `.omp/rules/*.md`, `CLAUDE.md`, `GEMINI.md`) and available project and global skills with name, `/name` command, and description. Clicking opens file in editor; external skills open in file manager. If project lacks `AGENTS.md`, a button creates a scaffolded file and opens it immediately.
- Rules tab identifies recurring corrections: when local history shows two or more identical requests (running tests, verifying builds, avoiding unrelated files), it suggests corresponding rules for `AGENTS.md` with exact line previews and Apply, Edit, and Ignore buttons. One suggestion at a time, counter on tab, and zero writes without user click.
- Task editor suggests frequently used models in project: "Frequently used" chips remember recent model + reasoning effort pairs, applying them with one click.
- Cost summary appears beneath selected model: remaining provider quota with reset windows and times in tooltip for subscriptions, price per million tokens for pay-per-use, plus an alert if the same model is active in another project.

### Changed

- Keyboard shortcuts summary (`Alt+H`, `Alt+K`, `F1`) is now a global modal available throughout Studio (GUI, Terminal, Editor, Bar), redesigned into two balanced columns with compact height, real-time search, and instant `Esc` dismissal.
- All Studio icons now use a unified design set (Lucide) replacing system emojis: consistent stroke, size, and theme color across Windows and macOS.
- Project color selection uses a color strip rendered in theme colors: each displayed swatch matches the exact card color. Replaced rainbow dot and browser color picker that promised sixteen million colors but preserved only one in forty thousand.
- Multiple-choice selection in `ask` tool replaces technical "Done selecting" text with dedicated "Confirm selection" button, allowing option selection with `Space` and confirmation with `Enter`.
- Default color swatches show actual card color in active theme rather than fixed tints differing from results.
- Project card no longer displays name tooltip: name and path are already visible in panel.
- Project panel uses fixed width: long prompt queued tasks no longer stretch it past screen edges.
- Panel is no longer clipped by project bar, flips upward when bottom space is tight, and stays anchored to card while scrolling project bar.
- Right-click opened panel supports keyboard navigation and restores focus to card upon closing.
- Reasoning effort slider uses a filled pill in theme color: level dots no longer have text labels and magnetically snap during dragging.
- Reasoning slider chip displays only level identifier (minimal, low, medium, high, xhigh, max, auto, off), removing dedicated token counts and numbers.
- New task editor immediately displays model and reasoning effort of default role rather than remaining blank until role adjustment.
- Project bar overhauled: each card shows a dot in project color with abbreviation, and active project expands card to display full name. Color identifies all projects including closed ones, removing solid colored rectangles at top of screen.
- Active project name is no longer written in center of bar: contained within its card, written once.
- Card status indicators updated: pulsing amber ring indicates project **awaiting response**, while active work is indicated by solid dot and highlighted abbreviation with small spinning arc on active card. Previously all working projects animated while the one needing attention remained static.
- Project without active agent dims: neutral dot and muted abbreviation without disappearing from bar.
- Card flashes once in project color on agent status change: noticeable peripheral feedback even while reading terminal.
- Queued task counter embedded in active project card rather than floating badge: maintains four standard styles, with total across projects continuing in "Queue" chip.
- "Agent status dot" setting renamed to "Agent status badge", controlling status rings; "Card label" renamed to "Name on cards", controlling full name visibility on active or all cards.
- Model list in task editor includes only models genuinely usable with configured credentials via direct `omp` query, rather than entire provider catalog.
- Selected model legible at a glance: provider above, model name below, and three capability icons for context window, images, and reasoning replacing text labels.
- Selected model and reasoning effort in tasks are strictly applied to GUI chat session: if requested model is unavailable, task stays queued with error rather than launching silently with a different model.
- Task configuration verified before launch on terminal surface: if `omp` session uses another model, task stays queued explaining alignment needed, as terminal cannot dynamically change session models.

### Fixed

- Guided `omp` installation strictly verifies official SHA-256 cryptographic digest before replacing binary: if check fails or digest is unavailable, existing executable remains untouched.
- Secure atomic saving of models and providers configuration: writes preserve all fields not managed by Studio and prevent file corruption on power loss or I/O failure.
- Native window and top bar optimized for macOS: restored system traffic light buttons adhering to Apple conventions, eliminating duplicate Windows-style controls and ensuring proper drag area.
- Fixed Nerd Font installation on macOS under `~/Library/Fonts`, making it available to external shells without Linux utilities.
- First-run wizard waits for saved projects to load before deciding to open, preventing wizard appearance for users with existing projects.
- Agent questions (`ask`) require explicit choice for each step: eliminated automatic fallback to first option and disabled advancing on empty custom answers.
- Question wizard answers strictly associate with specific active request, preventing accidental leakage of residual answers to subsequent requests.
- Safe launching of external editors and terminals: project paths passed as structured arguments without intermediate command shells, and external links restricted to authorized web protocols (`https:`, `http:`, `mailto:`).
- Support for case-only file and folder renaming (e.g. `appunti.txt` → `Appunti.txt`) on macOS APFS filesystems.
- Atomic protected writes to task queue `.omp/tasks.json`, eliminating data loss risk during concurrent edits.
- Resilient recognition of session-not-found errors from `omp`, restoring chat properly even with heterogeneous text formatting.
- Keyboard accessible navigation with ARIA standards (`role="listbox"`, `role="tablist"`, `role="tree"`) across question wizard, project bar, and file tree.
- Startup time and initial bundle size optimizations: Monaco Editor and Mermaid load on demand only when respective surfaces are rendered.
- Updated frontend security dependencies and cleared vulnerabilities in application runtime.
- Opening theme picker or sort menu in top bar no longer turns Studio window solid gray: backdrop under popovers was a full-window button inheriting system gray background and borders. Fixed same issue for project picker and queue drawer.
- Switching between GUI chat and terminal with zero-message session no longer shows bare shell with "Session not found": session resumed only if disk transcript exists, otherwise surface initializes a fresh session.
- Removed rigid 65-character paragraph limit in chat Markdown that caused premature text wrapping leaving empty space beside tool cards.
- Session history opens instantly instead of taking over a minute: Studio previously read the start of every transcript across projects (hundreds of files, tens of megabytes); now reads only header line and caches it.
- Switching projects no longer briefly flashes previous project history: late-arriving responses discarded and old list clears immediately.
- Resuming session from history in GUI chat works reliably again: chat no longer hangs on "OMP starting..." with empty transcript, reloading actual messages of resumed session. Applied same fix when switching between TERMINAL and GUI.

## [1.2.0] - 2026-08-26

### Added

- Project tasks live in `.omp/tasks.json` within each project: stored alongside code, self-excluded from git, and existing Studio tasks are migrated automatically.
- Studio and terminal share the exact same queue in real time: additions on one side immediately appear on the other without write conflicts.
- New `/tasks` command in terminal: full-screen overlay to browse tasks with arrows, toggle status with `Space`, add with `A`, delete with `D`, reorder with `J`/`K`, and launch with `Enter`.
- Agent manages project queue autonomously via new `project_tasks` tool (list, add, edit, delete, reorder), available in all sessions.
- Tasks feature genuine states—in progress, completed, abandoned—with visual indicators in agent panel and queue drawer.
- New sectioned task editor: prompt at center, role profile selection (`smol`, `default`, `slow`, `plan`, custom), reasoning effort slider, and "Save & close" (`Esc`) / "Save & run now" (`Ctrl+Enter`) buttons.
- Quick task directives: Plan Mode, Discussion & Requirements, Minimal Solution, and Online Research, with optional inclusion of editor context (open files, selection, cursor position).
- Visual attachments in prompts: paste screenshots with `Ctrl+V`, drag and drop files, or choose files via button in both task editor and chat.
- Automatic completion for `/` commands with list of installed skills, distinguishing Studio commands from agent commands.
- Unified cross-project queue view (`Ctrl+Alt+T`, or top bar chip with pending task total): launch prompts for other projects without switching workspaces and view diagnostic reasons when projects are not ready.
- Automated queued task launch, toggleable per project, starting only when agent is genuinely ready.
- Configurable project bar: manual order, last opened, task priority, or alphabetical, with pending task counters in four styles and immediate launch previews on hover.
- Quick role switching in chat (`Ctrl+P` and `Alt+R`) between `default`, `plan`, `smol`, `slow`, `vision`, `task`, `commit`, and `advisor`, with associated model and reasoning level.
- Clickable file paths across entire chat: open files directly in editor from tool chips, markdown links, or code blocks.
- Agent execution sequences grouped into a single collapsible block with timer, keeping final responses front and center.
- All `/` commands and skills work in GUI chat, including session operations (`/login`, `/logout`, `/copy`, `/fork`, `/tree`, `/sessions`, `/drop`).
- Chat displays agent startup state and queues prompts submitted during initialization, dispatching them once ready.
- Editor context attached to messages becomes a clickable chip with collapsible preview rather than raw text in speech bubble.
- First-run guided setup: Studio detects missing prerequisites, downloads and installs `omp`, configures Git Bash, installs monospace font, and hosts credentials and model setup in a secure tab.
- "⚠ Setup" chip in top bar when configuration is incomplete, allowing reopening setup wizard at any time.
- System notifications on Windows 10/11 and macOS when agent requests attention or completes a task with app in background, with direct click to affected project.
- Visual badge on app icon: flashing red dot on Windows taskbar and numbered badge with bounce in macOS Dock.
- New "Notifications" settings section: toggle, summary or full text, icon alert, sound alert, and test notification dispatch.
- Unified Settings center (`Ctrl+Alt+,`) with six sections: General, Notifications, Project Bar, Workspace, Tasks & Agents, and Models.
- Customizable editor and terminal—font family, font size, minimap, word wrap, tab size, line numbers, scrollback, bell, and cursor style—applied immediately without restarts.
- New task defaults configurable globally and overridable per project.
- Dedicated usage panel window with critical quotas, reset countdowns, 24-hour trends, and estimated burn rate.
- Dedicated preview for SVG files opened in editor.
- Helpful empty states in workspace and agent panel with suggested actions and keyboard shortcut grids.
- Consistent system alerts explaining error causes with retry buttons, replacing blank or stuck "Loading" panels.
- New application icon for Windows and macOS.

### Changed

- Faster startup and smoother streaming: bundle split across editor, terminal, and diagrams; updates synced to display refresh rate; binary compiled with full optimizations.
- Reorganized task editor and chat: prompt centered, advanced options in collapsible panel with summary, unified action buttons.
- More readable chat transcript: indentation and luminance replacing decorative colored borders, no height limits on code blocks, prose capped at 65 characters per line.
- Block appearances, expansions, and dismissals feature fluid animations, automatically disabled when system requests reduced motion.
- Chat executes standard commands (bash, write, edit, eval) directly without approval prompts, aligning with terminal behavior.

### Fixed

- Accessibility: labels on all controls, `Tab` contained within modals and drawers, `Esc` dismissal, compliant contrast ratios, and screen reader announcements for agent state changes.
- Closing tabs or application terminates all child processes: no orphan background processes.
- Stop button cancels agent instantly (`Esc`, `Alt+C`, `Ctrl+C`).
- History unifies disk sessions and timeline, ensuring sessions spawned from tasks resume cleanly.
- Eliminated message desynchronization when attaching to running sessions.
- Usage panel no longer flags inactive projects and cleans up lingering records.
- Chat remains pinned to bottom during streaming and auto-scrolls when nearing bottom.
- Editor preserves scroll position and cursor location per file when switching tabs or projects.
- Corrected double focus ring on prompt, textarea height after submit, command palette help bar, duplicate pasted images, and spurious startup warnings.
- `omp` update check reads correct version even when output contains ANSI color codes, handling network failures gracefully.
- Nightly channel: updates always present installer for announced build, removing older build installers upon release.

### Security

- SVG previews and HTML prototypes open in an isolated container without scripts or app access, sanitizing content prior to rendering.
- Studio update rejects packages lacking verified SHA-256 digests, re-verifying disk files immediately prior to execution and deleting temporary files.
- `omp` installation aborts if digest published on GitHub does not match downloaded file.
- `omp` databases open in read-only mode without write or lock capabilities, ensuring queries never block UI.
- All requested paths resolved and validated within project root, preventing traversal via `..` or symlinks.
- Interface exposes only commands declared in application permissions; Studio registers OS identity on Windows for system notifications.

## [1.1.0] - 2026-08-24

### Added

- GUI chat displays useful initial state and full slash command palette with signatures, aliases, descriptions, and subcommands.
- FILE, GIT, quota, and preview panels display genuine errors with retry options instead of remaining empty or stuck on "Loading".
- Updates support stable and Nightly channels, the latter receiving cutting-edge builds automatically without exposing stable users.

### Changed

- Responses, reasoning, and tool outputs stream progressively in Markdown while keeping view pinned to bottom.
- Tool cards display paths, options, tasks, and structured data during execution; errors feature distinct visual state.
- Dialogs, menus, and shortcuts respect active focus, close with `Esc`, and utilize interface semantic layers and colors.

### Fixed

- GUI surface no longer freezes when omp publishes session ID: submission, transcript, and menus remain responsive.
- Assistant messages, streaming deltas, and tool results appear in transcript rather than remaining invisible or perpetually pending.
- Slash commands execute once with `Enter`; commands unsupported in GUI explicitly guide user to TERMINAL tab.
- `Enter` in composer no longer accidentally approves tool calls while confirmation prompts are visible.
- Switching between GUI and TERMINAL preserves same session bidirectionally, and closing projects terminates corresponding omp process.
- Long-running sessions do not drop valid RPC requests due to unkeyed responses, and shell commands benefit from extended timeouts.

## [1.0.1] - 2026-08-24

### Fixed

- GUI tab remains usable when resumed session no longer exists: automatically opens new chat instead of leaving `omp` terminated.

## [1.0.0] - 2026-08-24

### Added

- Second native surface for agent: right column becomes tabbed `TERMINAL | GUI`, with explicit handoff and session preservation via `--resume`.
- Native Svelte 5 client driving `omp --mode rpc-ui` over stdio NDJSON with Rust transport providing delta coalescing and protocol v2 chunk reassembly.
- Native transcript with markdown rendering, collapsible reasoning blocks, 30 dedicated cards for system tools, subagent management, and todo tracking.
- Structured approval gate with configurable policy (`ask-writes`, `ask-all`, `yolo`) in settings panel, persisted locally without touching `~/.omp`.
- Intelligent slash command interception and prompt queue management with steer/follow-up toggle.

## [0.9.0] - 2026-08-24

### Added

- Each project includes a reorderable prompt queue: a task launches a clean session, automatically transitions to history, and maintains the `TASK` badge.
- Historical sessions can be resumed with a click within the same terminal, without restarting the `omp` process.

### Fixed

- Studio updates no longer suggest installers intended for different operating systems when compatible packages are missing from release assets.
- New releases publish only after generating both Windows x64 installers and universal DMGs for Intel and Apple Silicon Macs.

## [0.8.1] - 2026-08-21

### Changed

- Terminal on macOS treats Option as Meta: `omp` Alt shortcuts (such as Option+P for model picker) function properly instead of inserting Italian layout special characters.

### Fixed

- Terminal on macOS displays Nerd Font icons again: Studio now bundles its own monospace font with Nerd glyphs, removing reliance on WebKit system font matching which rendered private-use glyphs as boxes on macOS 27.

## [0.8.0] - 2026-08-21

### Added

- New `studio_preview` agent tool: enables `omp` to build UI component prototypes (React, Tailwind CSS, Lucide) and open them immediately in the interactive sandbox in the center column during vibecoding.
- Automatic persistence of generated prototypes in project `proto/` folder, with automatic addition to `.gitignore` to keep working tree clean.
- Support for live rendering and hot compilation of TSX/JSX components, source code viewer with quick copy button, and viewport switcher (Desktop, Tablet, Mobile).

## [0.7.1] - 2026-08-21

### Fixed

- The `studio_diagram` tool for diagram whiteboard is now loaded automatically in every `omp` session started by Studio: no longer necessary to pass the extension manually via `-e`.

## [0.7.0] - 2026-08-21

### Added

- New GIT panel in left column: displays current branch, uncommitted modified files (with added/removed line counts), latest agent commit, and recent history. Clicking a file opens side-by-side diff in editor even for committed changes—eliminating manual hunting for files modified by agent commits.
- Branch switching and new branch creation directly from GIT panel, with automatic guardrails when uncommitted changes exist.
- Recent agent sessions appear in GIT panel timeline: click to resume them in project terminal with `--resume`.
- Diagram whiteboard: agent can use `studio_diagram` tool to render Mermaid diagrams in central column with zoom support, replacing terminal ASCII art.
- Live sandboxed preview for HTML files: "Preview" button in editor opens interactive prototype (desktop/tablet/mobile) within the app, isolated from the rest of the system.

## [0.6.5] - 2026-08-20

### Changed

- Redesigned model recommendation logic for operational roles: top priority given to Tier 1/Top ELO models from flat-rate subscription accounts (OAuth flat) for primary roles, with cross-provider zero-cost safety nets.
- Integrated real-world throughput metrics (tokens/sec measured by `agent.db`) for optimal fast role selection (`smol`, `commit`).
- Comprehensive unexpected cost protection: automatic exclusion of pay-per-token models not covered by user subscriptions.
- Enriched suggestion chips and tooltips with badges for estimated Coding ELO, measured effective throughput (tok/s), subscription provider status, and zero-cost fallbacks.
- Introduced deterministic fallback engine based on ELO matrix providing instant, resilient recommendations during AI engine latency or outages.

## [0.6.4] - 2026-08-20

### Added

- Intelligent model recommendation for OMP operational roles based on background one-shot AI analysis: contextual selection of optimal primary models and cross-provider fallbacks to ensure resilience against rate limits (429) and outages.
- Reactive cache for AI recommendations with staleness pre-filtering and on-demand re-analysis button.

## [0.6.3] - 2026-08-20

### Changed

- Redesigned OMP operational roles management in models modal with two-column Master-Detail layout and dedicated Quick Cycle drawer (Ctrl+P).
- Introduced 1-click intelligent suggestions based on active catalog for primary models and fallbacks of each role.
- Replaced reasoning dropdown with new interactive stepped ReasoningSlider component featuring snapping, keyboard support, and visual token budget readout.
- Reorderable, enhanced fallback chain management with provider badges, context/capability metrics, and redundancy warnings.

## [0.6.2] - 2026-08-20

### Changed

- Migrated from standard Windows .msi installer to lightweight per-user NSIS (.exe) setup (`currentUser`), eliminating administrator prompts (UAC) and speeding up initial installation.
- Fully silent in-app updates: application runs background setup with automatic restart without launching external wizards.
- Complete redesign of model and role management interface: removed decorative emojis and non-compliant semantic colors in favor of monochromatic typographic badges, system tokens, and clean SVG icons.
- Unified persistence model in model management: added draft support for custom providers with protection against losing unsaved changes on modal close.
- Accessibility and keyboard navigation in model picker and system modals: added WAI-ARIA semantics (`role="dialog"`, `role="tablist"`, `role="listbox"`), arrow key support in model dropdowns, and `Esc` dismissal.
- Extended rapid fallback assignment in catalog to all 8 OMP operational roles.

## [0.6.1] - 2026-08-19

### Added

- Added "Recheck" button in header and footer of OMP Studio update modal to check GitHub for newer versions at any time, bypassing HTTP cache.

## [0.6.0] - 2026-08-19

### Added

- Full OMP provider, model, and role management integrated into GUI: dedicated modal accessible from top bar or via `Ctrl+Alt+M` (`Ctrl+Alt+,`).
- Visual model assignment to OMP operational roles (`default`, `plan`, `smol`, `slow`, `vision`, `task`, `commit`, `advisor`), reasoning/thinking level, and quick cycle sequence ordering (`Ctrl+P`).
- Streamlined fallback chain management per role with quick add, remove, and priority reordering for reserve models.
- Intelligent, automatic detection of new model versions: dedicated button to check for updates (e.g. `opus-5` → `opus-5.1`, `gemini-3.6` → `gemini-3.7`) with comparative summary dialog and bulk apply to confirmed roles.
- OMP model catalog explorer with full-text search, provider and capability filters (Vision, Reasoning), technical specifications, and quick role assignment action.
- Supported provider management (toggle activation and authenticated credentials state) and visual configuration of custom providers and endpoints (OpenAI-compatible, local Ollama, proxies) in `models.json`.
- Instant restart button for OMP sessions in open project terminals to apply model configuration changes immediately.
- Detection of providers and models used by `omp` subagents and fallbacks in usage popover, indicating active project beneath each active provider.

## [0.5.1] - 2026-08-19

### Added

- Syntax highlighting for SQL files and configuration/script formats (.sql, .xml, .config, .csproj, .vbproj, .props, .targets, .resx, .py, .yaml, .toml, .ini, .sh, .ps1, .bat) in Monaco Editor.
- Automatic recognition and direct clicking for file paths and names in the terminal (e.g. "agents.md", relative/absolute paths, Git diffs, snapshot tags `[file#tag:line]`, and line numbers `:line:col`) to open them directly in the editor.

### Fixed

- Web links clicked in the terminal open properly in the default system browser via the opener plugin.

## [0.5.0] - 2026-08-19

### Added

- Reset countdown displayed for each limit in the usage popover (e.g. "· in 1h 25m"), with exact date and time in the tooltip.

### Changed

- Active project indication in usage popover is displayed once beneath provider header rather than under each individual limit bar.

### Fixed

- Status dot on project cards in top bar (completed or attention required) is no longer clipped by the rounded border.
- Refresh animation in usage popover rotates solely the inner icon without spinning the entire button.

## [0.4.0] - 2026-08-17

### Added

- Check and install OMP Studio updates directly in-app from bottom bar, with verification from GitHub Releases, percentage and speed tracking for downloads, release notes display, and restart to install.

### Changed

- Long lines in editor no longer soft wrap: they scroll horizontally while keeping line numbers visible.
- Active project indicator in usage panel displays only project names.

## [0.3.1] - 2026-08-13

### Added

- Complete cross-platform support for macOS (Apple Silicon and Intel): native PTY shell ($SHELL zsh/bash), automatic `omp` binary resolution, keyboard shortcuts with `Cmd` (⌘), and POSIX path handling.
- Automatic injection of user binary paths (`~/.bun/bin`, `~/.cargo/bin`, `/opt/homebrew/bin`, etc.) into `$PATH` for PTY sessions on macOS.

### Fixed

- Fixed `libsqlite3-sys` compilation error with recent versions of Rust compiler.
- Resolved V8 memory limit during Monaco Editor frontend build.

## [0.3.0] - 2026-08-03

### Added

- Open multiple files in same project as editor tabs, with diff and close on each tab; `Ctrl+W` and `Ctrl+F4` close active file.
- Rename projects and set multi-character custom abbreviations from the project card.

### Changed

- Theme switcher separates light and dark themes into two tabs, reopens on last used tab, and displays applied theme name beside color.
- Automatic project colors now follow active theme palette and luminance; manual choices remain unchanged.
- Project path in project card is ellipsized without overflowing border.

## [0.2.1] - 2026-08-03

### Added

- Added 48 built-in light themes from `omp`, separated from 52 dark themes in switcher; selection updates shell, editor, terminal, and `omp` sessions together.

### Changed

- Recognizes `theme.light` on startup when `theme.dark` is not set.

## [0.2.0] - 2026-08-03

### Added

- Usage panel opens and closes with `Ctrl+Alt+U`, keeping hands on keyboard. Shortcut is also displayed in button tooltip.
- Under each usage panel bar, active consumers are displayed—for example "In use by: OMP Studio · AreaIT, Windows Terminal · GestioneFlotta"—so you know immediately if another window is driving usage. If unused, nothing is shown.
- Theme picker in top bar: 52 dark themes from `omp`, with filtering. Updates Studio and TUI colors simultaneously, which now start from the same theme. Studio automatically adopts theme chosen in `omp` on startup.
- `Ctrl+click` on file path printed by agent opens it in editor at indicated line. Paths outside project directory are ignored.

### Changed

- Quieter interface: agent states no longer use colored luminous glows or green and blue. Only a ring and dot remain in two colors—crimson when working or finished, amber when awaiting response.
- Top bar no longer expands on hover: tabs, logo, and spacing stay fixed. Now 48px high with proportional tabs and logo.
- Single colored project at a time: active tab is filled with project color, others are neutral with only initial letter tinted. Previously every open project was a saturated block.
- Single continuous animation across the entire app instead of seven: gentle pulse on "working" tab, redesigned to avoid keeping GPU busy at idle.
- Path in tab card is truncated in center rather than scrolling back and forth: tail of path is the relevant part.
- Interface colors and radii derive from a small set of constants, so states like "hovered row" or "selected row" behave consistently across every panel, including above terminal and inside popovers.
- Columns separated by background contrast rather than border lines: removed vertical dividers and borders below headers. Tree rows fade when passing under headers, and draggable divider appears in crimson only on hover.

### Removed

- Background blur behind dialog windows: caused continuous repainting of underlying terminal without adding information.

## [0.1.0] - 2026-07-30

### Added

- First public release: multi-project desktop shell for the `omp` agent, featuring integrated terminal, file tree, editor, and usage panel in a single window.
- Project bar at top: each project is a tab with its own persistent terminal, automatically sorted by last used, with customizable color (eight-tone palette or free picker).
- Agent status visible at a glance on tab and in bottom bar: idle, working, awaiting response, completed.
- Project selector via `+` button or `Ctrl+Alt+N`: lists folders in repository root indicating already open projects, and allows browsing others.
- File tree with icons by type, Git status indicators (modified, added, untracked, removed, renamed), and automatic updates when agent modifies files.
- Monaco Editor with side-by-side Git diff, gutter markers for modified lines, unsaved changes indicator, and saving via `Ctrl+S`. Each project remembers its open file.
- Live preview for Markdown and SVG beside editor with draggable divider, and dedicated image viewer with zoom, pan, and 1:1 reset.
- Full-text search and listing of agent sessions, allowing resumption of interrupted work without manual searching.
- Usage panel with remaining quota per provider, manual refresh, last updated timestamp, and animated fill bars.
- Check and install `omp` updates from bottom bar with confirmation, logs, and restart prompt.
- Native window controls integrated into top bar with window position and size restoration on launch.
