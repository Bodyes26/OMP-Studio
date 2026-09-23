// Mappatura delle estensioni dei file ai linguaggi supportati da Monaco (Gate R27 / PLAN W12).
//
// Modulo puro senza dipendenze DOM o worker Monaco, importabile sia nel guscio browser sia nei test Node.

export function languageForFile(path: string): string {
	const ext = path.split('.').pop()?.toLowerCase();
	if (ext === 'sql') return 'sql';
	if (ext === 'ts' || ext === 'tsx') return 'typescript';
	if (ext === 'js' || ext === 'jsx' || ext === 'mjs' || ext === 'cjs') return 'javascript';
	if (ext === 'json' || ext === 'jsonc') return 'json';
	if (ext === 'css') return 'css';
	if (ext === 'scss') return 'scss';
	if (ext === 'less') return 'less';
	if (ext === 'html' || ext === 'aspx' || ext === 'ascx' || ext === 'ashx' || ext === 'svg') return 'html';
	if (ext === 'xml' || ext === 'config' || ext === 'csproj' || ext === 'vbproj' || ext === 'props' || ext === 'targets' || ext === 'resx' || ext === 'xaml') return 'xml';
	if (ext === 'vb') return 'vb';
	if (ext === 'cs') return 'csharp';
	if (ext === 'md' || ext === 'markdown') return 'markdown';
	if (ext === 'rs') return 'rust';
	if (ext === 'py') return 'python';
	if (ext === 'yaml' || ext === 'yml') return 'yaml';
	if (ext === 'toml' || ext === 'ini') return 'ini';
	if (ext === 'sh' || ext === 'bash' || ext === 'zsh') return 'shell';
	if (ext === 'ps1' || ext === 'psm1') return 'powershell';
	if (ext === 'bat' || ext === 'cmd') return 'bat';
	return 'plaintext';
}
