// DeepSearch.js
import express from "express";
import axios from "axios";
import bodyParser from "body-parser";
import * as cheerio from "cheerio";
import { spawn } from "child_process";

const app = express();
app.use(bodyParser.json());
const PORT = 6456;

// --- DuckDuckGo Suche (Titel + URL + Snippet) ---
async function searchDuckDuckGo(query, limit = 5) {
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

  $("div.result__body").each((i, el) => {
    if (i >= limit) return false;
    const title = $(el).find("a.result__a").text();
    const url = $(el).find("a.result__a").attr("href");
    const desc = $(el).find("a.result__snippet").text() || "";
    results.push({ title, url, desc });
  });

  return results;
}

// --- Ollama Anfrage ---
async function queryOllama(model, prompt) {
  return new Promise((resolve, reject) => {
    let output = "";
    const ollama = spawn("ollama", ["run", model], { stdio: ["pipe", "pipe", "inherit"] });
    ollama.stdin.write(prompt);
    ollama.stdin.end();

    ollama.stdout.on("data", (data) => {
      output += data.toString();
    });

    ollama.on("close", () => resolve(output.trim()));
    ollama.on("error", (err) => reject(err));
  });
}

// --- Endpoint ---
app.post("/", async (req, res) => {
  try {
    const { stichwort, model } = req.body;
    if (!stichwort || !model) {
      return res.status(400).json({ error: "Stichwort und Modell müssen angegeben werden." });
    }

    // 1. Ollama: 15 verwandte Suchwörter generieren
    const promptKeywords = `
Erstelle 15 verwandte Suchbegriffe zu: "${stichwort}".
Antworte nur als JSON-Array von Strings.
`;
    let keywordsRaw = await queryOllama(model, promptKeywords);
    let keywords;
    try {
      keywords = JSON.parse(keywordsRaw);
    } catch {
      // fallback: einfache Trennung nach Komma
      keywords = keywordsRaw.split(/\r?\n|,/).map(k => k.trim()).filter(k => k).slice(0, 15);
    }

    // 2. Suche: für jedes Keyword die DuckDuckGo Ergebnisse
    const allResults = [];
    for (const word of keywords) {
      const results = await searchDuckDuckGo(word, 5);
      allResults.push(...results);
    }

    // 3. In 3 Blöcke à 5 Ergebnisse teilen
    const blocks = [];
    for (let i = 0; i < 3; i++) {
      blocks.push(allResults.slice(i * 5, i * 5 + 5));
    }

    // 4. Ollama: jede 5er-Gruppe zusammenfassen
    const blockSummaries = [];
    for (const block of blocks) {
      const promptBlock = `
Fasse die folgenden 5 Suchergebnisse zusammen:

${block.map(r => `Titel: ${r.title}\nURL: ${r.url}\nBeschreibung: ${r.desc}`).join("\n\n")}

Antworte NUR mit Text in Deutsch.
`;
      const summary = await queryOllama(model, promptBlock);
      blockSummaries.push(summary);
    }

    // 5. Finale Zusammenfassung
    const finalPrompt = `
Fasse die folgenden 3 Zusammenfassungen zusammen und erstelle eine detaillierte, gut lesbare Version:

${blockSummaries.map((s, i) => `Block ${i + 1}:\n${s}`).join("\n\n")}

Antwortformat NUR als JSON:
{
  "zusammenfassung": "DEIN TEXT HIER",
  "quellen": [${allResults.map(r => `"${r.url}"`).join(", ")}]
}
`;
    let finalSummary = await queryOllama(model, finalPrompt);

    // Versuch JSON zu parsen
    let jsonResponse;
    try {
      jsonResponse = JSON.parse(finalSummary);
    } catch {
      jsonResponse = {
        zusammenfassung: finalSummary,
        quellen: allResults.map(r => r.url),
      };
    }

    res.json(jsonResponse);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Interner Fehler", details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`DeepSearch Server läuft auf Port ${PORT}`);
});
 