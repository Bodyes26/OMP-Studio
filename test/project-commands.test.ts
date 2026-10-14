import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
	validateDirectChildPath,
	validateProjectName,
	splitCanonicalSegments,
	listRemoteProjectFolders,
	openRemoteProject,
	createRemoteProject,
	type ProjectCommandDeps
} from '../src/lib/remote/projectCommands.ts';
import { RemoteCommandFailure } from '../src/lib/remote/commands.ts';

describe('projectCommands: splitCanonicalSegments', () => {
	it('parses POSIX absolute paths with dot and dot-dot resolution', () => {
		const res = splitCanonicalSegments('/Users/dev/../dev/project/.', false);
		assert.equal(res.isAbsolute, true);
		assert.equal(res.drive, null);
		assert.deepEqual(res.segments, ['Users', 'dev', 'project']);
	});

	it('does not allow dot-dot above root on absolute path', () => {
		const res = splitCanonicalSegments('/../../etc', false);
		assert.equal(res.isAbsolute, true);
		assert.deepEqual(res.segments, ['etc']);
	});

	it('parses Windows drive letters and normalizes backslashes', () => {
		const res = splitCanonicalSegments('C:\\dev\\project\\..\\other', true);
		assert.equal(res.isAbsolute, true);
		assert.equal(res.drive, 'C:');
		assert.deepEqual(res.segments, ['dev', 'other']);
	});
});

describe('projectCommands: validateDirectChildPath', () => {
	it('accepts direct child folder on POSIX', () => {
		const res = validateDirectChildPath('/Users/dev/my-project', '/Users/dev', false);
		assert.equal(res.valid, true);
		if (res.valid) {
			assert.equal(res.canonicalPath, '/Users/dev/my-project');
			assert.equal(res.folderName, 'my-project');
		}
	});

	it('accepts direct child folder with trailing slash on POSIX', () => {
		const res = validateDirectChildPath('/Users/dev/my-project/', '/Users/dev', false);
		assert.equal(res.valid, true);
		if (res.valid) {
			assert.equal(res.canonicalPath, '/Users/dev/my-project');
			assert.equal(res.folderName, 'my-project');
		}
	});

	it('accepts relative folder name resolved under root', () => {
		const res = validateDirectChildPath('my-project', '/Users/dev', false);
		assert.equal(res.valid, true);
		if (res.valid) {
			assert.equal(res.canonicalPath, '/Users/dev/my-project');
			assert.equal(res.folderName, 'my-project');
		}
	});

	it('rejects path traversal attempting to escape root on POSIX', () => {
		const res1 = validateDirectChildPath('/Users/dev/../secret', '/Users/dev', false);
		assert.equal(res1.valid, false);

		const res2 = validateDirectChildPath('/Users/dev/../../etc/passwd', '/Users/dev', false);
		assert.equal(res2.valid, false);

		const res3 = validateDirectChildPath('../../outside', '/Users/dev', false);
		assert.equal(res3.valid, false);
	});

	it('rejects root folder itself', () => {
		const res = validateDirectChildPath('/Users/dev', '/Users/dev', false);
		assert.equal(res.valid, false);
	});

	it('rejects nested descendant paths (more than one level)', () => {
		const res = validateDirectChildPath('/Users/dev/project/submodule', '/Users/dev', false);
		assert.equal(res.valid, false);
	});

	it('rejects unset or empty root', () => {
		const res = validateDirectChildPath('my-project', '', false);
		assert.equal(res.valid, false);
	});

	it('accepts direct child on Windows', () => {
		const res = validateDirectChildPath('C:\\dev\\my-project', 'C:\\dev', true);
		assert.equal(res.valid, true);
		if (res.valid) {
			assert.equal(res.canonicalPath, 'C:\\dev\\my-project');
			assert.equal(res.folderName, 'my-project');
		}
	});

	it('handles mixed slashes and case-insensitivity on Windows', () => {
		const res = validateDirectChildPath('c:/dev/MY-PROJECT/', 'C:\\dev', true);
		assert.equal(res.valid, true);
		if (res.valid) {
			assert.equal(res.canonicalPath, 'C:\\dev\\MY-PROJECT');
			assert.equal(res.folderName, 'MY-PROJECT');
		}
	});

	it('rejects Windows drive mismatch', () => {
		const res = validateDirectChildPath('D:\\dev\\my-project', 'C:\\dev', true);
		assert.equal(res.valid, false);
	});

	it('rejects Windows path traversal', () => {
		const res = validateDirectChildPath('C:\\dev\\..\\Windows\\System32', 'C:\\dev', true);
		assert.equal(res.valid, false);
	});

	it('rejects Windows nested paths', () => {
		const res = validateDirectChildPath('C:\\dev\\sub\\deep', 'C:\\dev', true);
		assert.equal(res.valid, false);
	});
});

describe('projectCommands: validateProjectName', () => {
	it('accepts standard project names', () => {
		const r1 = validateProjectName('alpha', false);
		assert.equal(r1.valid, true);
		const r2 = validateProjectName('my-tool_2.0', false);
		assert.equal(r2.valid, true);
	});

	it('rejects empty or whitespace names', () => {
		assert.equal(validateProjectName('', false).valid, false);
		assert.equal(validateProjectName('   ', false).valid, false);
	});

	it('rejects names exceeding 100 characters', () => {
		const longName = 'a'.repeat(101);
		assert.equal(validateProjectName(longName, false).valid, false);
	});

	it('rejects names starting with dot', () => {
		assert.equal(validateProjectName('.hidden', false).valid, false);
		assert.equal(validateProjectName('.', false).valid, false);
		assert.equal(validateProjectName('..', false).valid, false);
	});

	it('rejects names ending with dot or space', () => {
		assert.equal(validateProjectName('project.', false).valid, false);
		assert.equal(validateProjectName('project ', false).valid, false);
	});

	it('rejects names with path separators', () => {
		assert.equal(validateProjectName('foo/bar', false).valid, false);
		assert.equal(validateProjectName('foo\\bar', false).valid, false);
	});

	it('rejects names containing dot-dot', () => {
		assert.equal(validateProjectName('foo..bar', false).valid, false);
	});

	it('rejects illegal folder characters', () => {
		assert.equal(validateProjectName('proj:test', false).valid, false);
		assert.equal(validateProjectName('proj*test', false).valid, false);
		assert.equal(validateProjectName('proj?test', false).valid, false);
		assert.equal(validateProjectName('proj"test', false).valid, false);
		assert.equal(validateProjectName('proj<test', false).valid, false);
		assert.equal(validateProjectName('proj>test', false).valid, false);
		assert.equal(validateProjectName('proj|test', false).valid, false);
	});

	it('rejects Windows reserved device names', () => {
		assert.equal(validateProjectName('con', false).valid, false);
		assert.equal(validateProjectName('PRN', false).valid, false);
		assert.equal(validateProjectName('aux', false).valid, false);
		assert.equal(validateProjectName('nul', false).valid, false);
		assert.equal(validateProjectName('com1', false).valid, false);
		assert.equal(validateProjectName('lpt9', false).valid, false);
		assert.equal(validateProjectName('CON.txt', false).valid, false);
		assert.equal(validateProjectName('aux.tar.gz', false).valid, false);
	});

	it('enforces stricter GitHub repo rules when forGithub is true', () => {
		assert.equal(validateProjectName('-leading-dash', true).valid, false);
		assert.equal(validateProjectName('spaces not allowed', true).valid, false);
		assert.equal(validateProjectName('special!chars', true).valid, false);
		assert.equal(validateProjectName('valid-repo_name.1', true).valid, true);
	});
});

describe('projectCommands: listRemoteProjectFolders', () => {
	it('returns null root and empty list when root is not configured', async () => {
		const deps: ProjectCommandDeps = {
			getProjectRoot: () => null,
			getOpenProjects: () => [],
			isGithubAuthenticated: () => false,
			readDir: async () => [],
			detectGithubRemotes: async () => [],
			openProject: () => null,
			createProject: async () => ''
		};

		const res = await listRemoteProjectFolders(deps);
		assert.equal(res.root, null);
		assert.deepEqual(res.folders, []);
		assert.equal(res.githubAvailable, false);
	});

	it('lists direct child directories, ignores dotfiles, and marks open and git repos', async () => {
		const deps: ProjectCommandDeps = {
			getProjectRoot: () => '/home/dev',
			getOpenProjects: () => [
				{ id: 'p-alpha', canonicalProjectPath: '/home/dev/alpha' }
			],
			isGithubAuthenticated: () => true,
			readDir: async () => [
				{ name: 'alpha', isDir: true },
				{ name: '.git', isDir: true },
				{ name: '.omp', isDir: true },
				{ name: 'beta', isDir: true },
				{ name: 'file.txt', isDir: false }
			],
			detectGithubRemotes: async () => [
				{ path: '/home/dev/alpha', fullName: 'user/alpha' }
			],
			openProject: () => null,
			createProject: async () => '',
			isWin: false
		};

		const res = await listRemoteProjectFolders(deps);
		assert.equal(res.root, '/home/dev');
		assert.equal(res.githubAvailable, true);
		assert.equal(res.folders.length, 2);

		assert.equal(res.folders[0].name, 'alpha');
		assert.equal(res.folders[0].path, '/home/dev/alpha');
		assert.equal(res.folders[0].openProjectId, 'p-alpha');
		assert.equal(res.folders[0].git, true);

		assert.equal(res.folders[1].name, 'beta');
		assert.equal(res.folders[1].path, '/home/dev/beta');
		assert.equal(res.folders[1].openProjectId, null);
		assert.equal(res.folders[1].git, false);
	});
});

describe('projectCommands: openRemoteProject', () => {
	it('fails if project root is not configured', async () => {
		const deps: ProjectCommandDeps = {
			getProjectRoot: () => null,
			getOpenProjects: () => [],
			isGithubAuthenticated: () => false,
			readDir: async () => [],
			detectGithubRemotes: async () => [],
			openProject: () => null,
			createProject: async () => ''
		};

		await assert.rejects(
			() => openRemoteProject('/dev/p1', deps),
			(err: unknown) => err instanceof RemoteCommandFailure && err.code === 'rejected'
		);
	});

	it('returns existing projectId immediately if already open', async () => {
		let openCalled = false;
		const deps: ProjectCommandDeps = {
			getProjectRoot: () => '/home/dev',
			getOpenProjects: () => [
				{ id: 'existing-id', canonicalProjectPath: '/home/dev/my-proj' }
			],
			isGithubAuthenticated: () => false,
			readDir: async () => [],
			detectGithubRemotes: async () => [],
			openProject: () => {
				openCalled = true;
				return 'new-id';
			},
			createProject: async () => '',
			isWin: false
		};

		const res = await openRemoteProject('/home/dev/my-proj', deps);
		assert.equal(res.projectId, 'existing-id');
		assert.equal(openCalled, false);
	});

	it('opens project via openProject flow when valid', async () => {
		let openedPath = '';
		const deps: ProjectCommandDeps = {
			getProjectRoot: () => '/home/dev',
			getOpenProjects: () => [],
			isGithubAuthenticated: () => false,
			readDir: async () => [],
			detectGithubRemotes: async () => [],
			openProject: (path) => {
				openedPath = path;
				return 'p-opened';
			},
			createProject: async () => '',
			isWin: false
		};

		const res = await openRemoteProject('my-proj', deps);
		assert.equal(res.projectId, 'p-opened');
		assert.equal(openedPath, '/home/dev/my-proj');
	});

	it('rejects path traversal with rejected error code', async () => {
		const deps: ProjectCommandDeps = {
			getProjectRoot: () => '/home/dev',
			getOpenProjects: () => [],
			isGithubAuthenticated: () => false,
			readDir: async () => [],
			detectGithubRemotes: async () => [],
			openProject: () => null,
			createProject: async () => '',
			isWin: false
		};

		await assert.rejects(
			() => openRemoteProject('/home/dev/../secret', deps),
			(err: unknown) => err instanceof RemoteCommandFailure && err.code === 'rejected'
		);
	});

	it('reports failed error code when openProject fails', async () => {
		const deps: ProjectCommandDeps = {
			getProjectRoot: () => '/home/dev',
			getOpenProjects: () => [],
			isGithubAuthenticated: () => false,
			readDir: async () => [],
			detectGithubRemotes: async () => [],
			openProject: () => null,
			createProject: async () => '',
			isWin: false
		};

		await assert.rejects(
			() => openRemoteProject('my-proj', deps),
			(err: unknown) => err instanceof RemoteCommandFailure && err.code === 'failed'
		);
	});

	it('rejects candidate that resolves outside root via symlink on host', async () => {
		const deps: ProjectCommandDeps = {
			getProjectRoot: () => '/home/dev',
			getOpenProjects: () => [],
			isGithubAuthenticated: () => false,
			readDir: async () => [],
			detectGithubRemotes: async () => [],
			canonicalizeChildDir: async () => {
				throw new Error('La cartella deve trovarsi direttamente sotto la radice dei progetti');
			},
			openProject: () => 'should-not-reach',
			createProject: async () => '',
			isWin: false
		};

		await assert.rejects(
			() => openRemoteProject('symlink-outside', deps),
			(err: unknown) =>
				err instanceof RemoteCommandFailure &&
				err.code === 'rejected' &&
				err.message.includes('direttamente sotto la radice')
		);
	});

	it('rejects nonexistent candidate path on host', async () => {
		const deps: ProjectCommandDeps = {
			getProjectRoot: () => '/home/dev',
			getOpenProjects: () => [],
			isGithubAuthenticated: () => false,
			readDir: async () => [],
			detectGithubRemotes: async () => [],
			canonicalizeChildDir: async () => {
				throw new Error('La cartella specificata non esiste');
			},
			openProject: () => 'should-not-reach',
			createProject: async () => '',
			isWin: false
		};

		await assert.rejects(
			() => openRemoteProject('nonexistent', deps),
			(err: unknown) =>
				err instanceof RemoteCommandFailure &&
				err.code === 'rejected' &&
				err.message.includes('non esiste')
		);
	});

	it('rejects candidate that is a regular file instead of directory on host', async () => {
		const deps: ProjectCommandDeps = {
			getProjectRoot: () => '/home/dev',
			getOpenProjects: () => [],
			isGithubAuthenticated: () => false,
			readDir: async () => [],
			detectGithubRemotes: async () => [],
			canonicalizeChildDir: async () => {
				throw new Error('Il percorso specificato non e\' una cartella');
			},
			openProject: () => 'should-not-reach',
			createProject: async () => '',
			isWin: false
		};

		await assert.rejects(
			() => openRemoteProject('file.txt', deps),
			(err: unknown) =>
				err instanceof RemoteCommandFailure &&
				err.code === 'rejected' &&
				err.message.includes('non e\' una cartella')
		);
	});
});

describe('projectCommands: createRemoteProject', () => {
	it('fails if root is not configured', async () => {
		const deps: ProjectCommandDeps = {
			getProjectRoot: () => null,
			getOpenProjects: () => [],
			isGithubAuthenticated: () => false,
			readDir: async () => [],
			detectGithubRemotes: async () => [],
			openProject: () => null,
			createProject: async () => ''
		};

		await assert.rejects(
			() => createRemoteProject('test', null, deps),
			(err: unknown) => err instanceof RemoteCommandFailure && err.code === 'rejected'
		);
	});

	it('fails if name is invalid', async () => {
		const deps: ProjectCommandDeps = {
			getProjectRoot: () => '/home/dev',
			getOpenProjects: () => [],
			isGithubAuthenticated: () => false,
			readDir: async () => [],
			detectGithubRemotes: async () => [],
			openProject: () => null,
			createProject: async () => ''
		};

		await assert.rejects(
			() => createRemoteProject('invalid/name', null, deps),
			(err: unknown) => err instanceof RemoteCommandFailure && err.code === 'rejected'
		);
	});

	it('fails if GitHub requested but not authenticated', async () => {
		const deps: ProjectCommandDeps = {
			getProjectRoot: () => '/home/dev',
			getOpenProjects: () => [],
			isGithubAuthenticated: () => false,
			readDir: async () => [],
			detectGithubRemotes: async () => [],
			openProject: () => null,
			createProject: async () => ''
		};

		await assert.rejects(
			() => createRemoteProject('my-project', { visibility: 'private' }, deps),
			(err: unknown) => err instanceof RemoteCommandFailure && err.code === 'rejected'
		);
	});

	it('fails if folder already exists in root', async () => {
		const deps: ProjectCommandDeps = {
			getProjectRoot: () => '/home/dev',
			getOpenProjects: () => [],
			isGithubAuthenticated: () => false,
			readDir: async () => [{ name: 'existing-proj', isDir: true }],
			detectGithubRemotes: async () => [],
			openProject: () => null,
			createProject: async () => ''
		};

		await assert.rejects(
			() => createRemoteProject('existing-proj', null, deps),
			(err: unknown) => err instanceof RemoteCommandFailure && err.code === 'rejected'
		);
	});

	it('creates local project and opens it successfully', async () => {
		let createdArgs: unknown = null;
		let openedPath = '';

		const deps: ProjectCommandDeps = {
			getProjectRoot: () => '/home/dev',
			getOpenProjects: () => [],
			isGithubAuthenticated: () => true,
			readDir: async () => [],
			detectGithubRemotes: async () => [],
			createProject: async (args) => {
				createdArgs = args;
				return `/home/dev/${args.name}`;
			},
			openProject: (path) => {
				openedPath = path;
				return 'p-created-id';
			},
			getUseSsh: () => true,
			isWin: false
		};

		const res = await createRemoteProject('brand-new', null, deps);
		assert.equal(res.projectId, 'p-created-id');
		assert.deepEqual(createdArgs, {
			parentDir: '/home/dev',
			name: 'brand-new',
			visibility: 'local',
			useSsh: true
		});
		assert.equal(openedPath, '/home/dev/brand-new');
	});

	it('creates GitHub project with private visibility', async () => {
		let createdArgs: unknown = null;

		const deps: ProjectCommandDeps = {
			getProjectRoot: () => '/home/dev',
			getOpenProjects: () => [],
			isGithubAuthenticated: () => true,
			readDir: async () => [],
			detectGithubRemotes: async () => [],
			createProject: async (args) => {
				createdArgs = args;
				return `/home/dev/${args.name}`;
			},
			openProject: () => 'gh-proj-id',
			getUseSsh: () => false,
			isWin: false
		};

		const res = await createRemoteProject('gh-project', { visibility: 'private' }, deps);
		assert.equal(res.projectId, 'gh-proj-id');
		assert.deepEqual(createdArgs, {
			parentDir: '/home/dev',
			name: 'gh-project',
			visibility: 'private',
			useSsh: false
		});
	});
});
