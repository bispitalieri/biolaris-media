// Script per bumpare automaticamente la versione semver.
// Esegui: npm run version:bump patch|minor|major
//
// Legge la versione corrente da package.json, calcola la nuova versione
// in base al tipo di bump e la applica tramite set-version.mjs.

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const bumpType = process.argv[2];

if (!bumpType || !['patch', 'minor', 'major'].includes(bumpType)) {
  console.error('Errore: specifica il tipo di bump (patch, minor, major).');
  console.error('Esempio: npm run version:bump patch');
  process.exit(1);
}

const packageJson = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
const currentVersion = packageJson.version;

const [major, minor, patch] = currentVersion.split('.').map(Number);

let newVersion;
switch (bumpType) {
  case 'patch':
    newVersion = `${major}.${minor}.${patch + 1}`;
    break;
  case 'minor':
    newVersion = `${major}.${minor + 1}.0`;
    break;
  case 'major':
    newVersion = `${major + 1}.0.0`;
    break;
}

console.log(`Versione corrente: ${currentVersion}`);
console.log(`Tipo di bump: ${bumpType}`);
console.log(`Nuova versione: ${newVersion}\n`);

try {
  execSync(`node scripts/set-version.mjs ${newVersion}`, {
    cwd: rootDir,
    stdio: 'inherit',
  });
  console.log(`\n✅ Version bump completato: ${currentVersion} → ${newVersion}`);
} catch {
  console.error('\n❌ Errore: version bump fallito.');
  process.exit(1);
}
