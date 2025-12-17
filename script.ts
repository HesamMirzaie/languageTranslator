import fs from 'fs';
import path from 'path';

import fa from '../../packages/logic/src/locales/fa.ts';

// ---------------- CONFIG ----------------
const RAPIDAPI_KEY = env.procces.apiKey;
// -----------------------------------------

const persianSentenceRegex = /([\u0600-\u06FF][\u0600-\u06FF\s،.!؟]*)/g;

function isNotComment(line: string) {
  const t = line.trim();
  return !(t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.endsWith('*/'));
}

function generateKey(english: string) {
  return english
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .map((word, i) => (i === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join('');
}

function flatten(obj: any, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key in obj) {
    const value = obj[key];
    const newPrefix = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      result[value] = newPrefix;
    } else if (typeof value === 'object') {
      Object.assign(result, flatten(value, newPrefix));
    }
  }
  return result;
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
    console.error('Usage: tsx replaceOrTranslatePersian.ts <file-path>');
    process.exit(1);
  }

  const resolvedPath = path.resolve(filePath);
  const relativePath = path.relative(process.cwd(), resolvedPath).replace(/\\/g, '/');
  let content = fs.readFileSync(resolvedPath, 'utf8');
  const lines = content.split(/\r?\n/);

  const sentences = new Set<string>();
  for (const line of lines) {
    if (!isNotComment(line)) continue;
    const matches = line.match(persianSentenceRegex);
    if (matches) matches.forEach((m) => sentences.add(m.trim()));
  }

  // Flatten fa.ts (unwrap default if exists)
  const persianMap = flatten((fa as any).default ?? fa);

  // Load existing persian.json
  const outputPath = path.join(process.cwd(), 'persian.json');
  let existingJSON: any[] = [];
  if (fs.existsSync(outputPath)) {
    try {
      existingJSON = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    } catch (e) {
      console.warn('Failed to parse existing persian.json, starting fresh');
      existingJSON = [];
    }
  }

  const matchApp = relativePath.match(/^packages\/([^/]+)\//);
  const appName = matchApp ? matchApp[1] : 'unknown';
  const appTranslations = existingJSON.find((e) => e.appName === appName)?.translation ?? [];

  let translationsToAdd: { key: string; persian: string; english: string; type: string }[] = [];

  for (const persian of sentences) {
    let key: string;

    if (persianMap[persian]) {
      // Exists in fa.ts
      key = persianMap[persian];
    } else {
      // Check if exists in persian.json
      const existing = appTranslations.find((t: any) => t.persian === persian);
      if (existing) {
        key = `${appName}.literal.${existing.key}`; // prepend app name
      } else {
        // Translate new string
        const english = await translateText(persian);
        key = `${appName}.literal.${generateKey(english)}`;
        translationsToAdd.push({
          key: key.replace(`${appName}.literal.`, ''), // store key without appName in JSON
          persian,
          english,
          type: 'literal',
        });
        console.log(`✔ New translation: ${key} → ${persian}`);
      }
    }

    const escapedPersian = persian.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Replace JSX children
    const jsxRegex = new RegExp(`>(\\s*${escapedPersian}\\s*)<`, 'g');
    content = content.replace(jsxRegex, `>{t('${key}')}<`);

    // Replace strings in quotes
    const quoteRegex = new RegExp(`(["'\`])${escapedPersian}\\1`, 'g');
    content = content.replace(quoteRegex, (_, __, offset) => {
      const charBefore = content[offset - 1];
      return charBefore === '=' ? `{t('${key}')}` : `t('${key}')`;
    });
  }

  // Write updated file
  fs.writeFileSync(resolvedPath, content, 'utf8');

  // Update persian.json
  existingJSON = existingJSON.filter((e) => e.filepath !== relativePath);
  if (translationsToAdd.length > 0) {
    existingJSON.push({
      filepath: relativePath,
      appName,
      translation: translationsToAdd,
    });
    fs.writeFileSync(outputPath, JSON.stringify(existingJSON, null, 2), 'utf8');
    console.log(`\nSaved ${translationsToAdd.length} new translations to persian.json`);
  }

  console.log(`✔ Finished processing ${relativePath}`);
}

main().catch(console.error);
