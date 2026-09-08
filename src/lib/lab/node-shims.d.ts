// Dichiarazioni ambientali minime per i moduli Node usati nel Laboratorio in ambiente di sviluppo/test.

declare const process: {
	env: Record<string, string | undefined>;
	platform: string;
	arch: string;
	cwd(): string;
	versions?: Record<string, string>;
};

declare const Buffer: {
	from(data: any, encoding?: string): { toString(enc?: string): string };
};

declare module 'node:child_process' {
	export interface ChildProcess {
		pid?: number;
		kill(signal?: string): boolean;
		on(event: 'exit', listener: (code: number | null, signal: string | null) => void): this;
		on(event: 'error', listener: (err: any) => void): this;
		stdout: any;
		stderr: any;
	}
	export function spawn(command: string, args?: readonly string[], options?: any): ChildProcess;
	export function execSync(command: string, options?: any): any;
}

declare module 'node:fs' {
	export function existsSync(path: string): boolean;
	export function readdirSync(path: string, options?: any): any[];
	export function readFileSync(path: string, options?: any): any;
	export function writeFileSync(path: string, data: any, options?: any): void;
	export function mkdirSync(path: string, options?: any): any;
	export function rmSync(path: string, options?: any): void;
	export function statSync(path: string): { isDirectory(): boolean; size: number };
	export function chmodSync(path: string, mode: number | string): void;
	export function createWriteStream(path: string, options?: any): any;
}

declare module 'node:path' {
	export function join(...paths: string[]): string;
	export function resolve(...paths: string[]): string;
	export function dirname(path: string): string;
	export function basename(path: string, ext?: string): string;
}

declare module 'node:os' {
	export function homedir(): string;
	export function tmpdir(): string;
	export function platform(): string;
	export function arch(): string;
}

declare module 'node:crypto' {
	export function randomUUID(): string;
	export function createHash(algorithm: string): any;
}

declare module 'node:https' {
	export function get(url: string | URL, options?: any, callback?: (res: any) => void): any;
	export function get(url: string | URL, callback?: (res: any) => void): any;
}
