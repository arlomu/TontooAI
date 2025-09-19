// app.js
const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");
const cheerio = require("cheerio");
const { spawn } = require("child_process");

const app = express();
app.use(bodyParser.json());

const PORT = 53564;

// Funktion: DuckDuckGo Suche
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

// Funktion: Anfrage an Ollama Model
async function queryOllama(model, systemPrompt) {
  return new Promise((resolve, reject) => {
    let output = "";
    const ollama = spawn("ollama", ["run", model], { stdio: ["pipe", "pipe", "inherit"] });

    ollama.stdin.write(systemPrompt);
    ollama.stdin.end();

    ollama.stdout.on("data", (data) => {
      output += data.toString();
    });

    ollama.on("close", () => {
      resolve(output.trim());
    });

    ollama.on("error", (err) => reject(err));
  });
}

// Endpoint
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

    // Anfrage an Ollama
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
