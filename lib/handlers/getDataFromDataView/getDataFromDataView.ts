// @ts-nocheck FIXME: come back and fix the possible type errors

import { APIGatewayEvent, Context, Handler } from "aws-lambda";
import {
  CreateBackendResponse,
  CreateBackendErrorResponse,
  DataSetOperationArgument,
  GetDataFromDataViewInput,
  GetDataFromDataViewOutput,
  getDataView,
  getAggregateAthenaResults,
  AdaptSettings
} from "../../../libs/types/src";
import { AthenaClient, Datum, ResultSet, GetQueryResultsCommand, StartQueryExecutionCommand, GetQueryExecutionCommand, QueryExecutionState } from "@aws-sdk/client-athena";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { LambdaClient, InvokeCommand, LogType } from "@aws-sdk/client-lambda";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { Kysely, SqliteAdapter, DummyDriver, SqliteIntrospector, SqliteQueryCompiler, SelectQueryBuilder, sql, ColumnDataType, AliasableExpression } from "kysely";
import * as log4js from "log4js";

// Define Environment Variables
const TABLE_NAME = process.env.TABLE_NAME || "";
const CATALOG = process.env.CATALOG || "";
const BUCKET = process.env.BUCKET || "";
const SUPPRESSION_SERVICE_FUNCTION = process.env.SUPPRESSION_SERVICE_FUNCTION || "";
const ATHENA_QUERY_RATE = parseInt(process.env.ATHENA_QUERY_RATE || "1000");
const SETTINGS_TABLE = process.env.SETTINGS_TABLE || "";

export const handler: Handler = async (event: APIGatewayEvent, context: Context) => {
  // AWS SDK Clients
  const client = new DynamoDBClient({ region: "us-east-1" });
  const db = DynamoDBDocument.from(client);
  const lambdaClient = new LambdaClient({ region: "us-east-1" });
  const athenaClient = new AthenaClient({ region: "us-east-1" });

  const queryBuilder = new Kysely<any>({
    dialect: {
      createAdapter: () => new SqliteAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new SqliteIntrospector(db),
      createQueryCompiler: () => new SqliteQueryCompiler()
    }
  });

  console.log(event);
  try {
    if (!event?.body) {
      return CreateBackendErrorResponse(400, "Missing body");
    }

    const dataViewID = event.pathParameters?.["dataViewID"];
    if (!dataViewID) {
      return CreateBackendErrorResponse(400, "Missing dataViewID in path parameters");
    }

    const previewSuppression = event?.queryStringParameters?.["previewSuppression"] === "true";

    const dataSet = await getDataView(db, TABLE_NAME, dataViewID);

    if (!dataSet) {
      return CreateBackendErrorResponse(404, "Dataset does not exist");
    }

    if (!dataSet.lastPull) {
      return CreateBackendErrorResponse(400, "A Pull has not been run for this data set");
    }

    const { operations, suppression, fileSpec } = JSON.parse(event.body) as GetDataFromDataViewInput;

    const dataViewCode = `${dataSet.dataViewID.replace(/[-]/g, "_")}`;

    const aggregateResults = await getAggregateAthenaResults(operations, queryBuilder, dataViewCode, athenaClient, ATHENA_QUERY_RATE, CATALOG, BUCKET);

    if (previewSuppression && suppression?.required) {
      const settings = await getSettings(db, SETTINGS_TABLE);

      const command = new InvokeCommand({
        FunctionName: SUPPRESSION_SERVICE_FUNCTION,
        Payload: JSON.stringify({
          data: aggregateResults,
          threshold: settings.nSize || 30,
          ...suppression
        }),
        LogType: LogType.Tail
      });

      const { Payload } = await lambdaClient.send(command);
      const result = Buffer.from(Payload!).toString();

      const output: GetDataFromDataViewOutput = {
        operationResults: JSON.parse(result)
      };

      return CreateBackendResponse(200, output);
    }

    const output: GetDataFromDataViewOutput = {
      operationResults: aggregateResults as any
    };

    return CreateBackendResponse(200, output);
  } catch (err) {
    console.error(err);
    return CreateBackendErrorResponse(500, "Failed to retrieve data");
  }
};

function createConditions(query, conditions: DataSetOperationArgument[], groupBy?: string) {
  query = query.where(({ eb, or, and, not, exists, selectFrom }: any) => {
    const conds = conditions.map((field) => {
      if (field.array) {
        return or(field.value.map((val) => eb(field.field, field.operator === "NOT" ? "!=" : "=", `'${val}'`)));
      }

      return eb(field.field, field.operator === "NOT" ? "!=" : "=", `'${field.value}'`);
    });

    if (groupBy && Array.isArray(groupBy)) {
      groupBy.forEach((field) => conds.push(eb(field, "!=", "''")));
    }

    if (groupBy && !Array.isArray(groupBy)) {
      conds.push(eb(groupBy, "!=", "''"));
    }

    return and(conds);
  });

  return query;
}

function mapDatum(datum: Datum, type: string) {
  switch (type) {
    case "varchar": {
      return datum.VarCharValue || "";
    }
    case "bigint":
    case "integer": {
      return parseInt(datum.VarCharValue || "0");
    }
    case "double":
    case "float":
    case "real": {
      return parseFloat(datum.VarCharValue || "0");
    }
  }
}

function mapAthenaQueryResults(resultSet: ResultSet) {
  const { ColumnInfo } = resultSet.ResultSetMetadata;

  return (resultSet.Rows || [null]).slice(1).map((item, index) => {
    const subData = (item.Data || []).reduce(
      (accum, val, idx) =>
        Object.assign(accum, {
          [ColumnInfo[idx].Name]: mapDatum(val, ColumnInfo[idx].Type)
        }),
      {}
    );

    return subData;
  });
}

async function queryAthena(compiled, athenaClient: AthenaClient, ATHENA_QUERY_RATE = 1000) {
  const params = {
    QueryString: compiled.sql,
    ResultReuseConfiguration: {
      ResultReuseByAgeConfiguration: {
        Enabled: true,
        MaxAgeInMinutes: 60
      }
    },
    QueryExecutionContext: {
      Database: CATALOG
    },
    ExecutionParameters: compiled.parameters.length ? (compiled.parameters as any[]) : null,
    ResultConfiguration: { OutputLocation: `s3://${BUCKET}/` }
  };

  console.log("athena params", params);
  const athenaCommand = new StartQueryExecutionCommand(params);

  console.log("athena command", athenaCommand);

  const startCommandResult = await athenaClient.send(athenaCommand);

  console.log("startCommandResult", startCommandResult);

  console.log("getQueryResultInputs", athenaClient, startCommandResult.QueryExecutionId, ATHENA_QUERY_RATE);

  const resultSet = await getQueryResult(athenaClient, startCommandResult.QueryExecutionId, ATHENA_QUERY_RATE);

  console.log("result set", resultSet);
  return resultSet;
}

function doSort(items: any[], order: DataSetOperationArgument) {
  if ((order.array && order.value.length < 2) || !order.value?.length) {
    return items;
  }

  const [sortDirection, field] = order.value;

  return items.sort((a, b) => {
    const fieldType = typeof a[field];

    switch (fieldType) {
      case "string": {
        if (sortDirection === "DESC") {
          return b[field].localeCompare(a[field]);
        } else if (sortDirection === "ASC") {
          return a[field].localeCompare(b[field]);
        }
        break;
      }
      case "number": {
        if (sortDirection === "DESC") {
          return b[field] - a[field];
        } else if (sortDirection === "ASC") {
          return a[field] - b[field];
        }
        break;
      }
    }
  });
}

function createLimitString(limit: DataSetOperationArgument) {
  return `LIMIT ${limit.value}`;
}

function mapField(field: { field: string; type: string; value: any }) {
  if (field?.type || field.type === "string") {
    return `${field.field} = '${field.value}'`;
  }

  if (field.type === "number") {
    return `${field.field} = ${field.value}`;
  }
}

async function getQueryResult(athena: AthenaClient, id: string, ATHENA_QUERY_RATE = 1000) {
  let status = "UNKNOWN";
  do {
    console.log("sleeping");
    await sleep(ATHENA_QUERY_RATE);

    const statusCommand = new GetQueryExecutionCommand({
      QueryExecutionId: id
    });

    console.log("status command", statusCommand);

    const statusResult = await athena.send(statusCommand);

    console.log("statusResult", statusResult);

    status = statusResult.QueryExecution.Status.State;
    console.log("status", status);
  } while (status === QueryExecutionState.QUEUED || status === QueryExecutionState.RUNNING);

  const getQueryResultsCommand = new GetQueryResultsCommand({
    QueryExecutionId: id
  });

  console.log("getQueryResultsCommand", getQueryResultsCommand);

  const response = await athena.send(getQueryResultsCommand);

  console.log("response", response);

  return response.ResultSet;
}

function handleSelect<DB, TB extends keyof DB, O>(query: SelectQueryBuilder<DB, TB, O>, field: DataSetOperationArgument) {
  if (field.array) {
    const args = [];

    for (const value of field.value) {
      switch (typeof value) {
        case "object": {
          if (value["sql"]) {
            args.push(sql(value["statement"]));
          }

          break;
        }
        case "string": {
          args.push(value);
          break;
        }
      }
    }
    return query.select(args);
  }

  return query.select(field.value);
}

function cast(expr: string, type: ColumnDataType): AliasableExpression<unknown> {
  return sql`cast("${sql.raw(expr)}" as ${sql.raw(type)})`;
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getSettings(db: DynamoDBDocument, settingsTable: string) {
  const params = {
    TableName: settingsTable,
    Key: {
      type: "Settings",
      id: "ID#current"
    }
  };
  return db.get(params).then((result) => result.Item as AdaptSettings);
}

// function createSelectFields(args: DataSetOperationArgument[]){

// }
