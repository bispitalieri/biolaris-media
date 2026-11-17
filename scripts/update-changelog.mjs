// Script per aggiornare CHANGELOG.md in locale usando git-cliff.
// Esegui: npm run changelog:update
//
// Utilizza git-cliff (installato come devDependency npm) con la
// configurazione di default per generare il changelog completo
// da tutti i tag fino a HEAD.

import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

console.log('Aggiornamento di CHANGELOG.md...\n');

try {
  execSync('npx git-cliff --output CHANGELOG.md', {
    cwd: rootDir,
    stdio: 'inherit',
  });
  console.log('\n✅ CHANGELOG.md aggiornato con successo.');
} catch {
  console.error('\n❌ Errore: generazione del changelog fallita.');
  console.error('Assicurati che le dipendenze siano installate (npm install).');
  process.exit(1);
}
