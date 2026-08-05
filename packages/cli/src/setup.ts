/**
 * opencaptions setup & doctor — Python dependency management
 *
 * setup: installs Python venv + packages for backend-av
 * doctor: verifies all components are operational
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ============================================================================
// ANSI helpers (mirrored from index.ts)
// ============================================================================

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";

function print(msg: string) {
	console.log(msg);
}

function printError(msg: string) {
	console.error(`${RED}Error:${RESET} ${msg}`);
}

function printSuccess(msg: string) {
	print(`${GREEN}✓${RESET} ${msg}`);
}

function printWarn(msg: string) {
	print(`${YELLOW}!${RESET} ${msg}`);
}

function printInfo(msg: string) {
	print(`${DIM}i${RESET} ${msg}`);
}

// ============================================================================
// Paths
// ============================================================================

const OPENCAPTIONS_DIR = join(homedir(), ".opencaptions");
const VENV_DIR = join(OPENCAPTIONS_DIR, "venv");
const VENV_PYTHON = join(VENV_DIR, "bin", "python3");
const VENV_PIP = join(VENV_DIR, "bin", "pip");

// ============================================================================
// Utilities
// ============================================================================

/**
 * Run a command and capture stdout/stderr. Resolves with { code, stdout, stderr }.
 */
function runCommand(
	cmd: string,
	args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		const child = spawn(cmd, args, {
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env },
		});

		let stdout = "";
		let stderr = "";

		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		child.on("error", () => {
			resolve({ code: 127, stdout, stderr: stderr || "command not found" });
		});

		child.on("close", (code) => {
			resolve({ code: code ?? 1, stdout, stderr });
		});
	});
}

/**
 * Run a command and stream output directly to the terminal.
 * Returns exit code.
 */
function runCommandStreaming(cmd: string, args: string[]): Promise<number> {
	return new Promise((resolve) => {
		const child = spawn(cmd, args, {
			stdio: ["ignore", "inherit", "inherit"],
			env: { ...process.env },
		});

		child.on("error", () => {
			resolve(127);
		});

		child.on("close", (code) => {
			resolve(code ?? 1);
		});
	});
}

/**
 * Check if a Python module can be imported in the venv.
 */
async function canImport(module: string): Promise<boolean> {
	if (!existsSync(VENV_PYTHON)) return false;
	const result = await runCommand(VENV_PYTHON, ["-c", `import ${module}`]);
	return result.code === 0;
}

/**
 * Parse a version string like "Python 3.12.1" into [major, minor].
 */
function parsePythonVersion(versionStr: string): [number, number] | null {
	const match = versionStr.match(/Python\s+(\d+)\.(\d+)/);
	if (!match) return null;
	return [Number.parseInt(match[1], 10), Number.parseInt(match[2], 10)];
}

// ============================================================================
// setup command
// ============================================================================

const PYTHON_PACKAGES = [
	"openai-whisper",
	"pyannote.audio",
	"parselmouth",
	"librosa",
	"fer",
	"opencv-python-headless",
];

export async function cmdSetup(): Promise<void> {
	print(`\n${BOLD}OpenCaptions Setup${RESET}\n`);
	print(`${DIM}Installing Python dependencies for backend-av...${RESET}\n`);

	// ------------------------------------------------------------------
	// Step 1: Check Python 3.11+
	// ------------------------------------------------------------------
	print(`${CYAN}[1/6]${RESET} Checking Python...`);

	const pythonResult = await runCommand("python3", ["--version"]);
	if (pythonResult.code !== 0) {
		printError("Python 3 is not installed. Install Python 3.11+ from https://python.org");
		process.exit(2);
	}

	const versionOutput = (pythonResult.stdout + pythonResult.stderr).trim();
	const version = parsePythonVersion(versionOutput);
	if (!version) {
		printError(`Could not parse Python version from: ${versionOutput}`);
		process.exit(2);
	}

	const [major, minor] = version;
	if (major < 3 || (major === 3 && minor < 11)) {
		printError(`Python 3.11+ required, found ${major}.${minor}. Upgrade from https://python.org`);
		process.exit(2);
	}

	printSuccess(`Python ${major}.${minor} detected`);

	// ------------------------------------------------------------------
	// Step 2: Create venv
	// ------------------------------------------------------------------
	print(`${CYAN}[2/6]${RESET} Setting up virtual environment...`);

	if (existsSync(VENV_PYTHON)) {
		printSuccess(`Venv already exists at ${DIM}${VENV_DIR}${RESET}`);
	} else {
		const { mkdirSync } = await import("node:fs");
		mkdirSync(OPENCAPTIONS_DIR, { recursive: true });

		print(`  Creating venv at ${DIM}${VENV_DIR}${RESET}...`);
		const venvCode = await runCommandStreaming("python3", ["-m", "venv", VENV_DIR]);
		if (venvCode !== 0) {
			printError("Failed to create virtual environment");
			process.exit(2);
		}
		printSuccess("Virtual environment created");
	}

	// ------------------------------------------------------------------
	// Step 3: Upgrade pip
	// ------------------------------------------------------------------
	print(`${CYAN}[3/6]${RESET} Upgrading pip...`);

	const pipUpgrade = await runCommandStreaming(VENV_PYTHON, [
		"-m",
		"pip",
		"install",
		"--upgrade",
		"pip",
	]);
	if (pipUpgrade !== 0) {
		printWarn("pip upgrade failed — continuing with existing pip");
	} else {
		printSuccess("pip is up to date");
	}

	// ------------------------------------------------------------------
	// Step 4: Install Python packages
	// ------------------------------------------------------------------
	print(`${CYAN}[4/6]${RESET} Installing Python packages...\n`);

	for (const pkg of PYTHON_PACKAGES) {
		const importName =
			pkg === "openai-whisper"
				? "whisper"
				: pkg === "opencv-python-headless"
					? "cv2"
					: pkg === "pyannote.audio"
						? "pyannote.audio"
						: pkg;

		const alreadyInstalled = await canImport(importName);
		if (alreadyInstalled) {
			printSuccess(`${pkg} — already installed`);
			continue;
		}

		print(`  Installing ${BOLD}${pkg}${RESET}...`);
		const code = await runCommandStreaming(VENV_PIP, ["install", pkg, "--quiet"]);
		if (code !== 0) {
			printError(`Failed to install ${pkg}`);
			printInfo(`Try manually: ${DIM}${VENV_PIP} install ${pkg}${RESET}`);
		} else {
			printSuccess(`${pkg} installed`);
		}
	}

	// ------------------------------------------------------------------
	// Step 5: Check Ollama
	// ------------------------------------------------------------------
	print(`\n${CYAN}[5/6]${RESET} Checking Ollama (optional)...`);

	const ollamaResult = await runCommand("ollama", ["--version"]);
	if (ollamaResult.code !== 0) {
		printWarn("Ollama not found — optional, used for local LLM intent extraction");
		printInfo(`Install from ${CYAN}https://ollama.com${RESET}`);
	} else {
		const ollamaVersion = (ollamaResult.stdout + ollamaResult.stderr).trim();
		printSuccess(`Ollama found: ${DIM}${ollamaVersion}${RESET}`);
	}

	// ------------------------------------------------------------------
	// Step 6: Whisper model info
	// ------------------------------------------------------------------
	print(`${CYAN}[6/6]${RESET} Whisper model info...`);

	const whisperInstalled = await canImport("whisper");
	if (whisperInstalled) {
		// Check if models are cached
		const whisperCacheDir = join(homedir(), ".cache", "whisper");
		if (existsSync(whisperCacheDir)) {
			printSuccess("Whisper model cache directory exists");
		} else {
			printInfo("Whisper models will be downloaded on first use");
		}
		printInfo(`The ${BOLD}large-v3${RESET} model is recommended (~3 GB download)`);
		printInfo(`Models are cached at ${DIM}~/.cache/whisper/${RESET}`);
	} else {
		printWarn("Whisper not yet installed — run setup again or install manually");
	}

	// ------------------------------------------------------------------
	// Summary
	// ------------------------------------------------------------------
	print(`\n${GREEN}${BOLD}Setup complete!${RESET}\n`);
	print(`Run ${BOLD}opencaptions doctor${RESET} to verify all components.\n`);
}

// ============================================================================
// doctor command
// ============================================================================

interface CheckResult {
	name: string;
	ok: boolean;
	detail: string;
	optional?: boolean;
}

export async function cmdDoctor(): Promise<void> {
	print(`\n${BOLD}OpenCaptions Doctor${RESET}\n`);

	const checks: CheckResult[] = [];

	// ------------------------------------------------------------------
	// 1. Python 3.11+
	// ------------------------------------------------------------------
	{
		const result = await runCommand("python3", ["--version"]);
		const versionStr = (result.stdout + result.stderr).trim();
		const version = parsePythonVersion(versionStr);
		if (result.code !== 0 || !version) {
			checks.push({
				name: "Python 3.11+",
				ok: false,
				detail: "not found",
			});
		} else {
			const [major, minor] = version;
			const ok = major >= 3 && minor >= 11;
			checks.push({
				name: "Python 3.11+",
				ok,
				detail: ok ? `${major}.${minor}` : `${major}.${minor} (need 3.11+)`,
			});
		}
	}

	// ------------------------------------------------------------------
	// 2. OpenCaptions venv
	// ------------------------------------------------------------------
	{
		const ok = existsSync(VENV_PYTHON);
		checks.push({
			name: "OpenCaptions venv",
			ok,
			detail: ok ? VENV_DIR : `not found at ${VENV_DIR}`,
		});
	}

	// ------------------------------------------------------------------
	// 3-6. Python packages
	// ------------------------------------------------------------------
	const pythonModules: Array<[string, string]> = [
		["whisper", "whisper"],
		["pyannote", "pyannote.audio"],
		["parselmouth", "parselmouth"],
		["librosa", "librosa"],
	];

	for (const [label, importPath] of pythonModules) {
		const ok = await canImport(importPath);
		checks.push({
			name: label,
			ok,
			detail: ok ? "importable" : "not installed",
		});
	}

	// ------------------------------------------------------------------
	// 7. Ollama (optional)
	// ------------------------------------------------------------------
	{
		const result = await runCommand("ollama", ["--version"]);
		const ok = result.code === 0;
		const version = (result.stdout + result.stderr).trim();
		checks.push({
			name: "Ollama",
			ok,
			detail: ok ? version : "not installed (optional)",
			optional: true,
		});
	}

	// ------------------------------------------------------------------
	// 8. FFmpeg
	// ------------------------------------------------------------------
	{
		const result = await runCommand("ffmpeg", ["-version"]);
		const ok = result.code === 0;
		let detail = "not found";
		if (ok) {
			const firstLine = (result.stdout + result.stderr).split("\n")[0] ?? "";
			const versionMatch = firstLine.match(/ffmpeg version (\S+)/);
			detail = versionMatch ? `version ${versionMatch[1]}` : "installed";
		}
		checks.push({
			name: "FFmpeg",
			ok,
			detail,
		});
	}

	// ------------------------------------------------------------------
	// Report
	// ------------------------------------------------------------------
	print(`${BOLD}Component Status${RESET}\n`);

	for (const check of checks) {
		const icon = check.ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
		const optionalTag = check.optional && !check.ok ? ` ${DIM}(optional)${RESET}` : "";
		print(`  ${icon} ${BOLD}${check.name}${RESET} — ${check.detail}${optionalTag}`);
	}

	const requiredChecks = checks.filter((c) => !c.optional);
	const passedRequired = requiredChecks.filter((c) => c.ok).length;
	const totalRequired = requiredChecks.length;

	const allOptional = checks.filter((c) => c.optional);
	const passedOptional = allOptional.filter((c) => c.ok).length;

	print("");

	if (passedRequired === totalRequired) {
		print(
			`${GREEN}${BOLD}All ${passedRequired} required components ready.${RESET}${
				passedOptional < allOptional.length
					? ` ${DIM}(${passedOptional}/${allOptional.length} optional)${RESET}`
					: ""
			}`,
		);
	} else {
		print(
			`${YELLOW}${passedRequired} of ${totalRequired} required components ready.${RESET} ` +
				`Run ${BOLD}opencaptions setup${RESET} to install missing components.`,
		);
	}

	print("");
}
