# Biolaris

Biolaris è una base desktop locale con Tauri v2, React/TypeScript e Rust. La coda attuale dimostra conversioni audio/video tramite sidecar FFmpeg e un numero massimo di task concorrenti pari ai core logici. Il frontend espone CRF e opzione metadati; l'elaborazione immagine e PDF è predisposta nell'elenco sidecar ma richiede ancora i rispettivi handler e controlli dedicati.

## Struttura

```text
.
├── index.html
├── package.json
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
├── tsconfig.json
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── styles.css
│   ├── components/
│   │   ├── DropZone.tsx
│   │   └── ConversionQueue.tsx
│   └── lib/media.ts
└── src-tauri/
    ├── Cargo.toml
    ├── build.rs
    ├── tauri.conf.json
    ├── capabilities/default.json
    ├── binaries/                 # sidecar per ciascun target, da fornire
    └── src/{main.rs,lib.rs}
```

## Sidecar e compilazione

`src-tauri/tauri.conf.json` dichiara `bundle.externalBin`. Per ogni target di rilascio occorre mettere i binari in `src-tauri/binaries/` con il suffisso triplet richiesto da Tauri, per esempio `ffmpeg-aarch64-apple-darwin`, `ffmpeg-x86_64-apple-darwin`, `ffmpeg-x86_64-pc-windows-msvc`, `ffmpeg-x86_64-unknown-linux-gnu` (aggiungere `.exe` su Windows). Aggiungere anche le versioni target-specifiche `ffprobe`, `vips`, `pdftoppm` e `pdfunite`. I sidecar devono essere redistribuibili secondo le licenze dei rispettivi progetti e dei codec inclusi.

Per una prova locale, installare i prerequisiti Tauri v2 per il proprio sistema, poi installare dipendenze npm, collocare almeno `ffmpeg-<target-triple>` e `ffprobe-<target-triple>` nella cartella `src-tauri/binaries`, e lanciare `npm run tauri dev`. Una build pacchettizzata richiede i sidecar di tutti i target che si vuole distribuire. Tauri CLI documenta le piattaforme supportate e il target triple esatto della toolchain.

I formati audio/video selezionati devono essere compatibili con il file d'origine. Per il video, CRF è applicato ai codec video configurati; per l'audio il controllo qualità non è ancora tradotto in parametri specifici del codec. Le immagini/PDF, il ridimensionamento e l'estrazione/unione PDF non sono ancora collegati ai sidecar.
