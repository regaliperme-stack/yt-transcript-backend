// api/transcript.js
// Funzione serverless (Vercel). Riceve ?videoId=... e restituisce { videoId, transcript }.
//
// NOTA: la prima versione di questa funzione leggeva la trascrizione
// direttamente dalla pagina YouTube. YouTube pero' blocca sistematicamente
// queste richieste quando arrivano da IP di server cloud (Vercel, AWS, ecc.)
// - e' un blocco anti-bot noto e diffuso, non un bug nostro. Questa versione
// si appoggia invece a youtube-transcript.ai, un servizio che espone la
// trascrizione con un singolo URL pubblico, senza chiave API e con CORS
// aperto: il problema del blocco lo risolve lui a monte.

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  const videoId = req.query.videoId;
  if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    res.status(400).json({ error: "Parametro videoId mancante o non valido" });
    return;
  }

  try {
    const upstream = await fetch("https://youtube-transcript.ai/transcript/" + videoId + ".txt");
    if (!upstream.ok) {
      throw new Error(
        upstream.status === 404
          ? "Nessuna trascrizione disponibile per questo video (sottotitoli assenti o disattivati)"
          : "Servizio di trascrizione non disponibile (" + upstream.status + ")"
      );
    }
    const raw = await upstream.text();
    const transcript = cleanTranscript(raw);
    if (!transcript || transcript.length < 50) {
      throw new Error("Trascrizione estratta vuota o troppo corta");
    }
    res.status(200).json({ videoId, transcript });
  } catch (err) {
    res.status(502).json({ error: err.message || "Recupero trascrizione fallito" });
  }
}

// La risposta di youtube-transcript.ai e' un documento Markdown con
// un'intestazione (titolo, lingua, durata...) seguita dal testo diviso in
// paragrafi con timestamp tipo "[0:19] ...". Qui si toglie l'intestazione
// e i timestamp, lasciando solo il testo parlato pulito.
function cleanTranscript(raw) {
  const lines = raw.split("\n");
  const bodyStart = lines.findIndex(l => /^\[\d+:\d+\]/.test(l.trim()));
  const body = bodyStart === -1 ? raw : lines.slice(bodyStart).join("\n");
  return body
    .replace(/\[\d+:\d+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
