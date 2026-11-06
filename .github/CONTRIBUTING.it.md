# Contribuire

[🇬🇧 English](CONTRIBUTING.md) | 🇮🇹 Italiano

Grazie per l’interesse in Biolaris Media. Bug report, documentazione, correzioni e nuove funzionalità sono tutti benvenuti.

## Prima di iniziare

- Controlla le issue aperte per vedere se qualcuno ha già segnalato lo stesso problema o la stessa idea.
- Se stai pensando a una modifica più ampia, apri prima una issue così possiamo parlarne.
- Evita di inserire nei commit file media personali, credenziali, binari scaricati e output di build.

## Pull request

1. Crea un branch per la modifica.
2. Mantieni la modifica focalizzata. Se cambia il funzionamento dell’app, aggiorna anche la documentazione.
3. Esegui `npm run build`. Se hai modificato codice Rust, esegui anche `cargo check --manifest-path src-tauri/Cargo.toml` (servono i prerequisiti Tauri per la tua piattaforma).
4. Nella pull request spiega cosa hai cambiato e perché, e indica quali verifiche hai eseguito. Gli screenshot sono utili per le modifiche all’interfaccia.

Un maintainer esaminerà la pull request. Non possiamo garantire che ogni proposta venga accettata né indicare in anticipo quando sarà revisionata.

## Stile

Segui la formattazione e le convenzioni già usate nel codice. Mantieni le modifiche semplici e coerenti con la struttura Tauri, React e Rust. Se aggiungi una dipendenza, spiega nella pull request perché serve.

Partecipando al progetto accetti di rispettare il [Codice di condotta](CODE_OF_CONDUCT.md).
