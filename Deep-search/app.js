import express from "express";
import axios from "axios";
import bodyParser from "body-parser";
import * as cheerio from "cheerio";

const app = express();
app.use(bodyParser.json());
const PORT = 6456;

// === Ollama per Netzwerk abfragen ===
const OLLAMA_HOST = "host.docker.internal"; // z.B. Hostname oder IP deines Ollama-Servers
const OLLAMA_PORT = 11434;       // Standardport der API

const queryOllama = async (model, prompt, timeoutMs = 60000) => {
  try {
    const response = await axios.post(
      `http://${OLLAMA_HOST}:${OLLAMA_PORT}/v1/completions`,
      {
        model: model,
        prompt: prompt,
        max_tokens: 500
      },
      {
        timeout: timeoutMs,
        headers: {
          "Content-Type": "application/json"
          // Falls notwendig: "Authorization": "Bearer <API_KEY>"
        }
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
};

// === Axios mit Timeout Wrapper ===
const axiosWithTimeout = async (url, options, timeoutMs = 30000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await axios({ url, ...options, signal: controller.signal });
    clearTimeout(timeout);
    return response;
  } catch (error) {
    clearTimeout(timeout);
    throw new Error(`Axios error: ${error.message}`);
  }
};

// === DuckDuckGo Suche ===
async function searchDuckDuckGo(query, limit = 5) {
  try {
    const res = await axiosWithTimeout(
      "https://html.duckduckgo.com/html/",
      {
        method: "POST",
        data: new URLSearchParams({ q: query }).toString(),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0"
        }
      },
      30000
    );

    const $ = cheerio.load(res.data);
    const results = [];

    $("div.result__body").each((i, el) => {
      if (i >= limit) return false;
      const title = $(el).find("a.result__a").text().trim();
      const url = $(el).find("a.result__a").attr("href");
      const desc = $(el).find("a.result__snippet").text().trim() || "";
      if (url && title) {
        results.push({ title, url, desc });
      }
    });

    return results;
  } catch (error) {
    console.error(`DuckDuckGo search error for "${query}": ${error.message}`);
    return [];
  }
}

// === Endpoint ===
app.post("/", async (req, res) => {
  try {
    const { stichwort, model } = req.body;
    if (!stichwort || !model) {
      return res.status(400).json({ error: "Stichwort und Modell müssen angegeben werden." });
    }

    // 1. Ollama: 10 verwandte Suchbegriffe generieren
    const promptKeywords = `
Erstelle 10 verwandte Suchbegriffe zu: "${stichwort}". Antworte nur als JSON-Array von Strings.
`;
    let keywordsRaw;
    try {
      keywordsRaw = await queryOllama(model, promptKeywords, 60000);
    } catch (error) {
      return res.status(500).json({ error: "Fehler bei der Keyword-Generierung", details: error.message });
    }

    let keywords;
    try {
      const cleanedKeywords = keywordsRaw.replace(/```json/g, '').replace(/```/g, '').trim();
      keywords = JSON.parse(cleanedKeywords);
      if (!Array.isArray(keywords)) throw new Error("Keywords sind kein Array");
    } catch (error) {
      keywords = keywordsRaw.split(/\r?\n|,/).map(k => k.trim()).filter(k => k).slice(0, 10);
    }

    // 2. DuckDuckGo-Suche parallel
    const searchPromises = keywords.map(word => searchDuckDuckGo(word, 5));
    const allResults = (await Promise.all(searchPromises)).flat();

    // 3. In 3 Blöcke à 5 Ergebnisse teilen
    const blocks = [];
    for (let i = 0; i < 3; i++) {
      blocks.push(allResults.slice(i * 5, i * 5 + 5));
    }

    // 4. Ollama: Jede 5er-Gruppe zusammenfassen
    const blockSummaries = [];
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (block.length === 0) {
        blockSummaries.push("Keine Ergebnisse für diesen Block verfügbar.");
        continue;
      }
      const promptBlock = `
Fasse die folgenden ${block.length} Suchergebnisse präzise zusammen (max. 100 Wörter pro Block):

${block.map(r => `Titel: ${r.title}\nURL: ${r.url}\nBeschreibung: ${r.desc}`).join("\n\n")}

Antworte nur mit Text in Deutsch.
`;
      try {
        const summary = await queryOllama(model, promptBlock, 120000);
        blockSummaries.push(summary || "Keine Zusammenfassung verfügbar.");
      } catch (error) {
        const fallbackSummary = block.map(r => `${r.title}: ${r.desc}`).join("\n") || "Keine Zusammenfassung verfügbar.";
        blockSummaries.push(fallbackSummary);
      }
    }

    // 5. Finale Zusammenfassung
    const finalPrompt = `
Fasse die folgenden 3 Zusammenfassungen zusammen und erstelle eine detaillierte, gut lesbare Version (max. 700 Wörter):

${blockSummaries.map((s, i) => `Block ${i + 1}:\n${s}`).join("\n\n")}

Antworte nur mit einem JSON-Objekt:
{
  "zusammenfassung": "DEIN TEXT HIER",
  "quellen": [${allResults.map(r => `"${r.url}"`).join(", ")}]
}
`;
    let finalSummary;
    try {
      finalSummary = await queryOllama(model, finalPrompt, 300000);
    } catch (error) {
      const fallbackSummary = blockSummaries.join("\n\n") || "Keine Zusammenfassung verfügbar.";
      return res.json({
        zusammenfassung: fallbackSummary,
        quellen: allResults.map(r => r.url).filter(url => url && url.startsWith("http"))
      });
    }

    // JSON parsen
    let jsonResponse;
    try {
      const cleanedSummary = finalSummary.replace(/```json/g, '').replace(/```/g, '').trim();
      jsonResponse = JSON.parse(cleanedSummary);
      if (!jsonResponse.zusammenfassung || !Array.isArray(jsonResponse.quellen)) {
        throw new Error("Invalid JSON format");
      }
      jsonResponse.quellen = jsonResponse.quellen.filter(url => url && url.startsWith("http"));
    } catch (error) {
      jsonResponse = {
        zusammenfassung: blockSummaries.join("\n\n") || "Keine Zusammenfassung verfügbar.",
        quellen: allResults.map(r => r.url).filter(url => url && url.startsWith("http"))
      };
    }

    res.json(jsonResponse);

  } catch (err) {
    console.error("DeepSearch error:", err);
    res.status(500).json({ error: "Interner Fehler", details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`DeepSearch Server läuft auf Port ${PORT}`);
});
