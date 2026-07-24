# Meelu

Social network geolocalizzato che abbatte la barriera del "primo passo":
trova persone vicine con interessi in comune e propone un incontro reale a
breve (un caffè, una camminata), con doppio consenso cieco e rifiuto sempre
invisibile all'altra parte.

Città pilota: Jesi (AN, Marche).

## Stato del progetto

- Database: Supabase, progetto `meelu` (`wkqmfdkjrfkwwlnlwusk`, regione
  `eu-west-1`). Schema già applicato: tabelle `users`, `availability`,
  `proposals`, `proposal_responses`, `tickets`, tutte con Row Level Security
  attiva e nessuna policy pubblica — solo il backend, con la chiave
  `service_role`, può leggere/scrivere.
- Backend (`backend/`): implementato, mai ancora eseguito contro il database
  reale. Scritto senza framework né dipendenze esterne — solo moduli nativi
  Node.js (richiede Node >= 18 per `fetch`), parla direttamente con l'API
  REST (PostgREST) di Supabase usando la `service_role` key.
- Frontend (`frontend/app.html`): interfaccia minimale collegata al backend
  via `fetch`, solo per verificare il flusso end-to-end.

## Struttura

```
backend/
├── server.js       → instradamento HTTP, nessuna query SQL qui dentro
├── db.js           → connessione REST a Supabase (service_role)
├── repository.js   → tutte le query verso il database
├── matching.js     → celle geografiche, distanza, interessi comuni
├── test.js         → test end-to-end via HTTP contro Supabase reale
├── package.json
└── .env.example
frontend/
└── app.html        → interfaccia minimale collegata via fetch
```

## Come avviare

```
cd backend
cp .env.example .env
# compila SUPABASE_SERVICE_ROLE_KEY in .env
# (Project Settings → API → service_role secret, sulla dashboard Supabase:
#  non è recuperabile via strumenti automatici per motivi di sicurezza)
npm test      # esegue backend/test.js: crea utenti/proposte/ticket reali e li ripulisce
npm start     # avvia il server su http://localhost:3000
```

Poi apri `frontend/app.html` in un browser (basta aprire il file, non serve
un server per il frontend) e usa il campo "URL del backend" per puntare a
`http://localhost:3000`.

## Come funziona il flusso di consenso

1. Un utente attiva la disponibilità (`POST /api/availability/:userId`) con
   posizione, raggio e interessi.
2. `GET /api/matches/:userId` restituisce solo persone vicine con almeno un
   interesse in comune — niente nome o foto in questa fase, per non
   trasformare la scoperta in uno "swipe" basato sull'aspetto.
3. `POST /api/proposals` crea una proposta di incontro tra due utenti
   reciprocamente compatibili.
4. Ogni utente risponde con `POST /api/proposals/:id/respond`
   (`accept`/`decline`). Solo quando **entrambi** hanno accettato la
   proposta diventa `matched` e vengono rivelati nome e foto. Un rifiuto non
   è mai visibile all'altra parte: per chi non ha rifiutato, la proposta
   risulta solo `expired`, indistinguibile da una proposta a cui nessuno ha
   risposto in tempo.
5. Una volta in `matched`, `POST /api/tickets` genera il biglietto
   dell'incontro (luogo, orario proposto, rompighiaccio, codice di
   sicurezza a 4 cifre).

## Prossimi passi

1. Eseguire `npm test` con una `service_role` key reale: è la prima
   esecuzione vera contro Supabase, è normale che emerga qualche bug da
   sistemare.
2. Chat pre-incontro a tempo.
3. Pulsante di emergenza e condivisione dell'incontro con un contatto
   fidato.
4. Sostituire lo stub di verifica identità con un provider KYC reale, e
   l'upload foto con Supabase Storage (già disponibile nello stesso
   progetto).
5. Solo alla fine: sostituire il frontend HTML minimale con un'app vera
   (React Native).
