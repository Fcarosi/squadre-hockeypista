# Squadre da invitare

Mappa e lista delle squadre giovanili di hockey pista (U11–U19) con distanze, classifiche e contatti, per scegliere chi invitare ai tornei.

Pagina: `index.html`, pubblicata con GitHub Pages.

## Aggiornamento dei dati

Ogni notte GitHub Actions esegue `scripts/update.mjs`, che:

1. legge dal sito [FISR Hockey Pista](https://www.hockeypista.fisr.it/) le squadre e le classifiche dei campionati giovanili della stagione in corso;
2. legge telefono, email e sede dal [registro società FISR](https://www.fisr.it/la-federazione/ricerca-societa-sportive.html), abbinando il club tramite il codice società;
3. per le città nuove calcola coordinate (Nominatim/OpenStreetMap) e distanze su strada (OSRM);
4. rigenera `index.html` e salva tutto nel repository.

Per aggiornare subito: scheda **Actions** → **Aggiorna dati FISR** → **Run workflow**.

Se il sito FISR cambia struttura l'aggiornamento si ferma con un errore e la pagina resta con gli ultimi dati validi; la data dell'ultimo aggiornamento è scritta in alto nella pagina.
