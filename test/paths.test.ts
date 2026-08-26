import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProjectPath, joinProjectPath, pathKey } from '../src/lib/utils/paths.ts';

describe('Normalizzazione percorsi di progetto', () => {
	describe('normalizeProjectPath (Windows)', () => {
		it('converte slash in backslash e rimuove trailing slash', () => {
			assert.equal(
				normalizeProjectPath('C:/Users/test/project/', true),
				'C:\\Users\\test\\project'
			);
			assert.equal(
				normalizeProjectPath('C:\\Users\\test\\project\\\\', true),
				'C:\\Users\\test\\project'
			);
		});

		it('preserva la radice del disco con backslash finale', () => {
			assert.equal(normalizeProjectPath('C:', true), 'C:\\');
			assert.equal(normalizeProjectPath('C:/', true), 'C:\\');
			assert.equal(normalizeProjectPath('D:\\', true), 'D:\\');
		});

		it('gestisce stringhe vuote o nulle', () => {
			assert.equal(normalizeProjectPath('', true), '');
			assert.equal(normalizeProjectPath(null as unknown as string, true), '');
			assert.equal(normalizeProjectPath(undefined as unknown as string, true), '');
		});
	});

	describe('normalizeProjectPath (POSIX)', () => {
		it('converte backslash in forward slash e rimuove trailing slash', () => {
			assert.equal(
				normalizeProjectPath('/home/user/project/', false),
				'/home/user/project'
			);
			assert.equal(
				normalizeProjectPath('\\home\\user\\project\\\\', false),
				'/home/user/project'
			);
		});

		it('preserva la radice /', () => {
			assert.equal(normalizeProjectPath('/', false), '/');
			assert.equal(normalizeProjectPath('///', false), '/');
			assert.equal(normalizeProjectPath('\\', false), '/');
		});

		it('gestisce stringhe vuote o nulle', () => {
			assert.equal(normalizeProjectPath('', false), '');
		});
	});

	describe('pathKey', () => {
		it('genera chiavi lowercase per confronto insensitive su Windows', () => {
			const k1 = pathKey('C:\\Users\\Developer\\App', true);
			const k2 = pathKey('c:/users/developer/app/', true);
			assert.equal(k1, k2);
			assert.equal(k1, 'c:\\users\\developer\\app');
		});

		it('genera chiavi lowercase coerenti su POSIX', () => {
			const k1 = pathKey('/Home/User/Project/', false);
			assert.equal(k1, '/home/user/project');
		});
	});

	describe('joinProjectPath', () => {
		it('unisce correttamente percorsi su Windows', () => {
			assert.equal(
				joinProjectPath('C:\\Repo', 'src/lib/index.ts', true),
				'C:\\Repo\\src\\lib\\index.ts'
			);
			assert.equal(
				joinProjectPath('C:\\Repo\\', '\\src\\lib\\index.ts', true),
				'C:\\Repo\\src\\lib\\index.ts'
			);
		});

		it('unisce correttamente percorsi su POSIX', () => {
			assert.equal(
				joinProjectPath('/repo', 'src/lib/index.ts', false),
				'/repo/src/lib/index.ts'
			);
			assert.equal(
				joinProjectPath('/repo/', '/src/lib/index.ts', false),
				'/repo/src/lib/index.ts'
			);
		});

		it('ritorna il base path se rel è vuoto', () => {
			assert.equal(joinProjectPath('C:\\Repo', '', true), 'C:\\Repo');
			assert.equal(joinProjectPath('/repo', '', false), '/repo');
		});
	});
});
