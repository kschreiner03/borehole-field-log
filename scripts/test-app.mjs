// Runs tests/app/run.mjs in Electron. VS Code terminals set ELECTRON_RUN_AS_NODE, which stops Electron opening windows, so it is removed here.
import { spawnSync } from 'node:child_process';
import electron from 'electron';

const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const r = spawnSync(electron, ['tests/app/run.mjs'], { stdio: 'inherit', env });
process.exit(r.status ?? 1);
