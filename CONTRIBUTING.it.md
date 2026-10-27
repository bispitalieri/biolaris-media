# Contribuire

[🇬🇧 English](CONTRIBUTING.md) | 🇮🇹 Italiano

Grazie per l’interesse in Biolaris Media. Bug report, aggiornamenti alla documentazione, correzioni e nuove funzionalità sono benvenuti.

## Prima di iniziare

- Cerca nelle issue esistenti prima di aprirne una nuova.
- Per modifiche sostanziali, apri prima una issue per descrivere il problema e l’approccio proposto.
- Non includere nei commit file media personali, credenziali, binari scaricati o output di build.

## Pull request

1. Crea un branch dedicato alla modifica.
2. Mantieni la modifica focalizzata e aggiorna la documentazione quando cambia il comportamento.
3. Esegui `npm run build` per controllare la compilazione frontend. Per modifiche Rust, esegui anche `cargo check --manifest-path src-tauri/Cargo.toml` con i prerequisiti Tauri installati.
4. Apri una pull request con contesto, motivazione e descrizione delle verifiche eseguite. Per modifiche UI, aggiungi screenshot quando utili.

I maintainer revisionano le pull request. L’invio non garantisce l’accettazione né una tempistica specifica per la revisione.

## Stile

Segui la formattazione e le convenzioni già presenti nel codice. Preferisci modifiche semplici e coerenti con l’architettura Tauri/React/Rust esistente. Se la modifica richiede una nuova dipendenza, spiega il motivo nella pull request.

Partecipando al progetto accetti di rispettare il [Codice di condotta](CODE_OF_CONDUCT.md).
