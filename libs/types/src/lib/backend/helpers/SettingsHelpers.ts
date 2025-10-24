import { AdaptGlossary, AdaptSettings } from "../../AdaptSettings";

export async function getAdaptSettings(db: any, TABLE_NAME: string, settingsID = "default"): Promise<AdaptSettings | undefined> {
  const getParams = {
    TableName: TABLE_NAME,
    Key: {
      type: "Settings",
      id: `ID#${settingsID}`
    }
  };

  const result = await db.get(getParams);

  return result?.Item as AdaptSettings;
}

export async function getAdaptGlossary(db: any, TABLE_NAME: string, glossaryID = "default", lang = "en"): Promise<AdaptGlossary | undefined> {
  const getParams = {
    TableName: TABLE_NAME,
    Key: {
      type: "Glossary",
      id: `ID#${glossaryID}#LANG#${lang}`
    }
  };

  const result = await db.get(getParams);

  return result?.Item;
}
