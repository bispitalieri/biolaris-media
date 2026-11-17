// Script che automatizza l'intero flusso di release.
// Esegui: npm run release patch|minor|major
//
// Esegue in sequenza:
// 1. Verifica che il branch sia pulito e sia main
// 2. Bumpa la versione (patch/minor/major)
// 3. Aggiorna il CHANGELOG
// 4. Commit di tutte le modifiche
// 5. Crea il tag di release
// 6. Si ferma prima del push — l'utente deve eseguire manualmente git push && git push --tags

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
  console.error('Esempio: npm run release patch');
  process.exit(1);
}

function run(command, { cwd = rootDir, capture = false } = {}) {
  try {
    const result = execSync(command, { cwd, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
    return result;
  } catch (error) {
    return null;
  }
}

// --- Step 1: Verifica branch e stato pulito ---
console.log('📋 Verifica dello stato del repository...\n');

const currentBranch = run('git branch --show-current', { capture: true });
if (currentBranch?.trim() !== 'main') {
  console.error(`❌ Errore: devi essere sul branch main. Branch corrente: ${currentBranch?.trim()}`);
  console.error('Esegui: git checkout main');
  process.exit(1);
}

const status = run('git status --porcelain', { capture: true });
if (status && status.trim()) {
  console.error('❌ Errore: il branch ha modifiche non commitate.');
  console.error('Esegui: git add . && git commit -m "msg" prima di rilasciare.');
  process.exit(1);
}
console.log('✅ Branch: main, stato: pulito\n');

// --- Step 2: Leggi versione corrente e calcola la nuova ---
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

// --- Step 3: Bumpa la versione ---
console.log(`🔨 Version bump: ${currentVersion} → ${newVersion} (${bumpType})\n`);
try {
  execSync(`node scripts/set-version.mjs ${newVersion}`, { cwd: rootDir, stdio: 'inherit' });
} catch {
  console.error('\n❌ Errore: version bump fallito.');
  process.exit(1);
}

// --- Step 4: Aggiorna CHANGELOG ---
console.log('\n📝 Aggiornamento di CHANGELOG.md...\n');
try {
  execSync('npx git-cliff --output CHANGELOG.md', { cwd: rootDir, stdio: 'inherit' });
} catch {
  console.error('\n❌ Errore: generazione del changelog fallita.');
  process.exit(1);
}
console.log('\n✅ CHANGELOG.md aggiornato.');

// --- Step 5: Commit ---
const tag = `v${newVersion}`;
const commitMessage = `chore: release ${tag}`;
console.log(`\n📦 Commit delle modifiche...\n`);

run('git add .');
run(`git commit -m "${commitMessage}"`);
console.log(`✅ Commit creato: ${commitMessage}\n`);

// --- Step 6: Crea il tag ---
console.log(`🏷️  Creazione del tag ${tag}...\n`);
run(`git tag ${tag}`);
console.log(`✅ Tag ${tag} creato.\n`);

// --- Riepilogo ---
console.log('═══════════════════════════════════════════════════════');
console.log(`  Release ${tag} preparata con successo!`);
console.log('═══════════════════════════════════════════════════════');
console.log();
console.log('  Modifiche pronte:');
console.log(`    - Versione bumpata: ${currentVersion} → ${newVersion}`);
console.log(`    - CHANGELOG.md aggiornato`);
console.log(`    - Commit: "${commitMessage}"`);
console.log(`    - Tag: ${tag}`);
console.log();
console.log('  Per pubblicare la release, esegui manualmente:');
console.log();
console.log(`    git push && git push --tags`);
console.log();
console.log('  Il workflow release.yml partirà automaticamente sul tag.');
console.log();
