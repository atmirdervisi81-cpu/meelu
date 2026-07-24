'use strict';

// Nessuna libreria esterna: parla direttamente con l'API REST (PostgREST) che
// Supabase espone su ogni progetto, usando la service_role key lato server.
// Le RLS restano attive: solo questa chiave può leggere/scrivere le tabelle.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function assertConfigured() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error(
      'SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY devono essere impostate (vedi .env.example).'
    );
  }
}

async function restRequest(method, path, { body, query, headers } = {}) {
  assertConfigured();

  const url = new URL(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url, {
    method,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = (data && (data.message || data.error_description)) || response.statusText;
    const error = new Error(`Supabase ${method} ${path} -> ${response.status}: ${message}`);
    error.status = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

module.exports = { restRequest };
