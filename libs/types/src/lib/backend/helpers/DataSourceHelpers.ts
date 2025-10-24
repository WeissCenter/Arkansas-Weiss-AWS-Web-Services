import { DynamoDBClient, QueryInput, ScanInput } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { DataSource } from "../DataSource";
import { DataCollectionTemplate, DataSet } from "../DataSet";
import { DataSetQueueStatus } from "../DataSetQueueStatus";
import { DataView, DBDataView } from "../../DataView";

export function updateDataSetLastPullDate(db: any, TABLE_NAME: string, dataViewID: string, user: string) {
  const updateParams = {
    TableName: TABLE_NAME,
    Key: {
      type: "DataView",
      id: `ID#${dataViewID}`
    },
    UpdateExpression: "SET lastPull = :lastPull, pulledBy = :pulledBy",
    ExpressionAttributeValues: {
      ":lastPull": `${Date.now()}`,
      ":pulledBy": user
    }
  };

  return db.update(updateParams);
}
export function updateDataViewQueueStatus(db: any, TABLE_NAME: string, dataSetID: string, status: DataSetQueueStatus) {
  const updateParams = {
    TableName: TABLE_NAME,
    Key: {
      type: "DataView",
      id: `ID#${dataSetID}`
    },
    UpdateExpression: "SET #status = :dataPullStatus",
    ExpressionAttributeValues: {
      ":dataPullStatus": status
    },
    ExpressionAttributeNames: {
      "#status": "status"
    }
  };

  return db.update(updateParams);
}

export function updateDataSetQueueStatus(db: any, TABLE_NAME: string, dataViewID: string, status: DataSetQueueStatus) {
  const updateParams = {
    TableName: TABLE_NAME,
    Key: {
      type: "DataView",
      id: `ID#${dataViewID}`
    },
    UpdateExpression: "SET #status = :status",
    ExpressionAttributeNames: {
      "#status": "status"
    },
    ExpressionAttributeValues: {
      ":status": status
    }
  };

  return db.update(updateParams);
}

export async function getDatasourceMetadata(db: any, TABLE_NAME: string, dataSourceID: string): Promise<DataSource | undefined> {
  const getParams = {
    TableName: TABLE_NAME,
    Key: {
      type: "DataSource",
      id: `ID#${dataSourceID}`
    }
  };

  const result = await db.get(getParams);

  return result?.Item as DataSource;
}

export async function getDataView(db: any, TABLE_NAME: string, dataViewID: string): Promise<DataView | undefined> {
  const getParams = {
    TableName: TABLE_NAME,
    Key: {
      type: "DataView",
      id: `ID#${dataViewID}`
    }
  };

  const result = await db.get(getParams);

  return result?.Item as DBDataView;
}

export async function getDataSet(db: any, TABLE_NAME: string, dataSetID: string): Promise<DataSet | undefined> {
  const getParams = {
    TableName: TABLE_NAME,
    Key: {
      type: "DataSet",
      id: `ID#${dataSetID}`
    }
  };

  const result = await db.get(getParams);

  return result?.Item as DataSet;
}

export async function getDataCollectionTemplate(db: any, TABLE_NAME: string, collectionID: string): Promise<DataCollectionTemplate | undefined> {
  const getParams = {
    TableName: TABLE_NAME,
    Key: {
      type: "DataCollection",
      id: `ID#${collectionID}`
    }
  };

  const result = await db.get(getParams);

  return result?.Item as DataCollectionTemplate;
}
