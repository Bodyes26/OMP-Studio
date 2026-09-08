/**
 * Host di riferimento della porta `LabStorageHost` su filesystem reale.
 *
 * E' l'implementazione con cui i test del Laboratorio verificano su disco cio'
 * che conta: creazione esclusiva dei temporanei, sostituzione in un solo passo
 * ed elenco delle cartelle. Non e' un doppio in memoria: gli invarianti di
 * persistenza e di ripristino si dimostrano su file veri.
 */

import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LabDirectoryEntry, LabStorageHost } from '../src/lib/lab/storage.ts';

export function nodeHost(root: string): LabStorageHost {
	const resolve = (path: string) => join(root, path);
	return {
		label: root,
		async readTextFile(path) {
			try {
				return await readFile(resolve(path), 'utf8');
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
				throw error;
			}
		},
		async createFile(path, content) {
			// `wx`: fallisce se il temporaneo esiste, come `create_new` in Rust.
			await writeFile(resolve(path), content, { encoding: 'utf8', flag: 'wx' });
		},
		async replaceFile(temp, target) {
			await rename(resolve(temp), resolve(target));
		},
		async removeFile(path) {
			await rm(resolve(path), { force: true });
		},
		async createDirectory(path, options) {
			if (options?.exclusive) {
				try {
					await mkdir(resolve(path));
					return true;
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
					throw error;
				}
			}
			await mkdir(resolve(path), { recursive: true });
			return true;
		},
		async listDirectory(path) {
			try {
				const entries = await readdir(resolve(path), { withFileTypes: true });
				return entries.map(
					(entry): LabDirectoryEntry => ({
						name: entry.name,
						kind: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other'
					})
				);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
				throw error;
			}
		}
	};
}
