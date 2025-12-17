import fs from 'fs';
import path from 'path';

// ---------------- CONFIG ----------------
const RAPIDAPI_KEY = 'd993f0e705mshacfec6ac3b977c2p1a3e8djsn9982d8b4e30b'; // replace with your RapidAPI key
// -----------------------------------------
// Persian sentence regex (letters + spaces + punctuation)
const persianSentenceRegex = /([\u0600-\u06FF][\u0600-\u06FF\s،.!؟]*)/g;

function isNotComment(line: string): boolean {
  const t = line.trim();
  return !(t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.endsWith('*/'));
}

function generateKey(english: string): string {
  return english
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .map((word, i) => (i === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join('');
}

async function translateText(text: string): Promise<string> {
  try {
    const res = await fetch('https://openl-translate.p.rapidapi.com/translate/bulk', {
      method: 'POST',
      headers: {
        'x-rapidapi-key': RAPIDAPI_KEY,
        'x-rapidapi-host': 'openl-translate.p.rapidapi.com',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        target_lang: 'en',
        text: [text],
      }),
    });

    if (!res.ok) throw new Error(await res.text());

    const json = await res.json();
    return json.translatedTexts?.[0] ?? '';
  } catch (err) {
    console.error('Translate failed:', err);
    return '';
  }
}

async function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error('Usage: tsx findPersian.ts <file-path>');
    process.exit(1);
  }

  const resolvedPath = path.resolve(filePath);
  const relativePath = path.relative(process.cwd(), resolvedPath).replace(/\\/g, '/');

  const content = fs.readFileSync(resolvedPath, 'utf8');
  const lines = content.split(/\r?\n/);

  const sentences = new Set<string>();

  for (const line of lines) {
    if (!isNotComment(line)) continue;

    const matches = line.match(persianSentenceRegex);
    if (matches) {
      matches.forEach((m) => {
        const cleaned = m.trim();
        if (cleaned.length > 1) sentences.add(cleaned);
      });
    }
  }

  const translations = [];

  for (const persian of sentences) {
    const english = await translateText(persian);
    const key = generateKey(english);

    translations.push({
      key,
      persian,
      english,
      type: 'literal',
    });

    console.log(`✔ ${key}: ${persian} → ${english}`);
  }

  // -------- Read existing JSON if exists --------
  const outputPath = path.join(process.cwd(), 'persian.json');
  let existing: any[] = [];

  if (fs.existsSync(outputPath)) {
    try {
      const raw = fs.readFileSync(outputPath, 'utf8');
      existing = JSON.parse(raw);
    } catch (e) {
      console.warn('Failed to parse existing persian.json, starting fresh');
      existing = [];
    }
  }

  // Remove previous entry for this file if exists
  existing = existing.filter((e) => e.filepath !== relativePath);

  // Append new entry
  existing.push({
    filepath: relativePath,
    translation: translations,
  });

  fs.writeFileSync(outputPath, JSON.stringify(existing, null, 2), 'utf8');
  console.log(`\nSaved ${translations.length} translations for ${relativePath} to persian.json`);
}

main().catch(console.error);
