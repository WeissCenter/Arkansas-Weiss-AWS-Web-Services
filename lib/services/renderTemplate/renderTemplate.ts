import { APIGatewayEvent, Context, Handler } from "aws-lambda";
import {
  AdaptGlossaryTerm,
  CommentBlock,
  CreateBackendErrorResponse,
  CreateBackendResponse,
  DataSetOperation,
  DataSetOperationArgument,
  DataView,
  getAdaptGlossary,
  getAdaptSettings,
  getAggregateAthenaResults,
  GetDataFromDataViewOutput,
  getDataView,
  getPercentage,
  getReportBySlug,
  getReportFromDynamo,
  HeaderBlock,
  IFilter,
  IFilterGroup,
  IGlossaryTerm,
  IReport,
  ISection,
  ISummaryTemplate,
  ISuppression,
  ITemplate,
  ITemplateFilters,
  ITemplatePage,
  QuickSummary,
  QuickSummarySection,
  SectionType,
  StringTemplate,
  TemplateContext,
  TemplateError,
  TemplateErrorCode,
  TemplateFunction,
  ViewerTemplate
} from "../../../libs/types/src";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { Kysely, SqliteAdapter, DummyDriver, SqliteIntrospector, SqliteQueryCompiler } from "kysely";
import { AthenaClient } from "@aws-sdk/client-athena";
import { BUILT_IN_FUNCTIONS } from "./template-functions/template-functions";
import { InvokeCommand, LambdaClient, LogType } from "@aws-sdk/client-lambda";

const REPORT_TABLE = process.env.REPORT_TABLE || "";
const DATA_TABLE = process.env.DATA_TABLE || "";
const CATALOG = process.env.CATALOG || "";
const SETTINGS_TABLE = process.env.SETTINGS_TABLE || "";
const BUCKET = process.env.BUCKET || "";
const ATHENA_QUERY_RATE = parseInt(process.env.ATHENA_QUERY_RATE || "1000");
const glossaryCache = new Map<string, Map<string, AdaptGlossaryTerm>>();
const lambdaClient = new LambdaClient({ region: "us-east-1" });
const DATA_VIEW_SELECTOR = "dataView";

const templateFunctions: {
  [funcName: string]: (...args: any[]) => Promise<string> | string;
} = {};
const client = new DynamoDBClient({ region: "us-east-1" });
const db = DynamoDBDocument.from(client);
const athenaClient = new AthenaClient({ region: "us-east-1" });

BUILT_IN_FUNCTIONS.forEach(({ name, func }) => {
  templateFunctions[name] = func;
});

const queryBuilder = new Kysely<any>({
  dialect: {
    createAdapter: () => new SqliteAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (db) => new SqliteIntrospector(db),
    createQueryCompiler: () => new SqliteQueryCompiler()
  }
});

export const handler: Handler = async (event: any, context: Context) => {
  try {
    const accessType: "id" | "slug" = event["accessType"] || "id";
    const report = event["report"];
    const filters = event["filters"] || {};
    const version = event["version"] || "draft";
    const lang = event["lang"] || "en";
    const suppress = event["suppress"] || false;

    if (!report) return CreateBackendErrorResponse(400, "missing report id/slug");

    let dynamoReport: IReport;

    switch (accessType) {
      case "slug": {
        dynamoReport = await getReportBySlug(db, report, REPORT_TABLE, undefined, undefined, lang);
        break;
      }
      case "id": {
        dynamoReport = await getReportFromDynamo(db, REPORT_TABLE, report, version, lang);
        break;
      }
      default: {
        return CreateBackendErrorResponse(400, "unknown access type");
      }
    }

    if (!dynamoReport) return CreateBackendErrorResponse(404, "report does not exist");

    const dataView = await getDataView(db, DATA_TABLE, dynamoReport.dataView);

    if (!dataView) return CreateBackendErrorResponse(404, "data view does not exist in report");

    if (!glossaryCache.has(lang)) {
      const dynamoGlossary = await getAdaptGlossary(db, SETTINGS_TABLE, "current", lang);

      const newGlossaryMap = new Map(Object.entries(dynamoGlossary?.terms || {}));

      glossaryCache.set(lang, newGlossaryMap);
    }

    const rendered = (await renderTemplateWithMultipleViews(
      dynamoReport.template as ITemplate,
      dataView,
      glossaryCache.get(lang)!,
      filters,
      suppress,
      accessType === "slug" ? dynamoReport.dataView : dataView.dataViewID
    )) as ViewerTemplate;

    rendered.suppressed = suppress && (rendered.suppression?.required || (rendered.suppression?.sensitiveColumns?.length || 0) > 0);
    delete rendered.suppression;

    return rendered;
  } catch (err) {
    console.error(err);
    return CreateBackendErrorResponse(500, "failed to render");
  }
};

async function renderTemplateWithMultipleViews(template: ITemplate, dataView: DataView, glossary: Map<string, IGlossaryTerm>, filters: any = {}, suppress = false, slug = "", pageIndex = -1) {
  const renderedTemplate: ITemplate = {
    id: template.id,
    multiFile: template.multiFile ?? true,
    sortableCategories: template.sortableCategories,
    suppression: template.suppression,
    filters: template.filters,
    title: template.title,
    description: template.description,
    conditionalFilters: template.conditionalFilters,
    pages: []
  };

  const templateFilters = flattenFilters(template.filters || {});

  const contexts = [
    {
      dataViewID: slug?.length ? slug : dataView.dataViewID,
      fileSpec: "all",
      glossaryService: glossary,
      template,
      templateFilters,
      suppress
    },
    ...dataView.data.files.map((file) => ({
      dataViewID: slug?.length ? slug : dataView.dataViewID,
      fileSpec: file.id,
      glossaryService: glossary,
      template,
      templateFilters,
      appliedFilters: filters,
      suppress
    }))
  ];

  for (const [i, page] of (template.pages as ITemplatePage[]).entries()) {
    // handle page condition filters

    const filtersToApply: any = {};

    for (const code of Object.keys(filters)) {
      const tempFilter = templateFilters[code];

      if (!tempFilter.condition?.pages?.length || tempFilter?.condition?.pages?.includes(page.id)) {
        filtersToApply[code] = filters[code];
      }
    }

    (renderedTemplate.pages as ITemplatePage[])[i] = await handlePage(page, {
      ...(template.multiFile === false
        ? contexts[1]
        : contexts?.[i] || {
            dataViewID: dataView.dataViewID,
            fileSpec: "all",
            template,
            glossaryService: glossary,
            templateFilters,
            appliedFilters: filtersToApply,
            suppress
          }),
      appliedFilters: filtersToApply
    });
  }
  return renderedTemplate;
}

function flattenFilters(filters: ITemplateFilters): Record<string, IFilter<unknown>> {
  return Object.keys(filters).reduce((accum, key) => {
    if ("code" in filters[key]) {
      if ((filters[key] as IFilter<unknown>).children) {
        return Object.assign(accum, {
          [key]: filters[key],
          ...flattenFilters((filters[key] as IFilter<unknown>).children)
        });
      }

      // iFilter
      return Object.assign(accum, { [key]: filters[key] });
    } else if ("exclusive" in filters[key]) {
      // IFilterGroup
      return Object.assign(accum, {
        ...flattenFilters((filters[key] as IFilterGroup).filters)
      });
    }

    return accum;
  }, {});
}

async function handlePage(page: ITemplatePage, ctx: TemplateContext) {
  page.context = ctx;
  page.sections = await Promise.all(handleSections(page.sections, ctx));
  delete page.context;
  return page;
}

async function handlePages(pages: ITemplatePage[], ctx: TemplateContext) {
  await Promise.all(
    pages.map(async (page) => {
      page.sections = await Promise.all(handleSections(page.sections, ctx));
    })
  );

  return pages;
}

function handleSections(sections: ISection[], ctx: TemplateContext) {
  const promises: Promise<any>[] = [];

  for (const section of sections) {
    switch (section.type) {
      case SectionType.QuickSummary: {
        promises.push(handleQuickSummary(section, ctx));
        break;
      }
      case SectionType.BarChartGrouped:
      case SectionType.BarChart: {
        promises.push(handleBarChart(section, ctx));
        break;
      }
      case SectionType.GridContainer: {
        promises.push(handleGridView(section, ctx));
        break;
      }
      case SectionType.CountBreakdown: {
        promises.push(handleCountBreakdown(section, ctx));
        break;
      }
      case SectionType.Header: {
        promises.push(handleHeaderBlock(section, ctx));
        break;
      }
      case SectionType.Comment: {
        promises.push(handleCommentBlock(section, ctx));
        break;
      }
    }
  }

  return promises;
}

async function handleCommentBlock(section: ISection, ctx: TemplateContext | any) {
  const headerBlock = section.content as CommentBlock;

  const [label, body] = await Promise.all([parseString(headerBlock.label, ctx), parseString(headerBlock.body, ctx)]);

  headerBlock.label = label;
  headerBlock.body = body;
  section.content = headerBlock;
  return section;
}

async function handleHeaderBlock(section: ISection, ctx: TemplateContext | any) {
  const headerBlock = section.content as HeaderBlock;

  const [text, body] = await Promise.all([parseString(headerBlock.text, ctx), parseString(headerBlock.body, ctx)]);

  headerBlock.text = text;
  headerBlock.body = body;
  section.content = headerBlock;
  return section;
}

async function handleCountBreakdown(section: ISection, ctx: TemplateContext | any) {
  const tmpCtx = { ...ctx };

  const content = section.content as any;

  for (const [code, value] of Object.entries(ctx.appliedFilters)) {
    const templateFilter = ctx!.templateFilters?.[code];

    if (!templateFilter) {
      throw "unknown filter " + code;
    }

    const valArray = [value].flat();

    const newArgs = valArray.map((val) => {
      content.dataRetrievalOperations[0].id += `${templateFilter.field}-${val}`;
      return {
        field: templateFilter.field,
        type: templateFilter.dataType || "string",
        value: val
      };
    });

    content.dataRetrievalOperations[0].arguments.push(...newArgs);
  }

  const data = await getDataFromDataView(ctx.dataViewID, ctx.fileSpec, content.dataRetrievalOperations, ctx.template.suppression, ctx.suppress).then((result) => result.operationResults[0]!.value);

  (data as any[]).forEach((item: any) => (tmpCtx[item[content.labelField]] = getPercentage(data as any[], item, "StudentCount")));

  const [title, description] = await Promise.all([parseString(content.title, tmpCtx), parseString(content.description, tmpCtx)]);

  if (content["caption"]) {
    content.caption = await parseString(content.caption, tmpCtx);
  }

  content.title = title;
  content.description = description;
  content.data = data;

  // delete content.dataRetrievalOperations

  return section;
}

async function handleQuickSummary(section: ISection, ctx: TemplateContext) {
  const content = section.content as QuickSummary;

  content.heading = await parseString(content.heading, ctx);

  const validSections: QuickSummarySection[] = [];

  for (const section of content.sections) {
    try {
      const [title, body] = await Promise.all([parseString(section.title, ctx), parseString(section.body, ctx)]);

      section.title = title;
      section.body = body;

      validSections.push(section);
    } catch (err) {
      if (!(err instanceof TemplateError)) {
        throw err;
      }

      switch ((err as TemplateError).code) {
        case TemplateErrorCode.SUPPRESSION: {
          console.log(`Template Field ${section.title} has suppressed fields`);
          break;
        }
        case TemplateErrorCode.BACKEND_FAILURE: {
          throw err;
        }
      }
    }
  }

  // await Promise.all(content.sections.map(async (sect) => {

  //   sect.title = await ;
  //   sect.body = await parseString(sect.body, ctx);

  // }));

  content.sections = validSections;

  return section;
}

async function handleBarChart(section: ISection, ctx: TemplateContext) {
  const content: any = section.content;

  if (section.type === SectionType.BarChart) {
    const [title, description] = await Promise.all([parseString(content.title, ctx), parseString(content.description, ctx)]);

    content.title = title;
    content.description = description;
  } else if (section.type === SectionType.BarChartGrouped) {
    const title = await parseString(content.title, ctx);

    content.title = title;
  }

  const operations: DataSetOperation[] = [];

  const arg = getSortableCategoryArgs(ctx);

  if (arg) content.chart.dataRetrievalOperations[0].arguments.push(arg);

  for (const [code, value] of Object.entries(ctx.appliedFilters)) {
    const templateFilter = ctx!.templateFilters?.[code];

    if (!templateFilter) {
      throw "unknown filter " + code;
    }

    const valArray = [value].flat().filter((val) => val !== "all");

    let newArgs: any[] = [];

    if (valArray.length > 1) {
      // assume OR for now!
      const operator = "OR";

      const arg = {
        field: templateFilter.field,
        operator,
        array: true,
        type: templateFilter.dataType || "string",
        value: [valArray].flat()
      };

      content.chart.dataRetrievalOperations[0].id += `-${ctx.fileSpec}-${templateFilter.field}-${valArray.join(",")}`;

      if (content.chart?.total?.id) {
        content.chart.total.id += `-${ctx.fileSpec}-${templateFilter.field}-${valArray.join(",")}`;
      }

      newArgs.push(arg);
    } else {
      newArgs = valArray.map((val) => {
        content.chart.dataRetrievalOperations[0].id += `-${templateFilter.field}-${val}`;

        if (content.chart?.total?.id) {
          content.chart.total.id += `-${ctx.fileSpec}-${templateFilter.field}-${val}`;
        }
        return { field: templateFilter.field, type: "string", value: `${val}` };
      });
    }

    content.chart.dataRetrievalOperations[0].arguments.push(...newArgs);

    if (content.chart?.total && typeof content.chart.total === "object") {
      content.chart.total.arguments.push(...newArgs);
    }
  }

  operations.push(...content.chart.dataRetrievalOperations);

  if (content.chart.total && typeof content.chart.total === "object") {
    operations.push(content.chart.total);
  }

  const dataServiceResult = await getDataFromDataView(ctx.dataViewID, ctx.fileSpec, operations, (ctx.template as ITemplate).suppression, ctx.suppress).then((result) => result.operationResults as any);

  content.chart.data = dataServiceResult;
  const reportCodeArg = content.chart.dataRetrievalOperations[0].arguments.find((arg: any) => arg.field.toLowerCase() === "reportcode")?.value;

  content.fileSpec = Array.isArray(reportCodeArg) ? reportCodeArg[0] : reportCodeArg;
  // content.chart.total = chartData?.total ?? 0;
  // content.chart.subTotals = chartData?.sub_totals;

  if (content.chart.total && typeof content.chart.total === "object") {
    const total = dataServiceResult.pop();
    content.chart.total = total?.value ?? 0;
  }

  delete content.chart.dataRetrievalOperations;

  return section;
}

function getSortableCategoryArgs(ctx: TemplateContext) {
  const sortableCategories = (ctx.template as ITemplate)?.sortableCategories;

  if (!sortableCategories) return;

  const sortableCategoriesKeys = Object.entries(sortableCategories.categories);

  if (ctx.fileSpec !== "all" || !sortableCategoriesKeys?.length) return;

  const cleanedFilters = Object.keys(ctx.appliedFilters).filter((key) => {
    if (Array.isArray(ctx.appliedFilters[key])) return ctx.appliedFilters[key].length && ctx.appliedFilters[key].every((item: any) => item !== null);

    return ctx.appliedFilters[key] !== null;
  });

  const mappedCodes = cleanedFilters.map((key: string) => (ctx.templateFilters?.[key] as IFilter<unknown>).field) as string[];

  const arg = {
    field: sortableCategories.categoryField,
    array: true,
    operator: "OR",
    type: "string",
    value: [] as string[]
  };

  const categories = new Set<string>();

  for (const [specKey, spec] of sortableCategoriesKeys) {
    for (const [catKey, category] of Object.entries(spec)) {
      if (mappedCodes.length > 0 && mappedCodes.every((code: string) => category.includes(code))) {
        categories.add(catKey);
        break;
      }
    }
  }

  const cats = [...categories];

  if (!cats.length) return;

  arg.value = cats;

  // debugger;
  return arg;
}

function getFuncs(
  functions: TemplateFunction,
  hasFilters: boolean,
  context: TemplateContext,
  sortableArgs:
    | {
        field: string;
        array: boolean;
        operator: string;
        type: string;
        value: string[];
      }
    | undefined,
  combinedContext: {
    dataService: { getDataFromDataViewPromise: (...args: any[]) => any };
    dataViewID: string;
    fileSpec: string;
    templateFilters?: Record<string, IFilter<unknown>>;
    appliedFilters?: any;
    suppress: boolean;
    template: ITemplate | ISummaryTemplate;
  },
  promises: Record<string, Promise<string>>,
  code: string
) {
  let funcDecl = `${functions.function}(${functions.args.map((arg) => JSON.stringify(arg)).join(",")}`;

  if (hasFilters && !functions.function.startsWith("unfiltered")) {
    for (const [code, value] of Object.entries(context.appliedFilters)) {
      const templateFilter = context!.templateFilters?.[code];

      if (!templateFilter) {
        throw "unknown filter " + code;
      }

      const valArray = [value].flat().filter((val) => val !== "all");

      let newArgs: string[] = [];

      if (valArray.length > 1) {
        // assume OR for now!
        const operator = "OR";

        const arg = {
          field: templateFilter.field,
          operator,
          array: true,
          type: templateFilter.dataType || "string",
          value: [valArray].flat()
        };

        newArgs.push(JSON.stringify(arg));
      } else {
        newArgs = valArray.map((val) =>
          JSON.stringify({
            field: templateFilter.field,
            type: templateFilter.dataType || "string",
            value: val
          })
        );
      }

      if (sortableArgs) newArgs.push(JSON.stringify(sortableArgs));

      funcDecl += (newArgs.length ? "," : "") + newArgs.join(",");
    }
  }

  const func = new Function(`return this.${funcDecl})`).bind(combinedContext);

  const funcPromise = func();

  promises[code] = funcPromise;

  const dependentPromises: Promise<any>[] = [];

  if (functions.dependents && Object.keys(functions.dependents).length > 0) {
    for (const [key, value] of Object.entries(functions.dependents)) {
      const promise = funcPromise.then((result: any) => {
        for (const arg of value.args) {
          if (!arg.parent) continue;

          delete arg.parent;
          arg["value"] = result;
        }

        getFuncs(value, hasFilters, context, sortableArgs, combinedContext, promises, `${code}.${key}`);
      });

      dependentPromises.push(promise);
    }
  }

  return dependentPromises;
}

async function handleGridView(section: ISection, ctx: TemplateContext) {
  const { columns } = section.content as any;

  for (const column of columns) {
    column.rows = await Promise.all(handleSections(column.rows, ctx));
  }

  return section;
}

async function handleDataViewSelect(code: string, context: TemplateContext) {
  const select = code.split(".");

  const field = select[1];

  const dataView = await getDataView(db, DATA_TABLE, context.dataViewID); // (await firstValueFrom(this.dataService.$dataViews)).find(item => item.dataViewID === context.dataViewID);

  if (!dataView) {
    throw new Error(`Data view ${context.dataViewID} not found`);
  }

  switch (field) {
    case "fields": {
      const fieldSelect = select[2];

      if (!fieldSelect) {
        throw new Error(`Field ${select[2]} not found`);
      }

      const dataViewField = dataView.data.fields.find((item) => item.id === fieldSelect);

      return dataViewField?.label ?? "";
    }
    default: {
      // just try and grab whatever field for now
      return `${(dataView as any).data[field] ?? ""}`;
    }
  }
}

async function parseString(string: StringTemplate | string, context: TemplateContext) {
  if (typeof string === "string") {
    return string;
  }
  const parseRegex = /{{(.+?)}}/g;

  const combinedContext = {
    ...context,
    ...templateFunctions,
    dataService: { getDataFromDataViewPromise: getDataFromDataView }
    //glossaryService: glossary,
  };

  const promiseMap: Record<string, Promise<string>> = {};
  const extraPromises: Promise<any>[] = [];

  const template = string.template;

  const variables = string.variables;

  const hasFilters = !!Object.keys(context?.appliedFilters || {}).length;

  const sortableArgs = getSortableCategoryArgs(context);

  for (const [variable, functions] of Object.entries(variables)) {
    template.replaceAll(parseRegex, (match, code) => {
      if (code.startsWith(DATA_VIEW_SELECTOR)) {
        const promise = handleDataViewSelect(code, context);

        promiseMap[code] = promise;

        return "";
      }

      if (!code.split(".").includes(variable)) {
        return "";
      }

      const extra = getFuncs(functions, hasFilters, context, sortableArgs, combinedContext, promiseMap, variable);

      extraPromises.push(...extra);

      return "";
    });
  }
  await Promise.all(extraPromises);
  const mapPromises = Object.entries(promiseMap).map(async ([key, promise]) => ({ key, promise: await promise }));
  const awaitedMapPromises = await Promise.all(mapPromises);

  const reducedMapPromises = awaitedMapPromises.reduce((accum, val) => Object.assign(accum, { [val.key]: val.promise }), {} as Record<string, string>);

  if (context.glossaryService) {
    // TODO: test integers that appear in glossary
    return template.replaceAll(parseRegex, (match, code) => {
      return context.glossaryService.get(reducedMapPromises[code])?.label || reducedMapPromises[code] || "";
    });
  } else {
    return template.replaceAll(parseRegex, (match, code) => {
      return reducedMapPromises[code] !== undefined ? reducedMapPromises[code] : "";
    });
  }
}

async function getDataFromDataView(dataViewID: string, fileSpec: string, operations: DataSetOperation[], ...args: any[]) {
  const dataViewCode = `${dataViewID.replace(/[-]/g, "_")}`;

  console.log("DATA VIEW ID", dataViewCode);
  console.log("OPERATIONS", operations);

  const removeDupeConditions = (operations: DataSetOperation[]) => {
    for (const operation of operations) {
      const seen = new Set();
      const result: DataSetOperationArgument[] = [];

      for (let i = operation.arguments.length - 1; i >= 0; i--) {
        const item = operation.arguments[i];
        const uniqueKey = item.field;
        if (!seen.has(uniqueKey)) {
          seen.add(uniqueKey);
          result.push(item);
        }
      }

      operation.arguments = result.reverse();
    }

    return operations;
  };

  const aggregateResults = await getAggregateAthenaResults(removeDupeConditions(operations), queryBuilder, dataViewCode, athenaClient, ATHENA_QUERY_RATE, CATALOG, BUCKET);

  if (args[1] && args[0] && "required" in args[0] && args[0]["required"]) return suppressAggregateData(args[0], aggregateResults);

  return {
    operationResults: aggregateResults
  };
}

async function suppressAggregateData(suppression: ISuppression, aggregateResults: any) {
  const settings = await getAdaptSettings(db, SETTINGS_TABLE, "current");

  const command = new InvokeCommand({
    FunctionName: process.env.SUPPRESSION_SERVICE_FUNCTION,
    Payload: JSON.stringify({
      data: aggregateResults,
      threshold: settings?.nSize || 30,
      ...suppression
    }),
    LogType: LogType.Tail
  });

  const { Payload } = await lambdaClient.send(command);
  const result = Buffer.from(Payload!).toString();

  return {
    operationResults: JSON.parse(result)
  };
}

// .getDataFromDataViewPromise(
//   ctx.dataViewID,
//   ctx.fileSpec,
//   operations,
//   (ctx.template as ITemplate).suppression,
//   ctx.suppress
// )
// .then((result) => result.operationResults);
