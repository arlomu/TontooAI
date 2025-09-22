// app.js
const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");
const cheerio = require("cheerio");

const app = express();
app.use(bodyParser.json());

const PORT = 53564;

// === Ollama Netzwerk-Einstellungen ===
const OLLAMA_HOST = "host.docker.internal"; // Hostname oder IP des Ollama-Servers
const OLLAMA_PORT = 11434;       // Port der Ollama-API
// Optional: falls API-Key notwendig
// const OLLAMA_API_KEY = "dein_api_key";

// === DuckDuckGo Suche ===
async function searchDuckDuckGo(query) {
  const res = await axios.post(
    "https://html.duckduckgo.com/html/",
    new URLSearchParams({ q: query }).toString(),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0",
      },
    }
  );

  const $ = cheerio.load(res.data);
  const results = [];

  $("a.result__a").each((i, el) => {
    if (i < 3) {
      results.push({
        title: $(el).text(),
        url: $(el).attr("href"),
      });
    }
  });

  return results;
}

// === Anfrage an Ollama über Netzwerk-API ===
async function queryOllama(model, systemPrompt, timeoutMs = 60000) {
  try {
    const response = await axios.post(
      `http://${OLLAMA_HOST}:${OLLAMA_PORT}/v1/completions`,
      {
        model: model,
        prompt: systemPrompt,
        max_tokens: 500,
      },
      {
        timeout: timeoutMs,
        headers: {
          "Content-Type": "application/json",
          // Optional: "Authorization": `Bearer ${OLLAMA_API_KEY}`
        },
      }
    );

    if (response.data && response.data.completion) {
      return response.data.completion.trim();
    } else {
      throw new Error("Ungültige Antwort von Ollama API");
    }
  } catch (err) {
    throw new Error(`Ollama network error: ${err.message}`);
  }
}

// === Endpoint ===
app.post("/", async (req, res) => {
  try {
    const { suchworter, model } = req.body;

    if (!suchworter || suchworter.length !== 3 || !model) {
      return res.status(400).json({ error: "Es müssen genau 3 Suchwörter und ein Modell angegeben werden." });
    }

    // DuckDuckGo Ergebnisse holen
    const allResults = [];
    for (const wort of suchworter) {
      const results = await searchDuckDuckGo(wort);
      if (results.length > 0) {
        allResults.push(results[0]); // nur das erste Ergebnis
      }
    }

    const urls = allResults.map(r => r.url);

    // Prompt bauen
    const systemPrompt = `
Fasse die folgenden Begriffe in einem kurzen Text zusammen:
- ${suchworter.join("\n- ")}

Nutze diese Quellen:
${urls.join("\n")}

Antwort NUR im folgenden JSON-Format (ohne Markdown, ohne extra Text, ohne Codeblock):
{
  "zusammenfassung": "DEIN TEXT HIER",
  "quellen": [${urls.map(u => `"${u}"`).join(", ")}]
}
`;

    // Anfrage an Ollama über Netzwerk
    const response = await queryOllama(model, systemPrompt);

    // Versuch JSON zu parsen
    let jsonResponse;
    try {
      jsonResponse = JSON.parse(response);
    } catch {
      jsonResponse = {
        zusammenfassung: response,
        quellen: urls,
      };
    }

    res.json(jsonResponse);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Interner Fehler", details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
