import { invoke } from '@tauri-apps/api/core';
import { load, type Store } from '@tauri-apps/plugin-store';
import { DEFAULT_THEME, THEMES, THEME_NAMES, anchorsFor, applyAnchors, type ThemeMode } from '$lib/theme';

/**
 * Un tema solo per Studio e per la TUI.
 *
 * All'avvio il guscio prende il tema che l'utente ha gia' scelto in `omp`
 * (`theme.dark`, o `theme.light` se il primo manca, letto in sola lettura) e
 * non scrive niente: finche' non si sceglie un tema qui dentro, `omp` resta
 * padrone del proprio aspetto.
 *
 * Alla prima scelta Studio scrive `~/.omp/agent/themes/omp-studio.json` - il
 * solo file che tocca dentro `~/.omp`, vedi docs/DECISIONS.md - e le sessioni
 * lanciate da quel momento partono con `theme.dark` e `theme.light` puntati a
 * `omp-studio` nell'overlay.
 */
class ThemeStore {
	current = $state<string>(DEFAULT_THEME);
	/** Vero da quando il tema di `omp` e' pilotato da Studio. */
	bridged = $state(false);

	private store: Store | null = null;

	names = THEME_NAMES;
	pickerMode = $state<ThemeMode>('dark');


	async init() {
		// Il colore del guscio non puo' dipendere dal fatto che le impostazioni
		// o `omp` rispondano: in caso di guasto si parte comunque dal default.
		try {
			this.store = await load('settings.json', { autoSave: false });
			const stored = (await this.store.get('theme')) as string | null;
			const storedPickerMode = (await this.store.get('themePickerMode')) as ThemeMode | null;
			if (storedPickerMode === 'dark' || storedPickerMode === 'light') {
				this.pickerMode = storedPickerMode;
			}
			if (stored && THEMES[stored]) {
				this.current = stored;
				this.bridged = true;
			}
		} catch {
			this.store = null;
		}

		if (!this.bridged) {
			try {
				const userTheme = (await invoke('omp_user_theme')) as string | null;
				if (userTheme && THEMES[userTheme]) this.current = userTheme;
			} catch {
				// `omp` non raggiungibile: resta il default.
			}
		}

		applyAnchors(anchorsFor(THEMES[this.current]));
	}

	/**
	 * Rilegge il tema di `omp` e lo adotta. Serve dopo il wizard di primo
	 * avvio: la scena `theme` cambia `theme.dark` mentre Studio e' gia' in
	 * esecuzione, e il guscio deve seguire quella scelta invece di imporne
	 * un'altra. Se l'utente ha gia' scelto un tema dentro Studio (`bridged`)
	 * non si tocca niente: la sua scelta piu' recente vince.
	 */
	async adoptFromOmp() {
		if (this.bridged) return;
		try {
			const userTheme = (await invoke('omp_user_theme')) as string | null;
			if (!userTheme || !THEMES[userTheme] || userTheme === this.current) return;
			this.current = userTheme;
			applyAnchors(anchorsFor(THEMES[userTheme]));
		} catch {
			// `omp` non raggiungibile: il guscio resta com'e'.
		}
	}

	async select(name: string) {
		const theme = THEMES[name];
		if (!theme) return;

		this.current = name;
		applyAnchors(anchorsFor(theme));

		// Se `omp` non e' scrivibile il guscio ha comunque cambiato colore: la
		// scelta va ricordata lo stesso, il ponte si ritentera' al prossimo giro.
		try {
			await invoke('theme_apply', { theme });
			this.bridged = true;
		} catch (e) {
			console.error('Tema non propagato a omp', e);
		}

		await this.store?.set('theme', name);
		await this.store?.save();
	}

	async setPickerMode(mode: ThemeMode) {
		this.pickerMode = mode;
		await this.store?.set('themePickerMode', mode);
		await this.store?.save();
	}
}

export const themeStore = new ThemeStore();
