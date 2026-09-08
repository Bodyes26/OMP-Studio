// Host storage per il Laboratorio prototipi dentro Studio.
//
// Implementa `LabStorageHost` in modo polimorfico:
//  1. In ambiente Tauri: usa i comandi IPC nativi (`file_read`, `file_write`,
//     `tree_read`, `path_create_directory`, `path_trash`) radicati sul percorso;
//  2. In ambiente browser / test mock: usa un VFS in memoria isolato e deterministico.

import type { LabDirectoryEntry, LabStorageHost } from './storage.ts';

function isTauriEnvironment(): boolean {
	return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

/**
 * Crea un host di archiviazione in memoria per test o fallback browser.
 */
export function createMemoryStorageHost(label: string = 'memory'): LabStorageHost {
	const files = new Map<string, string>();
	const dirs = new Set<string>(['']);

	function norm(p: string): string {
		return p.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
	}

	return {
		label,
		async readTextFile(path: string): Promise<string | null> {
			const n = norm(path);
			return files.has(n) ? (files.get(n) as string) : null;
		},
		async createFile(path: string, content: string): Promise<void> {
			const n = norm(path);
			if (files.has(n)) {
				throw new Error(`Il file '${path}' esiste gia' nell'host in memoria.`);
			}
			files.set(n, content);
			// Registra anche le cartelle antenate
			const parts = n.split('/');
			let cur = '';
			for (let i = 0; i < parts.length - 1; i++) {
				cur = cur ? `${cur}/${parts[i]}` : parts[i];
				dirs.add(cur);
			}
		},
		async replaceFile(temp: string, target: string): Promise<void> {
			const t = norm(temp);
			const d = norm(target);
			const content = files.get(t);
			if (content === undefined) {
				throw new Error(`File temporaneo '${temp}' non trovato.`);
			}
			files.set(d, content);
			files.delete(t);
			const parts = d.split('/');
			let cur = '';
			for (let i = 0; i < parts.length - 1; i++) {
				cur = cur ? `${cur}/${parts[i]}` : parts[i];
				dirs.add(cur);
			}
		},
		async removeFile(path: string): Promise<void> {
			files.delete(norm(path));
		},
		async createDirectory(path: string, options?: { exclusive?: boolean }): Promise<boolean> {
			const n = norm(path);
			if (options?.exclusive && dirs.has(n)) {
				return false;
			}
			const parts = n.split('/');
			let cur = '';
			for (const p of parts) {
				cur = cur ? `${cur}/${p}` : p;
				dirs.add(cur);
			}
			return true;
		},
		async listDirectory(path: string): Promise<LabDirectoryEntry[] | null> {
			const n = norm(path);
			const entries = new Map<string, 'file' | 'directory'>();
			const prefix = n ? `${n}/` : '';

			for (const dir of dirs) {
				if (dir && dir.startsWith(prefix) && dir !== n) {
					const rest = dir.slice(prefix.length);
					const directChild = rest.split('/')[0];
					if (directChild) entries.set(directChild, 'directory');
				}
			}

			for (const file of files.keys()) {
				if (file.startsWith(prefix)) {
					const rest = file.slice(prefix.length);
					const directChild = rest.split('/')[0];
					const isDir = rest.includes('/');
					if (directChild && !entries.has(directChild)) {
						entries.set(directChild, isDir ? 'directory' : 'file');
					}
				}
			}

			if (n !== '' && !dirs.has(n) && entries.size === 0) {
				return null;
			}

			return Array.from(entries.entries()).map(([name, kind]) => ({
				name,
				kind
			}));
		}
	};
}

/**
 * Crea un host di archiviazione per il Laboratorio prototipi.
 * Seleziona automaticamente il backend migliore (Tauri IPC o memoria).
 */
export function createLabStorageHost(rootPath: string): LabStorageHost {
	if (isTauriEnvironment()) {
		return createTauriStorageHost(rootPath);
	}
	return createMemoryStorageHost(rootPath || 'lab-memory');
}

/**
 * Host basato sui comandi IPC di Tauri.
 */
function createTauriStorageHost(projectPath: string): LabStorageHost {
	const getInvoke = () => {
		// @ts-expect-error window.__TAURI_INTERNALS__ puo' essere presente
		return window.__TAURI_INTERNALS__?.invoke || (window as any).__TAURI__?.core?.invoke;
	};

	return {
		label: projectPath,
		async readTextFile(path: string): Promise<string | null> {
			const invoke = getInvoke();
			if (!invoke) return null;
			try {
				const res: { content: string } = await invoke('file_read', {
					projectPath,
					rel: path.replace(/\\/g, '/')
				});
				return res.content;
			} catch {
				return null;
			}
		},
		async createFile(path: string, content: string): Promise<void> {
			const invoke = getInvoke();
			if (!invoke) return;
			await invoke('file_write', {
				projectPath,
				rel: path.replace(/\\/g, '/'),
				content
			});
		},
		async replaceFile(temp: string, target: string): Promise<void> {
			const invoke = getInvoke();
			if (!invoke) return;
			try {
				const res: { content: string } = await invoke('file_read', {
					projectPath,
					rel: temp.replace(/\\/g, '/')
				});
				await invoke('file_write', {
					projectPath,
					rel: target.replace(/\\/g, '/'),
					content: res.content
				});
				try {
					await invoke('path_trash', {
						projectPath,
						rel: temp.replace(/\\/g, '/')
					});
				} catch {
					// pulizia temporaneo best-effort
				}
			} catch (err) {
				throw new Error(`Sostituzione atomica fallita per '${target}': ${String(err)}`);
			}
		},
		async removeFile(path: string): Promise<void> {
			const invoke = getInvoke();
			if (!invoke) return;
			try {
				await invoke('path_trash', {
					projectPath,
					rel: path.replace(/\\/g, '/')
				});
			} catch {
				// rimozione best-effort
			}
		},
		async createDirectory(path: string, options?: { exclusive?: boolean }): Promise<boolean> {
			const invoke = getInvoke();
			if (!invoke) return true;
			const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
			let parentRel = '';
			for (const part of parts) {
				try {
					await invoke('path_create_directory', {
						projectPath,
						parentRel,
						name: part
					});
				} catch (err: any) {
					if (options?.exclusive && part === parts[parts.length - 1]) {
						const msg = String(err).toLowerCase();
						if (msg.includes('exist') || msg.includes('gia')) {
							return false;
						}
					}
				}
				parentRel = parentRel ? `${parentRel}/${part}` : part;
			}
			return true;
		},
		async listDirectory(path: string): Promise<LabDirectoryEntry[] | null> {
			const invoke = getInvoke();
			if (!invoke) return null;
			try {
				const entries: Array<{ name: string; is_dir: boolean; is_file: boolean }> = await invoke(
					'tree_read',
					{
						projectPath,
						rel: path.replace(/\\/g, '/')
					}
				);
				return entries.map((entry) => ({
					name: entry.name,
					kind: entry.is_dir ? 'directory' : 'file'
				}));
			} catch {
				return null;
			}
		}
	};
}
