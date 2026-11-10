// Mappatura dei file ai linguaggi supportati da Monaco (Gate R27 / PLAN W12).
//
// Modulo puro senza dipendenze DOM o worker Monaco, importabile sia nel guscio browser sia nei test Node.

function languageForExtension(ext: string | undefined): string | null {
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
	if (ext === 'mmd' || ext === 'mermaid') return 'markdown';
	if (ext === 'rs') return 'rust';
	if (ext === 'py') return 'python';
	if (ext === 'yaml' || ext === 'yml') return 'yaml';
	if (ext === 'toml' || ext === 'ini') return 'ini';
	if (ext === 'sh' || ext === 'bash' || ext === 'zsh') return 'shell';
	if (ext === 'ps1' || ext === 'psm1') return 'powershell';
	if (ext === 'bat' || ext === 'cmd') return 'bat';
	return null;
}

// Come il `firstLine` dei linguaggi di VS Code: un'estensione sconosciuta (.rli, .rdlc,
// .nuspec, script senza estensione...) viene riconosciuta dalla prima riga del contenuto.
function languageForFirstLine(content: string): string | null {
	const firstLine = content.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0].trim();
	if (/^<\?xml\b/i.test(firstLine)) return 'xml';
	if (/^<!doctype\s+html\b/i.test(firstLine) || /^<html\b/i.test(firstLine)) return 'html';
	if (/^<svg\b/i.test(firstLine)) return 'html';
	if (/^#!.*\b(?:node|bun|deno)\b/.test(firstLine)) return 'javascript';
	if (/^#!.*\bpython[0-9.]*\b/.test(firstLine)) return 'python';
	if (/^#!.*\b(?:ba|z|k|da)?sh\b/.test(firstLine)) return 'shell';
	return null;
}

export function languageForFile(path: string, content?: string): string {
	const name = path.split(/[\\/]/).pop() ?? path;
	const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() : undefined;
	return languageForExtension(ext) ?? (content ? languageForFirstLine(content) : null) ?? 'plaintext';
}
