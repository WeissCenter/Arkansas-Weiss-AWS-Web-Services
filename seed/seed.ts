import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument, PutCommandInput } from "@aws-sdk/lib-dynamodb";
import { TranslateClient, TranslateTextCommand } from "@aws-sdk/client-translate";
import { readFileSync } from "fs";
import { globSync } from "glob";

const SOURCE_LANGUAGE = "en";
type SourceLang = typeof SOURCE_LANGUAGE;

const TARGET_LANGUAGES = (() => {
  // read the settings.json file to get the target languages
  const settingsData = readFileSync("./seed/AdaptSettings/settings.json").toString();
  const settingsJSON = JSON.parse(settingsData);
  return settingsJSON.supportedLanguages.filter((lang: string) => lang !== SOURCE_LANGUAGE);
})();

// The generic glossary file is under the /res folder, and the custom glossary files are under the /seed/AdaptSettings folder.
// To replace any of the generic glossary for a given State for example Arkansas, the changes have to be made in the state-custom-glossary.json file.
// In the internal private repo adapt-cdk the generic and custom glossary files are the same. The generic glossary file will always be a reference and
// will never be used anywhere in the application other than for comparison with the custom glossary file.

console.log("GLOSSARY_TERMS: ", process.env.GLOSSARY_TERMS, ", process.env.AWS_DEFAULT_REGION: ", process.env.AWS_DEFAULT_REGION, ", process.env.AWS_RESOURCE_UNIQUE_ID: ", process.env.AWS_RESOURCE_UNIQUE_ID);

const TRANSLATE_CONFIG: Record<FilePath, FileTranslateConfig> = {
  [`seed/AdaptSettings/${process.env.GLOSSARY_TERMS}`]: {
    sourceLang: SOURCE_LANGUAGE,
    targetLangs: TARGET_LANGUAGES,
    ignoreKeys: ["type", "id"],
    afterTranslate: (translatedJSON, sourceLang, targetLang) => {
      translatedJSON.id = `ID#current#LANG#${targetLang}`;
      return translatedJSON;
    }
  }
};

// AWS SDK clients
const client = new DynamoDBClient({ region: process.env.AWS_DEFAULT_REGION });
const translateClient = new TranslateClient({ region: process.env.AWS_DEFAULT_REGION });
const db = DynamoDBDocument.from(client);

// Type definitions
type TranslatedJSON = any;
type FileTranslateConfig = {
  sourceLang: SourceLang;
  targetLangs: string[];
  ignoreKeys?: string[];
  afterTranslate?: (translatedJSON: TranslatedJSON, sourceLang: string, targetLang: string) => TranslatedJSON;
};
type FilePath = string;

function putIfNotExists(Item: any, TableName: string, force = false) {
  console.log(`Inside putIfNotExists for table: ${TableName} with Item: ${Item.type} ${Item.id}`);

  const params: PutCommandInput = {
    TableName,
    Item,
    ConditionExpression: force ? undefined : "attribute_not_exists(id)"
  };
  return db
    .put(params)
    .then(() => {
      console.log(`Successfully put ${Item.type} ${Item.id} in ${TableName}`);
    })
    .catch((err) => {
      //console.log(`Catching exception in putIfNotExists, err: `, err);
      if (err instanceof ConditionalCheckFailedException) {
        console.log(`Skipping ${Item.type} ${Item.id} in ${TableName} due to existing item`);
      } else {
        console.error("Error: ", err);

        console.error(`Failed to put ${Item.type} ${Item.id} in ${TableName} using force: ${force}`);
      }
    });
}

async function translateJSON(sourceLang: string, lang: string, originalLoadedJSON: any, ignoreKeys: string[] = []) {
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
        const result = await translateClient.send(translateCommand);
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

async function translateFile(filePath: string, fileData: any) {
  console.log(`Inside translateFile for filePath: ${filePath}`);
  const translateConfig = TRANSLATE_CONFIG[filePath];

  if (!translateConfig) return;
  const translatedJSONs = await Promise.allSettled(
    translateConfig.targetLangs.map(async (lang) => {
      let translatedJSON = await translateJSON(translateConfig.sourceLang, lang, fileData, translateConfig.ignoreKeys);
      if (translateConfig.afterTranslate) {
        translatedJSON = translateConfig.afterTranslate(translatedJSON, translateConfig.sourceLang, lang);
      }

      return translatedJSON;
    })
  );
  // log out the index of any rejected translations
  for (const [index, result] of translatedJSONs.entries()) {
    if (result.status === "rejected") {
      console.error(`Failed to translate ${filePath} into ${translateConfig.targetLangs[index]}: ${result.reason}`);
    }
  }
  return translatedJSONs.filter((result): result is PromiseFulfilledResult<TranslatedJSON> => result.status === "fulfilled").map((result) => result.value);
}

(async () => {
  const settingJSONs = globSync("./seed/AdaptSettings/*.json");
  const settingsTableName = `${process.env.AWS_RESOURCE_UNIQUE_ID}-AdaptSettings`;

  const templateJSONs = globSync("./seed/AdaptTemplates/*.json");
  const templatesTableName = `${process.env.AWS_RESOURCE_UNIQUE_ID}-AdaptTemplates`;

  // settingsFilePath: seed/AdaptSettings/settings.json
  for (const settingsFilePath of settingJSONs) {
    const isGlossaryFile = settingsFilePath.includes("glossary.json");
    console.log("isGlossaryFile: ", isGlossaryFile);

    // if we have a glossary file and it is not the default file, meaning it is a custom file for a given state
    if (isGlossaryFile && process.env.GLOSSARY_TERMS && !settingsFilePath.endsWith(process.env.GLOSSARY_TERMS)) {
      console.log(`Skipping ${settingsFilePath} seed due to GLOSSARY_TERMS is different: ${process.env.GLOSSARY_TERMS}`);
      continue;
    }

    console.log(`Processing file: ${settingsFilePath} `);

    // do not override existing setting but anything else will be whipped and re-seeded like glossary files
    const force = !settingsFilePath.includes("settings.json"); // do not force put for settings.json
    const data = readFileSync(settingsFilePath).toString();

    const parsedData = JSON.parse(data);
    await putIfNotExists(parsedData, settingsTableName, force);

    // Create and store translation if applicable
    const translatedJSONs = await translateFile(settingsFilePath, parsedData);
    if (translatedJSONs && translatedJSONs.length > 0) {
      for (const translatedJSON of translatedJSONs) {
        await putIfNotExists(translatedJSON, settingsTableName, force);
      }
    }
  }

  for (const template of templateJSONs) {
    const force = true; // always force put for templates
    const data = readFileSync(template).toString();

    console.log(`Processing template file: ${template} `);
    const parsedData = JSON.parse(data);
    await putIfNotExists(parsedData, templatesTableName, force);

    // Create and store translation if applicable
    const translatedJSONs = await translateFile(template, parsedData);
    if (translatedJSONs && translatedJSONs.length > 0) {
      for (const translatedJSON of translatedJSONs) {
        await putIfNotExists(translatedJSON, templatesTableName, force);
      }
    }
  }
})();
