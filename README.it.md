# Biolaris Media

[🇬🇧 English](README.md) | 🇮🇹 Italiano

Biolaris Media è un’applicazione desktop open source per convertire e comprimere file multimediali sul proprio computer. È realizzata con Tauri 2, React, TypeScript e Rust e include gli strumenti necessari per lavorare con i file.

> **Stato del progetto:** Biolaris Media è ancora in sviluppo. Puoi convertire e comprimere file audio e video. Gli strumenti per immagini e PDF, il ridimensionamento e l’estrazione e l’unione dei PDF sono ancora in lavorazione. L’opzione di qualità audio non modifica ancora le impostazioni del codec.

## Requisiti

- Node.js e npm
- Rust e Cargo
- Prerequisiti di sviluppo Tauri 2 per la piattaforma in uso
- Connessione Internet per il primo download dei binari multimediali

Consulta la [guida ufficiale Tauri per i prerequisiti](https://v2.tauri.app/start/prerequisites/) del tuo sistema operativo.

## Avvio in sviluppo

1. Clona il repository e installa le dipendenze:

   ```sh
   git clone https://github.com/bispitalieri/biolaris-media.git
   cd biolaris-media
   npm ci
   ```

2. Scarica i binari per il sistema corrente:

   ```sh
   npm run binaries:download
   ```

   Lo script scarica e verifica prima il bundle della piattaforma dalla release `runtime-latest` di [bispitalieri/biolaris-runtime](https://github.com/bispitalieri/biolaris-runtime/releases). Se il bundle per quella piattaforma non è pubblicato, scarica gli strumenti dai rispettivi distributori: FFmpeg/FFprobe e Poppler dal catalogo pubblico [unpins](https://unpins.org/), ImageMagick dal distributore della piattaforma e, su Windows, libvips dal suo archivio upstream. Salva i file in `src-tauri/binaries/<target-triple>/`. Aggiungi `-- --force` per scaricarli di nuovo. Compila l’app sullo stesso tipo di sistema della piattaforma di destinazione.

3. Avvia l’app desktop:

   ```sh
   npm run dev:tauri
   ```

Per compilare soltanto il frontend web, esegui `npm run build`. I comandi `dev:tauri` e `tauri:build` scaricano gli strumenti se non sono già presenti.

## Binari runtime e distribuzione

Prima che Tauri si avvii, `binaries:stage` copia gli strumenti per il sistema in uso in `src-tauri/binaries/runtime-current/`. Tauri include quella cartella nel pacchetto, lasciando fuori i binari per altre piattaforme. La cartella contiene FFmpeg/FFprobe, ImageMagick (`magick`/`convert`) e Poppler (`pdftoppm`/`pdfunite`). Gli alias che condividono un eseguibile vengono creati nella cache utente all’avvio invece di essere inclusi come file duplicati. Le versioni per Windows includono anche libvips. Per macOS e Linux non esistono versioni standalone ufficiali di libvips e l’app al momento non usa il comando `vips`, quindi non viene incluso.

I comandi `dev:tauri` e `tauri:build` scaricano e preparano automaticamente gli strumenti. Il workflow GitHub Actions indipendente di [biolaris-runtime](https://github.com/bispitalieri/biolaris-runtime) genera runtime nativi per Windows, macOS e Linux e li pubblica nella release prerelease `runtime-latest`, così le build dell’app possono riutilizzare i bundle verificati. Il workflow viene eseguito ogni settimana, quando cambia il progetto runtime e manualmente dalla scheda Actions di quel repository. La versione Linux usa un’AppImage x86_64 di ImageMagick. Il pacchetto standalone per macOS proviene da un distributore esterno e richiede macOS Sonoma o successivo. In `runtime-manifest.json` trovi sorgenti, versioni e hash dei download.

Per pubblicare una release, invia un tag semantico stabile, ad esempio `v1.2.3`. GitHub Actions usa il tag come versione dell’app, crea pacchetti firmati per l’aggiornamento, prepara la release come bozza e la pubblica solo dopo aver caricato tutti i pacchetti Windows, macOS e Linux e `latest.json`. Per aggiornare localmente tutte le versioni dell’app presenti nel repository, esegui `npm run version:update -- 1.2.3`.

La chiave pubblica per gli aggiornamenti è configurata in `src-tauri/tauri.conf.json`; la chiave privata corrispondente e la password devono essere disponibili a GitHub Actions come `TAURI_SIGNING_PRIVATE_KEY` e `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Non inserire la chiave privata nel repository e non sostituire la coppia di chiavi senza motivo: le installazioni esistenti si fidano della chiave pubblica configurata. Per un nuovo repository, genera una chiave con `npm run tauri -- signer generate -w ~/.tauri/biolaris.key`, configura la chiave pubblica e salva la chiave privata e la password nei segreti Actions. Le build con tag si interrompono se manca la configurazione di firma.

La firma e la notarizzazione Apple sono facoltative. Senza i segreti Apple, le release con tag includono build macOS non firmate; macOS potrebbe mostrare un avviso di sicurezza e l’utente potrebbe dover fare clic destro sull’app, tenere premuto Ctrl e scegliere **Apri**. In futuro, aggiungi ai segreti GitHub Actions `APPLE_CERTIFICATE` (certificato Developer ID `.p12` codificato in base64), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `KEYCHAIN_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD` (password specifica per l’app) e `APPLE_TEAM_ID`. Quando `APPLE_CERTIFICATE` è presente, il workflow richiede tutti i valori, importa il certificato, firma l’app macOS e la invia per la notarizzazione.

La versione pubblicata `v0.1.0` non include il sistema di aggiornamento. Chi usa quella versione deve installare manualmente la prima release che include l’updater; le versioni successive potranno aggiornarsi dall’app.

Prima di condividere o distribuire l’app, controlla le licenze di FFmpeg e dei suoi codec, ImageMagick, libvips, Poppler e delle librerie incluse. La licenza AGPL di questo repository non copre questi programmi separati.

## Contribuire

Hai trovato un bug o hai un’idea? Scrivici tramite le [GitHub Issues](https://github.com/bispitalieri/biolaris-media/issues). Per una modifica più ampia, apri prima una issue così possiamo discuterne insieme. Prima di iniziare, consulta la [guida per contribuire](CONTRIBUTING.md) e il [Codice di condotta](CODE_OF_CONDUCT.md).

## Sicurezza

Se trovi una vulnerabilità, segui le istruzioni in [SECURITY.md](SECURITY.md). Non pubblicare in una issue dettagli che potrebbero essere usati per sfruttarla.

## Licenza

Il codice di Biolaris Media è disponibile secondo i termini della [GNU Affero General Public License v3.0](LICENSE).
