# Funzionalità e formati supportati

[English](FEATURES.md) | [Italiano](FEATURES.it.md)

Questa pagina descrive gli strumenti disponibili nell’interfaccia attuale di Biolaris Media. Le estensioni indicate sono riconosciute o proposte dall’app, ma non garantiscono la decodifica di ogni file: il supporto effettivo dipende dal contenuto del file e dai codec/delegati inclusi nel runtime.

## Conversione

La conversione accetta file immagine, audio e video riconosciuti. I PDF possono essere usati come input per la conversione in immagini. L’app propone queste famiglie di output:

| Tipo | Formati di output disponibili |
| --- | --- |
| Immagini | JPG/JPEG, PNG, WebP, AVIF, HEIC/HEIF, JXL, BMP, TIFF/TIF, ICO, GIF, TGA, DDS, HDR, EXR, PCX, PBM, PGM, PPM, PNM |
| Audio | MP3, WAV, FLAC, OGG, M4A, AAC, Opus |
| Video | MP4, WebM, MKV, AVI, MOV; è disponibile anche l’output GIF per immagini e video supportati |

Le opzioni di output dipendono dalla categoria rilevata per il file di origine. Alcuni formati immagine richiedono delegati di ImageMagick, quindi il supporto può variare in base al runtime incluso. La conversione non garantisce un output senza perdita.

Tra gli input immagine riconosciuti: JPG/JPEG, PNG, WebP, WebP2, HEIC/HEIF, AVIF, JXL, BPG, GIF, BMP, TIFF/TIF, SVG, ICO/ICNS, JFIF/PJPEG/PJPG, PSD, AI, XCF, TGA, DDS, HDR, EXR, WMF, EMF, EPS, PCX/DCX, PBM/PGM/PPM/PNM e i formati RAW CR2, CR3, NEF, ARW, SR2, DNG, RW2, ORF, PEF, RAF, MRW, X3F, ERF, 3FR e FFF.

Le estensioni audio riconosciute sono MP3, WAV, OGG/OGA, MKA, FLAC, M4A/M4R/M4B/M4P, AAC/ADTS, WMA, ALAC, AIFF/AIF, APE, PCM, Opus, SPX, AMR, GSM, MIDI/MID, MPC, WV, DSF, DFF, CAF, TAK, TTA, RA/RAM, AU, SND, VOC e AC3.

Le estensioni video riconosciute sono MP4, MKV, AVI, MOV, WebM, WMV, FLV/F4V, VOB, OGV/OGM, QT, M4V, MPG/MPEG/M2V, 3GP/3G2, TS/MTS/M2TS/M2T, ASF, RM/RMVB, DIVX/XVID, DV, AMV, MJPEG/MJPG, ROQ, YUV e NUT.

## Compressione

La compressione mantiene l’estensione originale e supporta:

- Formati immagine riconosciuti, esclusi i PDF.
- Video MP4, MOV, M4V, AVI, MKV e WebM.
- Audio MP3, OGG e OGA.

Il controllo qualità offre cinque valori da 30 a 70. La compressione può ricodificare i file e non garantisce un output più piccolo per ogni file di origine.

## Strumenti per immagini

- **Ritaglia:** accetta i formati immagine riconosciuti e salva il ritaglio selezionato come nuova immagine.
- **Rimuovi sfondo:** accetta JPG, JPEG, PNG e WebP; salva un PNG trasparente. Il modello BiRefNet Lite 512 viene scaricato al primo utilizzo ed eseguito localmente sulla CPU. L’immagine non viene caricata online.
- **Vettorializza:** accetta PNG, JPG/JPEG, GIF, BMP, TIFF/TIF e WebP; crea un SVG con tracciati. Gli stili disponibili sono logo, foto e bianco e nero.
- **Crea icone app:** accetta SVG, PNG, JPG/JPEG e WebP. Le immagini raster devono essere quadrate e avere almeno 512 × 512 pixel. Genera risorse per Windows, macOS, iOS, Android e progetti web.

## Strumenti audio e video

- **Slideshow:** crea MP4 da immagini; offre 720p, 1080p, 4K o le dimensioni della prima immagine, con durata per immagine da 1 a 30 secondi a incrementi di mezzo secondo.
- **Combina video:** unisce almeno due video riconosciuti e offre output MP4, WebM, MKV, AVI o MOV.
- **Unisci audio:** combina almeno due file audio riconosciuti e offre MP3, M4A, M4B, AAC, WAV, AIFF, FLAC, OGG, Opus o AC3. Per M4B si possono aggiungere marcatori di capitolo.
- **Dividi per capitolo:** legge file audio o video con capitoli ed esporta ciascun capitolo separatamente. Gli output audio sono MP3, M4A, WAV, FLAC, OGG, AAC e Opus; gli output video sono MP4, MKV, MOV, WebM e AVI. È possibile mantenere il contenitore originale.
- **Scarica video:** accetta link HTTP/HTTPS e usa il runtime `yt-dlp` incluso. Ogni operazione può includere fino a 100 link; il download richiede una connessione Internet. Sorgenti e formati disponibili dipendono da `yt-dlp` e dal sito di origine.

## Strumenti PDF

- **Unisci PDF:** combina due o più PDF leggibili e non cifrati nell’ordine scelto.
- **Dividi PDF:** divide PDF leggibili e non cifrati usando numeri o intervalli di pagina. Lasciando vuoto il campo, crea un file per pagina.
- **Organizza pagine PDF:** mostra l’anteprima delle pagine, consente di riordinarle o rimuoverle e salva una copia senza modificare l’originale. Questa schermata è disponibile nell’app desktop Tauri.
- **Immagini in PDF:** accetta JPEG/JPG/JFIF, PNG, WebP, GIF, BMP e TIFF/TIF. Crea una pagina per immagine con dimensione immagine, A4, US Letter o formato personalizzato, qualità JPEG regolabile e password PDF facoltativa.

Biolaris non sblocca i PDF cifrati. Sblocca il documento con un’altra applicazione prima di aggiungerlo.

## Elaborazione locale e rete

La conversione dei media e le operazioni sui file vengono eseguite localmente dall’app desktop. Il modello per rimuovere lo sfondo deve essere scaricato una volta; i download video si collegano necessariamente alla sorgente indicata. Anche la configurazione di sviluppo scarica i binari runtime della piattaforma. Non è richiesto un account né un servizio Biolaris online.
