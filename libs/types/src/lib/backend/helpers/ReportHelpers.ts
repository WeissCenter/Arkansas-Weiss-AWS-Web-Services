import { IReport } from "../../IReport";
import { cleanDBFields, createUpdateItemFromObject } from "../../util";
import { ReportVersion } from "../ReportVersion";
import { DataSetOperationArgument, DataViewOperation } from "../../../index";
import { AthenaClient, Datum, ResultSet, GetQueryResultsCommand, StartQueryExecutionCommand, GetQueryExecutionCommand, QueryExecutionState, ResultSetMetadata, Row } from "@aws-sdk/client-athena";
import { Kysely, SelectQueryBuilder, sql, ColumnDataType, AliasableExpression } from "kysely";
import { QueryCommandInput } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { DataSetQueueStatus } from "../DataSetQueueStatus";
import { QueryInput } from "@aws-sdk/client-dynamodb";
import slugify from "slugify";

export async function getReportFromDynamo(db: any, TABLE_NAME: string, id: string, version: ReportVersion = ReportVersion.DRAFT, lang?: string) {
  const getParams = {
    TableName: TABLE_NAME,
    Key: {
      type: "Report",
      id: `ID#${id}${version ? "#Version#" + version : ""}${lang ? "#Lang#" + lang : ""}`
    }
  };

  const result = await db.get(getParams);

  return result?.Item as IReport;
}

export async function getReportVersionsFromDynamo(db: any, TABLE_NAME: string, id: string): Promise<IReport[]> {
  const queryParams = {
    TableName: TABLE_NAME,
    KeyConditionExpression: "#type = :type AND  begins_with(#id, :id)",
    FilterExpression: "#version IN (:draft, :finalized)",
    ExpressionAttributeNames: {
      "#type": "type",
      "#id": "id",
      "#version": "version"
    },
    ExpressionAttributeValues: {
      ":type": "Report",
      ":id": `ID#${id}#Version`,
      ":draft": "draft",
      ":finalized": "finalized"
    }
  };

  const result = await db.query(queryParams);

  return result?.Items || [];
}

export function updateReportVersion(db: any, TABLE_NAME: string, report: IReport, version: ReportVersion = ReportVersion.DRAFT, lang = "en") {
  const updateObj: IReport = {
    ...report,
    version: version,
    updated: `${Date.now()}`
  };

  if (version === ReportVersion.FINALIZED && !updateObj["slug"]) {
    updateObj["slug"] = slugify(updateObj.name, {
      strict: true,
      lower: true,
      trim: true
    });
  }

  const updateObject = createUpdateItemFromObject(updateObj, ["id", "type"]);

  const updateParams = {
    TableName: TABLE_NAME,
    Key: {
      type: "Report",
      id: `ID#${report.reportID}#Version#${version}#Lang${lang}`
    },
    ...updateObject
  };

  return db.update(updateParams);
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
    case "double precision":
    case "real": {
      return parseFloat(datum.VarCharValue || "0");
    }
  }
}

function mapAthenaQueryResults(resultSet: ResultSet) {
  const { ColumnInfo } = resultSet.ResultSetMetadata as ResultSetMetadata;

  if (!ColumnInfo) throw new Error("missing column info");

  return (resultSet.Rows || [null]).slice(1).map((item, index) => {
    const subData = (item!.Data || []).reduce(
      (accum, val, idx) =>
        Object.assign(accum, {
          [ColumnInfo[idx].Name as string]: mapDatum(val, ColumnInfo[idx].Type as string)
        }),
      {}
    );

    return subData;
  });
}

function createConditions(query: any, conditions: DataSetOperationArgument[], groupBy?: string) {
  query = query.where(({ eb, or, and, not, exists, selectFrom }: any) => {
    const conds = conditions.map((field) => {
      if (field.array) {
        return or(field.value.map((val: any) => eb(field.field, field.operator === "NOT" ? "!=" : "=", `'${val}'`)));
      }

      return eb(field.field, field.operator === "NOT" ? "!=" : "=", `'${field.value}'`);
    });

    if (groupBy && Array.isArray(groupBy)) {
      groupBy.forEach((field) => handleField(field, conds, eb));
    }

    if (groupBy && !Array.isArray(groupBy)) {
      handleField(groupBy, conds, eb);
    }

    return and(conds);
  });

  return query;
}

function handleField(field: any, conds: any[], eb: any) {
  switch (typeof field) {
    case "string": {
      conds.push(eb(field, "!=", "''"));
      break;
    }
    case "object": {
      if (field["sql"]) {
        conds.push(eb(sql(field["statement"]), "!=", "''"));
      }

      break;
    }
  }
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

    status = statusResult.QueryExecution!.Status!.State as string;
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

function handleSelect<DB, TB extends keyof DB, O>(query: any, field: DataSetOperationArgument) {
  if (field.array) {
    const args = [];

    for (const value of field.value) {
      switch (typeof value) {
        case "object": {
          if (value["sql"]) {
            let sqlStatement: any = sql(value["statement"]);

            if (value["alias"]) {
              sqlStatement = sqlStatement.as(value["alias"]);
            }

            args.push(sqlStatement);
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

export async function queryAthena(compiled: any, athenaClient: AthenaClient, ATHENA_QUERY_RATE = 1000, catalog: string, outputLocation: string) {
  const params = {
    QueryString: compiled.sql,
    ResultReuseConfiguration: {
      ResultReuseByAgeConfiguration: {
        Enabled: true,
        MaxAgeInMinutes: 60
      }
    },
    QueryExecutionContext: {
      Database: catalog
    },
    ExecutionParameters: compiled.parameters.length ? (compiled.parameters as any[]) : undefined,
    ResultConfiguration: { OutputLocation: `s3://${outputLocation}/` }
  };

  console.log("athena params", params);
  const athenaCommand = new StartQueryExecutionCommand(params);

  console.log("athena command", athenaCommand);

  const startCommandResult = await athenaClient.send(athenaCommand);

  console.log("startCommandResult", startCommandResult);

  console.log("getQueryResultInputs", athenaClient, startCommandResult.QueryExecutionId, ATHENA_QUERY_RATE);

  const resultSet = await getQueryResult(athenaClient, startCommandResult.QueryExecutionId as string, ATHENA_QUERY_RATE);

  console.log("result set", resultSet);
  return resultSet;
}

export function handleGroupBy(query: any, field: DataSetOperationArgument) {
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
    return query.groupBy(args);
  }

  return query.groupBy(field.value);
}

export async function getAggregateAthenaResults(
  operations: DataViewOperation[],
  queryBuilder: Kysely<any>,
  reportDataCode: string,
  athenaClient: AthenaClient,
  ATHENA_QUERY_RATE: number,
  catalog: string,
  outputLocation: string
) {
  return await Promise.all(
    operations.map(async (operation) => {
      try {
        switch (operation.function) {
          case "SUM": {
            const [sumField, ...conditions] = operation.arguments;

            let query = queryBuilder.selectFrom(reportDataCode).select(({ fn, val, ref }: any) => [fn.sum(cast(sumField.field, "double precision")).as("sum")]);

            if (conditions.length) {
              query = createConditions(query, conditions);
            }

            const compiled = query.compile();

            console.log("SUM COMPILED", compiled);

            const resultSet = await queryAthena(compiled, athenaClient, ATHENA_QUERY_RATE, catalog, outputLocation);

            console.log("SUM RESULTSET", resultSet);

            const [column, sum] = resultSet!.Rows as Row[];

            const sumInt = parseFloat(sum["Data"]![0]["VarCharValue"] as string);

            return {
              id: operation.id,
              value: sumInt,
              metadata: operation.metadata
            };
          }
          case "SELECT": {
            const [selectFields, limit, order, ...conditions] = operation.arguments;

            let query = queryBuilder.selectFrom(reportDataCode);

            if (selectFields.value[0] === "*") {
              query = query.selectAll();
            } else {
              query = handleSelect(query, selectFields);
            }

            if (order.value?.length) {
              query = query.orderBy(order.value);
            }

            if (conditions.length) {
              query = createConditions(query, conditions);
            }

            if (limit.value) {
              query = query.limit(limit.value);
            }

            const compiled = query.compile();

            console.log("SELECT COMPILED", compiled);

            const resultSet = await queryAthena(compiled, athenaClient, ATHENA_QUERY_RATE, catalog, outputLocation);

            console.log("SELECT RESULTSET", resultSet);

            return {
              id: operation.id,
              value: mapAthenaQueryResults(resultSet as ResultSet),
              metadata: operation.metadata
            };
            break;
          }
          case "COUNT": {
            const [countField, ...conditions] = operation.arguments;

            let query = queryBuilder.selectFrom(reportDataCode).select(({ fn, val, ref }: any) => [countField.field === "*" ? fn.countAll().as("count") : fn.count(countField.field).as("count")]);

            if (conditions.length) {
              query = createConditions(query, conditions);
            }

            const compiled = query.compile();

            const resultSet = await queryAthena(compiled, athenaClient, ATHENA_QUERY_RATE, catalog, outputLocation);

            const [column, count] = resultSet!.Rows as Row[];

            const countInt = parseInt(count["Data"]![0]["VarCharValue"] as string);

            console.log("COUNT RESULTSET", resultSet);

            return {
              id: operation.id,
              value: countInt,
              metadata: operation.metadata
            };

            break;
          }
          case "GROUPBY": {
            const [aggfunc, fields, selectFields, limit, order, groupby, ...conditions] = operation.arguments;

            const func = aggfunc.value;

            if (!["sum", "avg", "max", "min"].includes(func)) {
              throw Error("unknown aggregation function");
            }

            let query = queryBuilder.selectFrom(reportDataCode).select(({ fn }: any) => fields.value.map((field: any) => fn[func](cast(field, "double precision")).as(field)));

            if (groupby.value) {
              query = handleGroupBy(query, groupby);
            }

            if (selectFields.value) {
              query = handleSelect(query, selectFields);
            }

            if (conditions.length) {
              query = createConditions(query, conditions, groupby.value);
            }

            if (order.value) {
              query = query.orderBy(order.value);
            }

            if (limit.value) {
              query = query.limit(limit.value);
            }

            const compiled = query.compile();

            console.log("GROUPBY COMPILED", compiled);

            const resultSet = await queryAthena(compiled, athenaClient, ATHENA_QUERY_RATE, catalog, outputLocation);

            console.log("GROUPBY RESULTSET", resultSet);

            const mapped = mapAthenaQueryResults(resultSet as ResultSet);

            return {
              id: operation.id,
              value: mapped,
              metadata: operation.metadata
            };
          }
          case "GROUPBY_WITH_DEFAULTS": {
            const [aggfunc, fields, selectFields, limit, order, groupby, defaultOptions, ...conditions] = operation.arguments;

            const func = aggfunc.value;

            if (!["sum", "avg", "max", "min"].includes(func)) {
              throw Error("unknown aggregation function");
            }

            const unionSql = sql.join(
              defaultOptions.value.map((defaultOpt: string, idx: number) => {
                if (idx === 0) return sql`SELECT ${sql.lit(defaultOpt).as(selectFields.value[0])}`;

                return sql`SELECT ${sql.lit(defaultOpt)}`;
              }),
              sql` UNION ALL `
            );

            let query = queryBuilder
              .with("DEFAULTS", (db) => sql`(${unionSql})` as any)
              .with("aggregated", (db) =>
                db
                  .selectFrom(reportDataCode)
                  .select(selectFields.value[0])
                  .select(({ fn }: any) => fields.value.map((field: any) => fn[func](cast(field, "double precision")).as(field)))
                  .groupBy(groupby.value)
              )
              .selectFrom("DEFAULTS as r")
              .select(({ fn }) => [`r.${selectFields.value[0]}`, fn.coalesce(`a.${fields.value[0]}`, sql.lit(0)).as(fields.value[0])])
              .leftJoin("aggregated as a", `a.${selectFields.value[0]}`, `r.${selectFields.value[0]}`);

            // .groupBy(`r.${groupby.value}, a.${fields.value[0]}`);

            // if (selectFields.value) {
            //   query = handleSelect(query, selectFields);
            // }

            // if (conditions.length) {
            //   query = createConditions(query, conditions, groupby.value);
            // }

            if (order.value) {
              query = query.orderBy(order.value);
            }

            if (limit.value) {
              query = query.limit(limit.value);
            }

            const compiled = query.compile();

            console.log("GROUPBY WITH DEFAULTS COMPILED", compiled);

            const resultSet = await queryAthena(compiled, athenaClient, ATHENA_QUERY_RATE, catalog, outputLocation);

            console.log("GROUPBY RESULTSET", resultSet);

            const mapped = mapAthenaQueryResults(resultSet as ResultSet);

            return {
              id: operation.id,
              value: mapped,
              metadata: operation.metadata
            };
          }
        }
      } catch (err) {
        console.error("OPERATION FAILED", operation);
        throw err;
      }
    })
  );
}

export async function getReportBySlug(db: DynamoDBDocument, slug: string, REPORT_TABLE: string, projection?: string, attributeNames?: Record<string, string>, lang = "en") {
  const queryParams: any = {
    TableName: REPORT_TABLE,
    IndexName: "report-slug-query",
    KeyConditionExpression: "#slug = :slug and #lang = :lang",
    FilterExpression: "#version = :finalized",
    ExpressionAttributeValues: {
      ":lang": lang,
      ":finalized": "finalized",
      ":slug": slug
    },
    ExpressionAttributeNames: {
      "#version": "version",
      "#slug": "slug",
      "#lang": "lang",
      ...(attributeNames || {})
    }
  };

  if (projection?.length) queryParams["ProjectionExpression"] = projection;

  const result = await db.query(queryParams);

  const items = (result.Items || []).map((source) => cleanDBFields(source));

  return items[0] as IReport;
}
