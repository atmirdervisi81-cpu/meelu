'use strict';

// Griglia di celle di ~166 m di lato, usata per interrogare velocemente Supabase
// (colonna availability.cell) senza bisogno di PostGIS: due persone vicine cadono
// sempre nella stessa cella o in una delle 8 adiacenti.
const CELL_SIZE_DEG = 0.0015;

function toCellIndex(value) {
  return Math.floor(value / CELL_SIZE_DEG);
}

function cellKey(lat, lng) {
  return `${toCellIndex(lat)}:${toCellIndex(lng)}`;
}

function neighborCells(lat, lng) {
  const latIdx = toCellIndex(lat);
  const lngIdx = toCellIndex(lng);
  const cells = [];
  for (let dLat = -1; dLat <= 1; dLat++) {
    for (let dLng = -1; dLng <= 1; dLng++) {
      cells.push(`${latIdx + dLat}:${lngIdx + dLng}`);
    }
  }
  return cells;
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function sharedInterests(a, b) {
  const setB = new Set((b || []).map((i) => i.toLowerCase()));
  const seen = new Set();
  const shared = [];
  for (const interest of a || []) {
    const key = interest.toLowerCase();
    if (setB.has(key) && !seen.has(key)) {
      seen.add(key);
      shared.push(interest);
    }
  }
  return shared;
}

// Due disponibilità si "incontrano" se la distanza reciproca rientra nel raggio
// che *entrambi* hanno scelto e condividono almeno un interesse.
function isReciprocalMatch(candidateA, candidateB) {
  const distance = haversineMeters(candidateA.lat, candidateA.lng, candidateB.lat, candidateB.lng);
  const withinRange = distance <= candidateA.radius_m && distance <= candidateB.radius_m;
  const common = sharedInterests(candidateA.interests, candidateB.interests);
  return {
    isMatch: withinRange && common.length > 0,
    distance: Math.round(distance),
    sharedInterests: common,
  };
}

module.exports = {
  CELL_SIZE_DEG,
  cellKey,
  neighborCells,
  haversineMeters,
  sharedInterests,
  isReciprocalMatch,
};
