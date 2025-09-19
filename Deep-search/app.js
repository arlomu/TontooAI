import express from "express";
import axios from "axios";
import bodyParser from "body-parser";
import * as cheerio from "cheerio";
import { spawn } from "child_process";

const app = express();
app.use(bodyParser.json());
const PORT = 6456;

// Timeout-Wrapper für Axios
const axiosWithTimeout = async (url, options, timeoutMs = 30000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await axios({ url, ...options, signal: controller.signal });
    clearTimeout(timeout);
    return response;
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
};

// Timeout-Wrapper für Ollama
const queryOllama = (model, prompt, timeoutMs = 60000) => {
  return new Promise((resolve, reject) => {
    let output = "";
    const ollama = spawn("ollama", ["run", model], { stdio: ["pipe", "pipe", "inherit"] });
    ollama.stdin.write(prompt);
    ollama.stdin.end();

    const timeout = setTimeout(() => {
      ollama.kill();
      reject(new Error("Ollama-Anfrage hat das Zeitlimit überschritten"));
    }, timeoutMs);

    ollama.stdout.on("data", (data) => {
      output += data.toString();
    });

    ollama.on("close", () => {
      clearTimeout(timeout);
      resolve(output.trim());
    });

    ollama.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
};

// --- DuckDuckGo Suche (Titel + URL + Snippet) ---
async function searchDuckDuckGo(query, limit = 5) {
  try {
    const res = await axiosWithTimeout(
      "https://html.duckduckgo.com/html/",
      {
        method: "POST",
        data: new URLSearchParams({ q: query }).toString(),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0",
        },
      },
      30000 // 30 Sekunden Timeout
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
    console.error(`Fehler bei DuckDuckGo-Suche für "${query}":`, error.message);
    return [];
  }
}

// --- Endpoint ---
app.post("/", async (req, res) => {
  try {
    const { stichwort, model } = req.body;
    if (!stichwort || !model) {
      return res.status(400).json({ error: "Stichwort und Modell müssen angegeben werden." });
    }

    // 1. Ollama: 10 verwandte Suchbegriffe generieren
    const promptKeywords = `
Erstelle 10 verwandte Suchbegriffe zu: "${stichwort}". Konzentriere dich auf Begriffe, die thematisch eng mit "${stichwort}" verbunden sind (z. B. für "Erdbeerkuchen" Begriffe wie "Erdbeer-Torte", "Backrezept Erdbeeren", "Erdbeerkuchen Rezept"). 
Antworte nur als JSON-Array von Strings, ohne Markdown oder zusätzlichen Text.
`;
    let keywordsRaw;
    try {
      keywordsRaw = await queryOllama(model, promptKeywords, 60000);
      console.log("Ollama keywords response (raw):", keywordsRaw);
    } catch (error) {
      console.error("Fehler bei Ollama-Keyword-Generierung:", error.message);
      return res.status(500).json({ error: "Fehler bei der Keyword-Generierung", details: error.message });
    }

    let keywords;
    try {
      // Markdown-Markierungen entfernen
      const cleanedKeywords = keywordsRaw
        .replace(/```json\n|\n```/g, '')
        .replace(/```/g, '')
        .trim();
      console.log("Cleaned keywords:", cleanedKeywords);
      keywords = JSON.parse(cleanedKeywords);
      if (!Array.isArray(keywords)) {
        throw new Error("Keywords sind kein Array");
      }
    } catch {
      keywords = keywordsRaw.split(/\r?\n|,/).map(k => k.trim()).filter(k => k).slice(0, 10);
      console.log("Fallback keywords:", keywords);
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
      if (block.length === 0) {
        blockSummaries.push("Keine Ergebnisse für diesen Block verfügbar.");
        continue;
      }
      const promptBlock = `
Fasse die folgenden ${block.length} Suchergebnisse präzise zusammen (max. 100 Wörter pro Block):

${block.map(r => `Titel: ${r.title}\nURL: ${r.url}\nBeschreibung: ${r.desc}`).join("\n\n")}

Antworte NUR mit Text in Deutsch, ohne Markdown oder zusätzlichen Text.
`;
      try {
        const summary = await queryOllama(model, promptBlock, 120000); // 120 Sekunden Timeout
        console.log(`Block-Zusammenfassung ${blockSummaries.length + 1}:`, summary);
        blockSummaries.push(summary || "Keine Zusammenfassung verfügbar.");
      } catch (error) {
        console.error(`Fehler bei Block-Zusammenfassung ${blockSummaries.length + 1}:`, error.message);
        // Fallback: Rohe Suchergebnisse zusammenfassen
        const fallbackSummary = block
          .map(r => `${r.title}: ${r.desc}`)
          .join("\n")
          || "Keine Zusammenfassung verfügbar.";
        blockSummaries.push(fallbackSummary);
      }
    }

    // 5. Finale Zusammenfassung
    const finalPrompt = `
Fasse die folgenden 3 Zusammenfassungen zusammen und erstelle eine detaillierte, gut lesbare Version (max. 300 Wörter):

${blockSummaries.map((s, i) => `Block ${i + 1}:\n${s}`).join("\n\n")}

Antworte NUR mit einem JSON-Objekt, ohne Markdown oder zusätzlichen Text:
{
  "zusammenfassung": "DEIN TEXT HIER",
  "quellen": [${allResults.map(r => `"${r.url}"`).join(", ")}]
}
`;
    let finalSummary;
    try {
      finalSummary = await queryOllama(model, finalPrompt, 300000); // 5 Minuten Timeout
      console.log("Ollama final summary response (raw):", finalSummary);
    } catch (error) {
      console.error("Fehler bei finaler Zusammenfassung:", error.message);
      // Fallback: Kombinierte Blocks ohne erneute Zusammenfassung
      const fallbackSummary = blockSummaries.join("\n\n") || "Keine Zusammenfassung verfügbar.";
      return res.json({
        zusammenfassung: fallbackSummary,
        quellen: allResults.map(r => r.url).filter(url => url && typeof url === "string" && url.startsWith("http"))
      });
    }

    // Versuch JSON zu parsen
    let jsonResponse;
    try {
      // Markdown-Markierungen entfernen
      const cleanedSummary = finalSummary
        .replace(/```json\n|\n```/g, '')
        .replace(/```/g, '')
        .trim();
      console.log("Cleaned final summary:", cleanedSummary);
      jsonResponse = JSON.parse(cleanedSummary);
      if (!jsonResponse.zusammenfassung || !Array.isArray(jsonResponse.quellen)) {
        throw new Error("Ungültiges JSON-Format: zusammenfassung oder quellen fehlen");
      }
      jsonResponse.quellen = jsonResponse.quellen.filter(url => url && typeof url === "string" && url.startsWith("http"));
    } catch (error) {
      console.error("Fehler beim Parsen der finalen Zusammenfassung:", error.message);
      jsonResponse = {
        zusammenfassung: blockSummaries.join("\n\n") || "Keine Zusammenfassung verfügbar.",
        quellen: allResults.map(r => r.url).filter(url => url && typeof url === "string" && url.startsWith("http"))
      };
    }

    res.json(jsonResponse);
  } catch (err) {
    console.error("DeepSearch Fehler:", err);
    res.status(500).json({ error: "Interner Fehler", details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`DeepSearch Server läuft auf Port ${PORT}`);
});
