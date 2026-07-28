# Meelu

Social network geolocalizzato che abbatte la barriera del "primo passo":
trova persone vicine con interessi in comune e propone un incontro reale a
breve (un caffè, una camminata), con doppio consenso cieco e rifiuto sempre
invisibile all'altra parte.

Città pilota: Jesi (AN, Marche).

## Stato del progetto

- Database: Supabase, progetto `meelu` (`wkqmfdkjrfkwwlnlwusk`, regione
  `eu-west-1`). Schema applicato: `users`, `availability`, `proposals`,
  `proposal_responses`, `tickets`, `invite_codes`, tutte con Row Level
  Security.
- **Fase attuale: test con una cerchia di amici.** `frontend/app.html` è
  un'app web reale e completa (non una simulazione): registrazione con
  email/password, **codice invito obbligatorio**, profilo con foto,
  disponibilità geolocalizzata, ricerca persone vicine, proposta con
  doppio consenso, biglietto d'incontro. Parla **direttamente** con
  Supabase dal browser di ogni persona (nessun server da far girare) usando
  la chiave pubblica (`anon`/`publishable`, sicura da esporre — è
  esattamente a cosa serve).
- La sicurezza del doppio consenso (nome/foto rivelati solo dopo un doppio
  sì, rifiuto sempre invisibile) è applicata **dentro il database**
  tramite funzioni Postgres dedicate (`respond_to_proposal`,
  `get_proposal_status`, `create_meeting_ticket`), non solo lato client:
  anche forzando le richieste dal browser non si riesce a bypassarla.
- `backend/`: un secondo backend, a parte, pensato per un uso futuro
  server-side (es. amministrazione, invio notifiche, job in background).
  Non è necessario per il test con amici in corso.

## Come far provare l'app agli amici

**Link live**: https://raw.githack.com/atmirdervisi81-cpu/meelu/main/frontend/app.html
(serve `frontend/app.html` direttamente dal repository pubblico — le
Supabase Edge Functions non vanno bene per questo perché disattivano il
JavaScript sulle pagine aperte direttamente nel browser; per aggiornare il
link dopo una modifica basta fare push su `main`, githack lo rilegge da solo
in pochi secondi).

1. Apri il link sopra in un browser (funziona anche da telefono).
2. Dai a tutti i tuoi amici lo stesso codice invito, si può usare più volte:

   ```
   MEELU-AMICI
   ```

3. Ogni persona: si registra con **la propria email vera** (non lasciare il
   testo di esempio nel campo) e una password → se Supabase richiede la
   conferma email, deve cliccare il link ricevuto e poi tornare sulla pagina
   e fare "Accedi" → inserisce il codice invito e crea il profilo (nome, anno
   di nascita, interessi, foto) → tocca "Sono libero/a ora" (richiede il permesso di
   geolocalizzazione del browser) → "Cerca persone vicine" → può proporre
   un incontro a chi condivide un interesse ed è nel raggio scelto.
4. Quando **entrambe** le persone coinvolte in una proposta rispondono "Sì,
   accetto", si rivelano nome e foto e si può generare il biglietto
   d'incontro. Chi rifiuta (o non risponde) non viene mai segnalato
   all'altra parte.

Limite noto di questa fase di test: il codice invito è unico e condiviso da
tutti — chiunque lo conosca può registrarsi. Per un test tra amici va bene;
prima di un lancio più ampio andrà sostituito con codici singoli o con un
vero controllo degli inviti. In ogni caso, chi si registra vede solo dati
protetti dalle regole del database descritte sopra (mai la chiave segreta,
mai i dati altrui prima di un doppio sì).

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
└── app.html        → app reale, collegata direttamente a Supabase (auth + RLS + RPC)
```

## Backend (uso futuro, non necessario per il test con amici)

```
cd backend
cp .env.example .env
# compila SUPABASE_SERVICE_ROLE_KEY in .env
# (Project Settings → API → service_role secret, sulla dashboard Supabase:
#  non è recuperabile via strumenti automatici per motivi di sicurezza)
npm test      # esegue backend/test.js: crea utenti/proposte/ticket reali e li ripulisce
npm start     # avvia il server su http://localhost:3000
```

## Come funziona il flusso di consenso

1. Un utente attiva la disponibilità (posizione, raggio, interessi) per una
   finestra di tempo limitata.
2. La ricerca "persone vicine" restituisce solo persone nel raggio con
   almeno un interesse in comune — niente nome o foto in questa fase, per
   non trasformare la scoperta in uno "swipe" basato sull'aspetto.
3. Si propone un incontro a un candidato compatibile.
4. Ogni persona risponde "accetto" o "non ora" tramite la funzione
   `respond_to_proposal` nel database. Solo quando **entrambe** hanno
   accettato la proposta diventa `matched` e vengono rivelati nome e foto.
   Un rifiuto non è mai visibile all'altra parte: per chi non ha rifiutato,
   la proposta risulta solo `expired`, indistinguibile da una proposta a cui
   nessuno ha risposto in tempo.
5. Una volta `matched`, si genera il biglietto dell'incontro (luogo, orario
   proposto, rompighiaccio, codice di sicurezza a 4 cifre) tramite
   `create_meeting_ticket`.

## Prossimi passi

1. Raccogliere il feedback del test con amici e sistemare quello che emerge
   dall'uso reale.
2. Login vero con verifica identità (KYC) al posto del semplice
   "verificato · test amici" attuale, prima di aprire l'app a estranei.
3. Chat pre-incontro a tempo.
4. Pulsante di emergenza e condivisione dell'incontro con un contatto
   fidato.
5. Foto su Supabase Storage invece che incorporata nel profilo come
   immagine compressa.
6. Solo alla fine: sostituire il frontend HTML con un'app vera (React
   Native), quando il meccanismo sarà validato.
