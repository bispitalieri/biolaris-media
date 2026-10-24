# Contribuire

Grazie per l’interesse in Biolaris Media. Bug report, documentazione, correzioni e nuove funzionalità sono benvenuti.

## Prima di iniziare

- Cerca nelle issue esistenti prima di aprirne una nuova.
- Per modifiche sostanziali, descrivi prima il problema e la soluzione proposta in una issue.
- Non includere file media personali, credenziali, binari o output di build nei commit.

## Pull request

1. Crea un branch dedicato.
2. Mantieni la modifica focalizzata e aggiorna la documentazione se cambia il comportamento.
3. Esegui `npm run build` per verificare la compilazione frontend. Per modifiche Rust, esegui anche `cargo check --manifest-path src-tauri/Cargo.toml` con i prerequisiti Tauri installati.
4. Apri una pull request con contesto, motivazione e una descrizione delle verifiche eseguite. Per modifiche UI, aggiungi screenshot quando utile.

Le pull request sono revisionate dai maintainer; l’invio non implica accettazione o una tempistica specifica.

## Stile

Segui la formattazione e le convenzioni già presenti nel codice. Preferisci cambiamenti semplici e coerenti con l’architettura Tauri/React/Rust esistente. Non introdurre nuove dipendenze senza spiegare nella pull request perché servono.

Partecipando al progetto accetti di rispettare il [Codice di condotta](CODE_OF_CONDUCT.md).
