# Biolaris Media

[🇬🇧 English](README.md) | 🇮🇹 Italiano

Biolaris Media è un’applicazione desktop open source per convertire e comprimere file multimediali mantenendoli sul proprio computer. È realizzata con Tauri 2, React, TypeScript e Rust e include nel pacchetto gli strumenti multimediali utilizzati.

> **Stato del progetto:** Biolaris Media è in sviluppo attivo. Sono implementate le code di conversione e compressione audio/video. Gli strumenti per immagini e PDF, il ridimensionamento e l’estrazione/unione PDF non sono ancora collegati. L’opzione di qualità audio non è ancora applicata ai parametri del codec.

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

   Lo script non scarica release dal repository Biolaris. Scarica FFmpeg/FFprobe e Poppler dal catalogo pubblico [unpins](https://unpins.org/), ImageMagick dal distributore della piattaforma e, su Windows, libvips dal suo archivio upstream. Verifica gli SHA-256 pubblicati e conserva ogni runtime in `src-tauri/binaries/<target-triple>/`. Aggiungi `-- --force` per scaricare di nuovo il runtime. Esegui il download su un runner nativo per il target da compilare.

3. Avvia l’app desktop:

   ```sh
   npm run dev:tauri
   ```

Per compilare soltanto il frontend web, esegui `npm run build`. Gli script `dev:tauri` e `tauri:build` scaricano automaticamente il runtime se manca.

## Binari runtime e distribuzione

Prima di avviare Tauri, `binaries:stage` copia soltanto il runtime del target corrente in `src-tauri/binaries/runtime-current/`. La configurazione Tauri include quella directory, non l’intero archivio `binaries/`, quindi i binari per altri target non vengono inclusi. Il runtime contiene FFmpeg/FFprobe, ImageMagick (`magick`/`convert`) e Poppler (`pdftoppm`/`pdfunite`). Su Windows viene incluso anche libvips. Il progetto libvips non pubblica eseguibili standalone ufficiali per macOS o Linux; il codice applicativo attuale non usa il comando `vips`, quindi su questi sistemi viene omesso.

Gli script `dev:tauri` e `tauri:build` scaricano e preparano automaticamente il runtime nativo. GitHub Actions compila separatamente i pacchetti per Windows, macOS e Linux, in modo che ciascuno contenga soltanto i binari della propria piattaforma. ImageMagick per Linux è distribuito come AppImage x86_64. Il pacchetto standalone per macOS proviene da un distributore esterno e richiede macOS Sonoma o successivo. Le sorgenti, le versioni e gli hash scaricati sono registrati in `runtime-manifest.json`.

Prima di distribuire l’app, verifica le licenze di FFmpeg e dei codec inclusi, ImageMagick, libvips, Poppler e delle relative librerie incluse. La licenza MIT di questo repository non sostituisce né modifica le licenze dei programmi distribuiti.

## Contribuire

Bug report e proposte di funzionalità sono benvenuti tramite le [GitHub Issues](https://github.com/bispitalieri/biolaris/issues). Per modifiche più ampie, apri una issue per discutere l’approccio prima di inviare una pull request. Leggi la [guida per contribuire](CONTRIBUTING.md) e il [Codice di condotta](CODE_OF_CONDUCT.md).

## Sicurezza

Per segnalare vulnerabilità, segui le istruzioni in [SECURITY.md](SECURITY.md) invece di pubblicare dettagli sfruttabili in una issue pubblica.

## Licenza

Il codice di questo progetto è distribuito secondo i termini della [licenza MIT](LICENSE).
