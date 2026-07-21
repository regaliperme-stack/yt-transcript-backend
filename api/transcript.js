// api/transcript.js
// Funzione serverless (Vercel). Riceve ?videoId=... e restituisce { videoId, transcript }.
// Gira lato server: nessun problema di CORS, perche' non e' il browser dell'utente
// a contattare YouTube, ma questo server.

export default async function handler(req, res) {
  // Permette all'artifact (o a qualunque frontend) di chiamare questo endpoint
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  const videoId = req.query.videoId;
  if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    res.status(400).json({ error: "Parametro videoId mancante o non valido" });
    return;
  }

  try {
    const transcript = await fetchTranscript(videoId);
    res.status(200).json({ videoId, transcript });
  } catch (err) {
    res.status(502).json({ error: err.message || "Recupero trascrizione fallito" });
  }
}

async function fetchTranscript(videoId) {
  // 1. Scarica la pagina pubblica del video: contiene l'elenco delle tracce
  //    di sottotitoli/trascrizione che YouTube genera per ogni spettatore.
  const pageResp = await fetch("https://www.youtube.com/watch?v=" + videoId + "&hl=it", {
    headers: {
      "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
      // Senza questo cookie, YouTube mostra a molte richieste server-side europee
      // una pagina di consenso cookie invece della pagina del video vera e propria.
      "Cookie": "CONSENT=YES+1; PREF=hl=it",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
  });
  if (!pageResp.ok) throw new Error("Video non raggiungibile (" + pageResp.status + ")");
  const html = await pageResp.text();

  // 2. Estrae il blob JSON "captionTracks" incorporato nella pagina.
  const match = html.match(/"captionTracks":(\[.*?\])(?=,")/);
  if (!match) throw new Error("Nessuna trascrizione/sottotitolo disponibile per questo video");

  let tracks;
  try {
    tracks = JSON.parse(match[1].replace(/\\u0026/g, "&"));
  } catch {
    throw new Error("Formato tracce sottotitoli non riconosciuto");
  }
  if (!tracks.length) throw new Error("Nessuna traccia di sottotitoli trovata");

  // 3. Preferisce l'italiano; altrimenti la prima lingua disponibile.
  const track =
    tracks.find(t => t.languageCode === "it") ||
    tracks.find(t => t.languageCode?.startsWith("it")) ||
    tracks[0];

  // 4. Scarica il file XML della traccia scelta e lo converte in testo pulito.
  const capResp = await fetch(track.baseUrl);
  if (!capResp.ok) throw new Error("Download sottotitoli fallito (" + capResp.status + ")");
  const xml = await capResp.text();

  const text = Array.from(xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g))
    .map(m => decodeEntities(m[1]))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length < 50) throw new Error("Trascrizione estratta vuota o troppo corta");
  return text;
}

function decodeEntities(str) {
  return str
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
