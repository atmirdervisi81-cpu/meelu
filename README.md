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

## Notifiche push

Toccando "Attiva notifiche" (dentro l'app, dopo il login) il browser chiede il
permesso e registra il dispositivo. Quando una proposta diventa `matched`, la
funzione Supabase `send-match-push` invia una notifica push reale all'altra
persona — arriva anche a browser chiuso, perché la consegna passa dal
service worker (`frontend/sw.js`), non dalla pagina aperta.

**Limite noto su iPhone**: Safari supporta le notifiche push solo per pagine
aggiunte alla schermata Home ("Aggiungi a Home" dall'icona di condivisione),
non nel browser normale — è una restrizione di Apple, non aggirabile lato
nostro. Su Android/desktop funziona nel browser normale.

Le chiavi VAPID e la `service_role` key usate dalla funzione sono
incorporate nel codice della funzione stessa (non in variabili d'ambiente
separate), perché questa sessione non ha un vault/secrets manager collegato
al progetto Supabase — sono visibili solo a chi ha accesso alla dashboard del
progetto, mai al browser di chi usa l'app.

## Pannello admin

**Link**: https://raw.githack.com/atmirdervisi81-cpu/meelu/main/frontend/admin.html

Accesso riservato: solo l'account del fondatore (in tabella `public.admins`)
può vedere qualcosa — il controllo è dentro il database (funzione
`admin_dashboard`, `SECURITY DEFINER`), non solo nascosto nella pagina.
Chiunque altro faccia login vede "accesso riservato" e viene disconnesso.

Mostra: statistiche generali (utenti, disponibili ora, proposte, match,
inviti riscattati), l'elenco di chi si è registrato (nome, email, età,
interessi, verificato, disponibile ora, iscritto il) e le proposte recenti
(tra chi, interessi comuni, stato). **Non mostra mai la posizione di
nessuno**, nemmeno approssimata — è una scelta deliberata, coerente con il
principio "mai la posizione esatta" del piano: la posizione resta un dato
che nessuno vede se non implicito nel meccanismo di match, nemmeno chi
amministra la piattaforma.

Per aggiungere un altro amministratore in futuro:
`insert into public.admins (user_id) select id from auth.users where email = '...';`

Dalla tabella utenti puoi anche **regalare o togliere il piano Plus** a
chiunque con un tocco (colonna "Piano") — utile per i test, prima che
esistano pagamenti veri.

## Limite giornaliero (freemium)

Ogni account nasce con `plan = 'free'`: può vedere al massimo **1 match al
giorno**. Un secondo doppio sì nello stesso giorno risulta comunque
`matched` nel database (l'incontro è reale, nulla va perso), ma la
rivelazione di nome/foto/biglietto resta bloccata per chi ha il piano
free finché non passa a `plan = 'plus'` (oggi solo tramite il pannello
admin) o finché non inizia un nuovo giorno. La verifica è dentro
`get_proposal_status`, quindi non è aggirabile dal client.

**Non ancora collegato**: un vero sistema di pagamento (es. Stripe) per
comprare Plus da soli. Per questa fase di test tra amici è stato deciso di
non attivarlo — nessun soldo reale si muove finché non lo si collega
esplicitamente in futuro.

## Età minima e contatto di fiducia

La creazione del profilo richiede una spunta esplicita "Confermo di avere
almeno 18 anni": senza spunta, o con un anno di nascita che risulterebbe in
un'età inferiore, il profilo non si crea. Il database applica lo stesso
limite in modo indipendente dal client (vincolo `check` sulla tabella
`users`), quindi non è aggirabile forzando le richieste dal browser. Non è
ancora una verifica d'identità vera (KYC): è un'autodichiarazione, come per
la maggior parte dei social — un vero KYC richiederebbe un fornitore terzo
a pagamento, fuori dallo scopo di questa fase di test.

Nel profilo si può anche indicare (facoltativo) il nome e telefono di un
**contatto di fiducia**: serve solo al pulsante "Condividi il mio incontro"
(vedi sotto), nessun altro lo vede.

## Chat pre-incontro, emergenza e condivisione

Dopo un doppio sì compaiono, sotto il match:

- **Chat pre-incontro**: messaggi diretti con l'altra persona, utile solo
  per accordarsi su luogo e orario. Resta aperta per **3 ore** dal match:
  passato quel tempo, il database stesso rifiuta letture e scritture
  (`public.messages`, con regole RLS che controllano il doppio sì e le 3
  ore), non solo l'interfaccia.
- **Emergenza · 112**: link diretto per chiamare il numero unico di
  emergenza italiano.
- **Condividi il mio incontro**: invia (via la condivisione nativa del
  telefono, o su WhatsApp se hai impostato un contatto di fiducia, o
  copiandolo negli appunti come ultima opzione) chi stai per incontrare,
  il luogo e l'orario proposto.

## Feedback post-incontro

Dopo un match compare "Com'è andata?" (bene / non bene + una nota
facoltativa). Il tuo feedback **non è mai visibile** a nessuno
individualmente, nemmeno all'altra persona o all'admin — nel pannello
admin si vede solo la percentuale aggregata su tutti gli incontri
(`meeting_feedback`, nessuna policy di lettura per riga, solo la funzione
`admin_dashboard` può calcolarne l'aggregato).

## Notifica anche per le nuove proposte

Oltre alla notifica quando scatta un doppio sì, ora arriva una notifica
push anche a chi riceve **una nuova proposta** (funzione Supabase
`send-proposal-push`), non solo a match avvenuto — così non serve tenere
l'app aperta in attesa.

## Blocco e segnalazione

Su ogni persona vicina (prima ancora di proporre un incontro) e su chi si
è rivelato dopo un doppio sì, c'è un tasto **"Blocca"**: chi blocchi
sparisce dalla tua ricerca e tu sparisci dalla sua (regola applicata dentro
`availability select active`, non aggirabile dal client). Se esisteva già
una proposta aperta tra voi due, `respond_to_proposal` la chiude sempre,
qualunque cosa rispondiate.

Dopo un match, c'è anche **"Segnala"**: sceglie un motivo (comportamento
molesto, falsa identità, contenuto inappropriato, comportamento
pericoloso, altro) più un dettaglio facoltativo. Le segnalazioni sono
visibili solo nel pannello admin, dove puoi metterle "in revisione" o
"chiudi" con un tocco — non c'è ancora un vero team di moderazione dietro,
solo te per ora.

**Limite noto**: bloccare o segnalare qualcuno non nasconde retroattivamente
un match o un biglietto già rivelati prima del blocco — vale solo per il
futuro (nuove ricerche, nuove proposte).

## Prossimi passi

1. Raccogliere il feedback del test con amici e sistemare quello che emerge
   dall'uso reale.
2. Login vero con verifica identità (KYC) di un fornitore terzo, al posto
   della sola autodichiarazione 18+ attuale, prima di aprire l'app a
   estranei — richiede un account a pagamento con un fornitore esterno.
3. Un dominio dedicato al posto di raw.githack.com — risolverebbe in modo
   definitivo il blocco automatico delle notifiche che Chrome applica ad
   alcuni domini condivisi (non dipende dal codice di Meelu).
4. Foto su Supabase Storage invece che incorporata nel profilo come
   immagine compressa.
5. Pagamenti veri (Stripe) per acquistare Plus da soli, quando si sarà
   pronti a incassare — prezzo e IVA da decidere con un commercialista,
   come già indicato nel piano.
6. Solo alla fine: sostituire il frontend HTML con un'app vera (React
   Native), quando il meccanismo sarà validato.
