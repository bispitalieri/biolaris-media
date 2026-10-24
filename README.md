# Biolaris Media

Biolaris Media è un’applicazione desktop open source per convertire e comprimere file multimediali mantenendoli sul proprio computer. È realizzata con Tauri 2, React, TypeScript e Rust; FFmpeg e FFprobe vengono eseguiti come sidecar.

> Il progetto è in sviluppo. Al momento sono implementate le code di conversione e compressione audio/video. Le funzioni per immagini e PDF, il ridimensionamento e l’estrazione/unione PDF non sono ancora collegate. L’opzione di qualità audio non è ancora applicata ai parametri del codec.

## Requisiti

- Node.js e npm
- Rust e Cargo
- Prerequisiti di sviluppo Tauri 2 per la piattaforma in uso (toolchain e librerie di sistema)
- Sidecar FFmpeg e FFprobe compatibili con il target, collocati in `src-tauri/binaries/`

Consulta la [guida ufficiale Tauri per i prerequisiti](https://v2.tauri.app/start/prerequisites/) del tuo sistema.

## Avvio in sviluppo

1. Clona il repository e installa le dipendenze:

   ```sh
   git clone https://github.com/biolaris/biolaris.git
   cd biolaris
   npm ci
   ```

2. Inserisci in `src-tauri/binaries/` i sidecar `ffmpeg` e `ffprobe` per il target corrente. I nomi devono includere il target triple Rust, per esempio `ffmpeg-aarch64-apple-darwin` e `ffprobe-aarch64-apple-darwin`. Su Windows aggiungi `.exe`.

3. Avvia l’app:

   ```sh
   npm run dev:tauri
   ```

Per compilare la parte web usa `npm run build`. Per creare il pacchetto desktop usa `npm run tauri build`, fornendo prima i sidecar richiesti.

## Sidecar e distribuzione

La configurazione Tauri include `binaries/ffmpeg` e `binaries/ffprobe` come binari esterni. Per ogni piattaforma di rilascio occorrono i binari con il suffisso target triple corretto, ad esempio `x86_64-pc-windows-msvc` o `x86_64-unknown-linux-gnu`. I binari non sono inclusi nel repository: `src-tauri/binaries/` è esclusa da Git.

Prima di distribuire una build, verifica le licenze di FFmpeg e dei codec effettivamente inclusi, oltre alle licenze di eventuali pacchetti binari usati. La licenza MIT di questo repository non sostituisce né modifica quelle delle dipendenze e dei codec.

## Contribuire

Segnala bug e proponi funzionalità tramite le [GitHub Issues](https://github.com/biolaris/biolaris/issues). Per modifiche più ampie, apri una issue per discutere l’approccio e poi invia una pull request. Leggi [CONTRIBUTING.md](CONTRIBUTING.md) e il [Codice di condotta](CODE_OF_CONDUCT.md).

## Sicurezza

Per segnalazioni di vulnerabilità, segui le istruzioni in [SECURITY.md](SECURITY.md) invece di pubblicare dettagli sfruttabili in una issue pubblica.

## Licenza

Il codice di questo progetto è distribuito secondo i termini della [licenza MIT](LICENSE).
