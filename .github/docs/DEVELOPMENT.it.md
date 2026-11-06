# Sviluppo e build

[English](DEVELOPMENT.md) | [Italiano](DEVELOPMENT.it.md)

## Prerequisiti

- Node.js (il workflow CI usa Node.js 24) e npm
- Rust stable e Cargo
- Prerequisiti nativi di sviluppo Tauri 2 per il sistema operativo host
- Connessione Internet per scaricare i binari runtime specifici della piattaforma durante la configurazione desktop

Il workflow di release elenca i pacchetti Linux usati nelle build CI in [`.github/workflows/release.yml`](../workflows/release.yml). Compila l’app su un host supportato: Windows x64, macOS Intel/Apple silicon o Linux x64.

## Installare e avviare

```sh
git clone https://github.com/bispitalieri/biolaris-media.git
cd biolaris-media
npm ci
npm run dev:tauri
```

`dev:tauri` scarica il runtime corrispondente, lo prepara per Tauri e avvia l’app desktop in sviluppo. Per eseguire separatamente la preparazione del runtime:

```sh
npm run binaries:download
npm run binaries:stage
```

Per compilare soltanto il frontend, esegui `npm run build`. Per creare il bundle desktop per l’host corrente, esegui `npm run tauri:build`.

## Strumenti runtime

Il downloader cerca prima un bundle runtime compatibile e verificato tramite checksum nella release `runtime-latest` di [bispitalieri/biolaris-runtime](https://github.com/bispitalieri/biolaris-runtime/releases). Se non è disponibile un bundle compatibile, lo script scarica e verifica singolarmente gli strumenti configurati. Il runtime include FFmpeg/FFprobe, ImageMagick, le utility Poppler e `yt-dlp`. I runtime Windows includono anche libvips, che l’app attuale non esegue.

Prima dei comandi di sviluppo o build Tauri, l’app prepara i soli binari per la piattaforma host in `src-tauri/binaries/runtime-current/`. Non includere nel repository i binari runtime scaricati.

## Panoramica dell’architettura

- L’interfaccia React/TypeScript espone ogni strumento in una schermata e invoca il backend Rust tramite i comandi Tauri.
- Rust convalida percorsi e richieste, quindi esegue le attività in coda e invia eventi di avanzamento all’interfaccia.
- FFmpeg gestisce operazioni audio/video e conversioni raster comuni; ImageMagick gestisce conversioni e ritagli delle immagini; Poppler genera anteprime delle pagine PDF. Librerie Rust si occupano di modifica PDF, creazione di PDF da immagini, tracciatura vettoriale e generazione di risorse icona.
- La rimozione dello sfondo gira nel frontend con ONNX Runtime WebAssembly. Al primo utilizzo scarica il modello BiRefNet Lite fissato a una revisione; l’inferenza viene poi eseguita localmente sulla CPU.

Per contribuire al codice, segui la [guida per contribuire](../CONTRIBUTING.md). Il workflow CI esegue `npm ci` e `npm run build`; per le modifiche Rust, esegui anche:

```sh
cargo check --manifest-path src-tauri/Cargo.toml
```
