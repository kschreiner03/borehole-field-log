// Starts electron-vite dev. VS Code sets ELECTRON_RUN_AS_NODE for processes it launches,
// which makes Electron start as plain Node and the app crash on its first import, so clear it here.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

delete process.env.ELECTRON_RUN_AS_NODE;
// Electron 45+ downloads its binary the first time the package is loaded, not at npm install; electron-vite only looks
// for the file and stops with "Electron uninstall", so load it here once to fetch it after a fresh install
createRequire(import.meta.url)('electron');
const child = spawn('electron-vite', ['dev', ...process.argv.slice(2)], { stdio: 'inherit', shell: true });
child.on('exit', (code) => process.exit(code ?? 1));
