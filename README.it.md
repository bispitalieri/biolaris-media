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
   git clone https://github.com/bispitalieri/biolaris.git
   cd biolaris
   npm ci
   ```

2. Scarica i binari per il sistema corrente:

   ```sh
   npm run binaries:download
   ```

   Lo script scarica gli strumenti dai rispettivi distributori: FFmpeg/FFprobe e Poppler dal catalogo pubblico [unpins](https://unpins.org/), ImageMagick dal distributore della piattaforma e, su Windows, libvips dal suo archivio upstream. Verifica gli hash SHA-256 pubblicati e salva i file in `src-tauri/binaries/<target-triple>/`. Aggiungi `-- --force` per scaricarli di nuovo. Compila l’app sullo stesso tipo di sistema della piattaforma di destinazione.

3. Avvia l’app desktop:

   ```sh
   npm run dev:tauri
   ```

Per compilare soltanto il frontend web, esegui `npm run build`. I comandi `dev:tauri` e `tauri:build` scaricano gli strumenti se non sono già presenti.

## Binari runtime e distribuzione

Prima che Tauri si avvii, `binaries:stage` copia gli strumenti per il sistema in uso in `src-tauri/binaries/runtime-current/`. Tauri include quella cartella nel pacchetto, lasciando fuori i binari per altre piattaforme. La cartella contiene FFmpeg/FFprobe, ImageMagick (`magick`/`convert`) e Poppler (`pdftoppm`/`pdfunite`). Le versioni per Windows includono anche libvips. Per macOS e Linux non esistono versioni standalone ufficiali di libvips e l’app al momento non usa il comando `vips`, quindi non viene incluso.

I comandi `dev:tauri` e `tauri:build` scaricano e preparano automaticamente gli strumenti. GitHub Actions compila pacchetti separati per Windows, macOS e Linux, ciascuno con i binari necessari alla propria piattaforma. La versione Linux usa un’AppImage x86_64 di ImageMagick. Il pacchetto standalone per macOS proviene da un distributore esterno e richiede macOS Sonoma o successivo. In `runtime-manifest.json` trovi sorgenti, versioni e hash dei download.

Prima di condividere o distribuire l’app, controlla le licenze di FFmpeg e dei suoi codec, ImageMagick, libvips, Poppler e delle librerie incluse. La licenza MIT di questo repository non copre questi programmi separati.

## Contribuire

Hai trovato un bug o hai un’idea? Scrivici tramite le [GitHub Issues](https://github.com/bispitalieri/biolaris/issues). Per una modifica più ampia, apri prima una issue così possiamo discuterne insieme. Prima di iniziare, consulta la [guida per contribuire](CONTRIBUTING.md) e il [Codice di condotta](CODE_OF_CONDUCT.md).

## Sicurezza

Se trovi una vulnerabilità, segui le istruzioni in [SECURITY.md](SECURITY.md). Non pubblicare in una issue dettagli che potrebbero essere usati per sfruttarla.

## Licenza

Il codice di Biolaris Media è disponibile secondo i termini della [licenza MIT](LICENSE).
