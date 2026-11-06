# Installazione e primo avvio

[English](INSTALLATION.md) | [Italiano](INSTALLATION.it.md)

## Scaricare una release

Scarica gli installer aggiornati da [GitHub Releases](https://github.com/bispitalieri/biolaris-media/releases). Scegli il pacchetto corrispondente al sistema operativo e all’architettura:

| Piattaforma | Pacchetto | Note |
| --- | --- | --- |
| Windows x64 | `.msi` o `.exe` | Avvia l’installer e segui le istruzioni. |
| macOS Apple silicon | `.dmg` `darwin-aarch64` | Apri l’immagine disco e installa Biolaris Media. |
| macOS Intel | `.dmg` `darwin-x86_64` | Apri l’immagine disco e installa Biolaris Media. |
| Linux x64 | `.AppImage`, `.deb` o `.rpm` | Avvia l’AppImage oppure installa il pacchetto con il gestore della tua distribuzione. |

I nomi dei file includono versione e architettura; consulta gli asset della release desiderata invece di fare affidamento su un vecchio nome.

Il workflow può pubblicare build macOS senza firma o notarizzazione Apple. macOS potrebbe mostrare un avviso all’apertura. Le build Windows e Linux sono per x64; non vengono pubblicati pacchetti Linux ARM64 o Windows ARM64.

## Primo avvio e connessione Internet

- La maggior parte delle operazioni sui media viene eseguita localmente con gli strumenti inclusi nell’app desktop.
- Al primo utilizzo, la rimozione dello sfondo scarica il modello BiRefNet Lite 512 (circa 183 MB). Il modello viene poi eseguito localmente sulla CPU; le immagini selezionate non vengono caricate online.
- Per scaricare video serve una connessione Internet verso la sorgente. `yt-dlp` è incluso nel runtime preparato; normalmente non occorre installarlo separatamente.
- La configurazione di sviluppo scarica gli strumenti runtime della piattaforma prima di avviare o compilare l’app desktop.

## Risoluzione dei problemi

**L’installer non è adatto al mio computer.** Controlla l’architettura indicata nell’asset: `windows-x86_64`, `linux-x86_64`, `darwin-x86_64` (Intel) o `darwin-aarch64` (Apple silicon).

**macOS avvisa che l’app non può essere verificata.** Alcune build possono essere non firmate perché la firma Apple è facoltativa. Procedi solo se hai scaricato l’app dalla pagina Releases ufficiale del repository e accetti l’avviso relativo alle app non firmate.

**Un file o un formato di output non è supportato.** L’estensione non garantisce che ogni codec o variante sia leggibile. Consulta la [guida a funzionalità e formati](FEATURES.it.md) e prova un formato alternativo supportato se il codec di origine non è compatibile.

**La rimozione dello sfondo non riesce a caricare il modello.** Al primo avvio serve una connessione Internet per scaricarlo. Riprova con una connessione funzionante; dopo il download, l’elaborazione è locale.

**Il download video non riesce.** La sorgente deve essere raggiungibile e supportata dalla versione inclusa di `yt-dlp`. Riprova dopo aver aggiornato app/runtime; non tutti i siti o video sono scaricabili.

**Uno strumento PDF rifiuta il documento.** Le operazioni PDF attuali non sbloccano documenti cifrati. Sblocca il file con un’altra applicazione e aggiungilo di nuovo.
