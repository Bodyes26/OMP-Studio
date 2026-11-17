import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProjectPath, joinProjectPath, pathKey, isWindowsPath } from '../src/lib/utils/paths.ts';

/**
 * La semantica di un percorso remoto e' quella della macchina che lo possiede.
 * Deterministico di proposito: non dipende dal sistema che esegue i test, e
 * copre la direzione Windows -> Mac che su un runner macOS non si riprodurrebbe.
 */
describe('isWindowsPath (semantica del sistema di una macchina remota)', () => {
	it('riconosce la piattaforma di std::env::consts::OS', () => {
		assert.equal(isWindowsPath('windows'), true);
		assert.equal(isWindowsPath('macos'), false);
		assert.equal(isWindowsPath('linux'), false);
	});

	it('accetta le varianti e non distingue maiuscole', () => {
		assert.equal(isWindowsPath('Windows'), true);
		assert.equal(isWindowsPath(' win32 '), true);
		assert.equal(isWindowsPath('windows_nt'), true);
		assert.equal(isWindowsPath('darwin'), false);
	});

	it('senza piattaforma ricade sul sistema locale', () => {
		assert.equal(isWindowsPath(null), isWindowsPath(undefined));
		assert.equal(isWindowsPath(''), isWindowsPath(undefined));
	});

	it('un percorso del Mac resta POSIX anche con semantica Windows disattivata', () => {
		const macPath = '/Users/other/dev/repo';
		assert.equal(normalizeProjectPath(macPath, isWindowsPath('macos')), macPath);
	});

	/**
	 * La base dichiara il sistema: senza questa inferenza, un progetto del Mac
	 * aperto da Windows produceva `/Users/x\src\file.ts`, che il Mac non trova.
	 */
	it('unisce un percorso del Mac in forma POSIX anche quando chi chiama e su Windows', () => {
		assert.equal(
			joinProjectPath('/Users/other/dev/repo', 'src/lib/foo.ts'),
			'/Users/other/dev/repo/src/lib/foo.ts'
		);
	});

	it('unisce un percorso di Windows in forma Windows', () => {
		assert.equal(
			joinProjectPath('C:/Users/other/repo', 'src/lib/foo.ts'),
			'C:\\Users\\other\\repo\\src\\lib\\foo.ts'
		);
	});

	it('non trasforma una base POSIX in Windows in nessun caso', () => {
		const joined = joinProjectPath('/Users/other/dev/repo', 'src/lib/foo.ts');
		assert.ok(!joined.includes('\\'));
	});
});

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
