import {
  ConditionalCheckFailedException,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument, PutCommandInput } from "@aws-sdk/lib-dynamodb";
import {
  TranslateClient,
  TranslateTextCommand,
} from "@aws-sdk/client-translate";
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

const TRANSLATE_CONFIG: Record<FilePath, FileTranslateConfig> = {
  "seed/AdaptSettings/glossary.json": {
    sourceLang: SOURCE_LANGUAGE,
    targetLangs: TARGET_LANGUAGES,
    ignoreKeys: ["type", "id"],
    afterTranslate: (translatedJSON, sourceLang, targetLang) => {
      translatedJSON.id = `ID#current#LANG#${targetLang}`;
      return translatedJSON;
    },
  },
};

// AWS SDK clients
const client = new DynamoDBClient({ region: "us-east-1" });
const translateClient = new TranslateClient({ region: "us-east-1" });
const db = DynamoDBDocument.from(client);

// Type definitions
type TranslatedJSON = any;
type FileTranslateConfig = {
  sourceLang: SourceLang;
  targetLangs: string[];
  ignoreKeys?: string[];
  afterTranslate?: (
    translatedJSON: TranslatedJSON,
    sourceLang: string,
    targetLang: string
  ) => TranslatedJSON;
};
type FilePath = string;


function putIfNotExists(Item: any, TableName: string, force = false) {
  const params: PutCommandInput = {
    TableName,
    Item,
    ConditionExpression: force ? undefined : "attribute_not_exists(id)",
  };
  return db
    .put(params)
    .then(() => {
      console.log(`Successfully put ${Item.type} ${Item.id} in ${TableName}`);
    })
    .catch((err) => {
      if (err instanceof ConditionalCheckFailedException) {
        console.log(
          `Skipping ${Item.type} ${Item.id} in ${TableName} due to existing item`
        );
      } else {
        console.error(err);
        console.error(
          `Failed to put ${Item.type} ${Item.id} in ${TableName} using force: ${force}`
        );
      }
    });
}

async function translateJSON(
  sourceLang: string,
  lang: string,
  originalLoadedJSON: any,
  ignoreKeys: string[] = []
) {
  let stack: any[] = [];

  const handleValue = async (
    value: any,
    lang: string,
    root?: any,
    key?: any
  ) => {
    switch (typeof value) {
      case "number":
      case "bigint":
      case "string": {
        if (typeof value === "string" && value.length <= 0) return;

        const translateCommand = new TranslateTextCommand({
          Text: `${value}`,
          SourceLanguageCode: sourceLang,
          TargetLanguageCode: lang,
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
  const translateConfig = TRANSLATE_CONFIG[filePath];
  if (!translateConfig) return;
  const translatedJSONs =  await Promise.allSettled(
    translateConfig.targetLangs.map(async (lang) => {
      let translatedJSON = await translateJSON(
        translateConfig.sourceLang,
        lang,
        fileData,
        translateConfig.ignoreKeys
      );
      if (translateConfig.afterTranslate) {
        translatedJSON = translateConfig.afterTranslate(
          translatedJSON,
          translateConfig.sourceLang,
          lang
        );
      }

      return translatedJSON;
    })
  );
  // log out the index of any rejected translations
  for (const [index, result] of translatedJSONs.entries()) {
    if (result.status === 'rejected') {
      console.error(`Failed to translate ${filePath} into ${translateConfig.targetLangs[index]}: ${result.reason}`);
    }
  }
  return translatedJSONs
    .filter((result): result is PromiseFulfilledResult<TranslatedJSON> => result.status === 'fulfilled')
    .map(result => result.value);
}

(async () => {
  const settingJSONs = globSync("./seed/AdaptSettings/*.json");
  const settingsTableName = `${process.env.ENVIRONMENT}-AdaptSettings`;

  const templateJSONs = globSync("./seed/AdaptTemplates/*.json");
  const templatesTableName = `${process.env.ENVIRONMENT}-AdaptTemplates`;

  for (const setting of settingJSONs) {
    const force = !setting.includes("settings.json"); // do not force put for settings.json
    const data = readFileSync(setting).toString();

    const parsedData = JSON.parse(data);
    await putIfNotExists(parsedData, settingsTableName, force);
    
    // Create and store translation if applicable
    const translatedJSONs = await translateFile(setting, parsedData);
    if (translatedJSONs && translatedJSONs.length > 0) {
      for (const translatedJSON of translatedJSONs) {
        await putIfNotExists(translatedJSON, settingsTableName, force);
      }
    }
  }

  for (const template of templateJSONs) {
    const force = true; // always force put for templates
    const data = readFileSync(template).toString();

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
