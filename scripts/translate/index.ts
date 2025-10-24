import { TranslateClient, TranslateTextCommand } from "@aws-sdk/client-translate";
import { program } from "commander";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const client = new TranslateClient({ region: "us-east-1" });

program
  .requiredOption("-sl, --sourceLang [sourceLang]", "specify source language", "en")
  .requiredOption("-f, --file [file]", "specify file")
  .requiredOption("-l, --langs [languages...]", "specify languages")
  .option("-i, --ignore-keys [keys...]", "object keys to skip translating");

if (require.main === module) {
  (async () => {
    program.parse();
    const { sourceLang, file, langs, ignoreKeys } = program.opts();

    if (!existsSync(file)) throw Error("file does not exist");

    const loadedJSONStr = readFileSync(file).toString();

    const originalLoadedJSON = JSON.parse(loadedJSONStr);

    for (const lang of langs) {
      const result = await translateJSON(sourceLang, lang, originalLoadedJSON, ignoreKeys);

      const outputPath = join(process.cwd(), "translated", lang);

      if (!existsSync(outputPath)) mkdirSync(outputPath, { recursive: true });

      writeFileSync(`${outputPath}/${file}`, JSON.stringify(result, null, 2));
    }
  })();
}

export async function translateJSON(sourceLang: string, lang: string, originalLoadedJSON: any, ignoreKeys: string[] = []) {
  let stack: any[] = [];

  const handleValue = async (value: any, lang: string, root?: any, key?: any) => {
    switch (typeof value) {
      case "number":
      case "bigint":
      case "string": {
        if (typeof value === "string" && value.length <= 0) return;

        const translateCommand = new TranslateTextCommand({
          Text: `${value}`,
          SourceLanguageCode: sourceLang,
          TargetLanguageCode: lang
        });
        const result = await client.send(translateCommand);
        root[key] = result.TranslatedText;
        break;
      }
      case "object": {
        stack.push(value);
        break;
      }
    }
  };

  const loadedJSON = structuredClone(originalLoadedJSON);

  stack = [loadedJSON];

  while (stack.length) {
    const root = stack.pop();

    if (Array.isArray(root)) {
      for (let i = 0; i < root.length; i++) {
        await handleValue(root[i], lang, root, i);
      }
      continue;
    }

    for (const [key, value] of Object.entries(root)) {
      if (ignoreKeys?.includes(key)) continue;
      await handleValue(value, lang, root, key);
    }
  }

  return loadedJSON;
}
