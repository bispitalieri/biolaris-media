# Biolaris Media

Biolaris Media è un’applicazione desktop open source per convertire e comprimere file multimediali mantenendoli sul proprio computer. È realizzata con Tauri 2, React, TypeScript e Rust; gli strumenti multimediali vengono inclusi nel pacchetto dell’applicazione.

> Il progetto è in sviluppo. Al momento sono implementate le code di conversione e compressione audio/video. Le funzioni per immagini e PDF, il ridimensionamento e l’estrazione/unione PDF non sono ancora collegate. L’opzione di qualità audio non è ancora applicata ai parametri del codec.

## Requisiti

- Node.js e npm
- Rust e Cargo
- Prerequisiti di sviluppo Tauri 2 per la piattaforma in uso (toolchain e librerie di sistema)
- Connessione Internet al primo download dei binari

Consulta la [guida ufficiale Tauri per i prerequisiti](https://v2.tauri.app/start/prerequisites/) del tuo sistema.

## Avvio in sviluppo

1. Clona il repository e installa le dipendenze:

   ```sh
   git clone https://github.com/biolaris/biolaris.git
   cd biolaris
   npm ci
   ```

2. Scarica i binari per il sistema corrente:

   ```sh
   npm run binaries:download
   ```

   Lo script non cerca release nel repository Biolaris. Scarica separatamente FFmpeg/FFprobe e Poppler dal catalogo pubblico [unpins](https://unpins.org/), ImageMagick dal distributore del sistema e, su Windows, libvips dal suo archivio upstream. Verifica gli SHA-256 pubblicati e conserva ogni runtime in `src-tauri/binaries/<target-triple>/`. Usa `npm run binaries:download -- --force` per scaricarli di nuovo. Il download va eseguito su un runner nativo per il target da compilare.

3. Avvia l’app:

   ```sh
   npm run dev:tauri
   ```

Per compilare la parte web usa `npm run build`. `npm run dev:tauri` e `npm run tauri:build` scaricano automaticamente il runtime se non è già presente.

## Binari e distribuzione

Prima di avviare Tauri, `binaries:stage` copia in `src-tauri/binaries/runtime-current/` solo il runtime del target corrente. La configurazione Tauri include quella directory, non l’intero archivio `binaries/`: gli altri target non entrano nel pacchetto. Il runtime contiene FFmpeg/FFprobe, ImageMagick (`magick`/`convert`) e Poppler (`pdftoppm`/`pdfunite`). Su Windows viene incluso anche libvips. Il progetto libvips non pubblica eseguibili standalone ufficiali per macOS/Linux; il comando `vips` non è usato dal codice applicativo attuale e viene omesso su questi sistemi.

`npm run dev:tauri` e `npm run tauri:build` scaricano e preparano automaticamente il runtime nativo. Il workflow GitHub Actions compila separatamente Windows, macOS e Linux, così ogni pacchetto contiene solo i propri binari. ImageMagick per Linux è distribuito come AppImage x86_64; il pacchetto macOS autonomo è fornito da un distributore esterno e richiede macOS Sonoma o successivo. Le sorgenti, le versioni e gli hash scaricati sono registrati in `runtime-manifest.json`.

Prima della distribuzione verifica le licenze di FFmpeg e dei codec inclusi, ImageMagick, libvips, Poppler e delle librerie incluse. La licenza MIT di questo repository non sostituisce né modifica quelle dei programmi distribuiti.

## Contribuire

Segnala bug e proponi funzionalità tramite le [GitHub Issues](https://github.com/biolaris/biolaris/issues). Per modifiche più ampie, apri una issue per discutere l’approccio e poi invia una pull request. Leggi [CONTRIBUTING.md](CONTRIBUTING.md) e il [Codice di condotta](CODE_OF_CONDUCT.md).

## Sicurezza

Per segnalazioni di vulnerabilità, segui le istruzioni in [SECURITY.md](SECURITY.md) invece di pubblicare dettagli sfruttabili in una issue pubblica.

## Licenza

Il codice di questo progetto è distribuito secondo i termini della [licenza MIT](LICENSE).
