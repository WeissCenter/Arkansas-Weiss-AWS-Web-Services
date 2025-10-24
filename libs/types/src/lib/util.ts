import * as xlsx from "xlsx";
export function CreateBackendResponse<T>(statusCode: number, data?: T) {
  return {
    statusCode,
    body: JSON.stringify({ success: true, data }),
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PUT, PATCH, DELETE",
      "Access-Control-Allow-Headers": "Origin, X-Requested-With, Content-Type, Accept, Authorization"
    }
  };
}

export function deleteIfPresent(settings: any, propertyName: string) {
  settings[propertyName] && delete settings[propertyName];
}

export function createUpdateItemFromObject(obj: any, ignoreFields: string[] = []) {
  const keys = Object.keys(obj).filter((key) => !ignoreFields.includes(key));

  const UpdateExpression = keys.reduce((accum, key, idx) => (idx === 0 ? `${accum} #${key} = :${key}` : `${accum}, #${key} = :${key}`), "SET ");

  const ExpressionAttributeNames = keys.reduce((accum, key) => Object.assign(accum, { [`#${key}`]: key }), {});

  const ExpressionAttributeValues = keys.reduce((accum, key) => Object.assign(accum, { [`:${key}`]: obj[key] }), {});

  return {
    UpdateExpression,
    ExpressionAttributeNames,
    ExpressionAttributeValues
  };
}

export function CreateBackendErrorResponse(statusCode: number, err: any) {
  return {
    statusCode,
    body: JSON.stringify({ success: false, err }),
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PUT, PATCH, DELETE",
      "Access-Control-Allow-Headers": "Origin, X-Requested-With, Content-Type, Accept, Authorization"
    }
  };
}

export function getUserDataFromEvent(event: any) {
  let username = "UNKNOWN";
  let givenName = "UNKNOWN";
  let familyName = "UNKNOWN";
  let email = "UNKNOWN";

  if (!event.requestContext.authorizer) {
    console.error("No authorizer found in event");
  } else {
    if (event.requestContext.authorizer?.claims) {
      // cognito authorizer
      username = event.requestContext.authorizer.claims["cognito:username"];
      givenName = event.requestContext.authorizer.claims["given_name"];
      familyName = event.requestContext.authorizer.claims["family_name"];
      email = event.requestContext.authorizer.claims["email"];
    } else {
      // custom authorizer
      username = event.requestContext.authorizer?.username || username;
      givenName = event.requestContext.authorizer?.givenName || givenName;
      familyName = event.requestContext.authorizer?.familyName || familyName;
      email = event.requestContext.authorizer?.email || email;
    }
  }

  return {
    username,
    givenName,
    familyName,
    fullName: `${givenName} ${familyName}`,
    email
  };
}

export function jsonToParquetSchema(json: any) {
  const isInt = (n: number) => n % 1 === 0;

  return Object.entries(json).reduce((accum: any, [key, value]) => {
    switch (typeof value) {
      case "string": {
        accum[key] = { type: "UTF8", optional: true };
        break;
      }
      case "number": {
        accum[key] = {
          type: isInt(value) ? "INT32" : "DOUBLE",
          optional: true
        };
        break;
      }
      case "boolean": {
        accum[key] = { type: "BOOLEAN", optional: true };
        break;
      }
      default: {
        accum[key] = { type: "UTF8", optional: true };
        break;
      }
    }

    return accum;
  }, {});
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function mapTypes(value: any) {
  switch (typeof value) {
    case "object":
    case "string": {
      return "string";
    }
    case "boolean": {
      return "boolean";
    }
    case "number": {
      return "number";
    }
    default: {
      return "string";
    }
  }
}

export function randstr(prefix: string) {
  return Math.random()
    .toString(36)
    .replace("0.", prefix || "");
}

export function getPercentage(arr: any[], item: any, field: string) {
  const total = arr.reduce((accum, item) => accum + item[field], 0);

  return ((item[field] / total) * 100).toFixed(2);
}

export function cleanDBFields(item: any, extraFields: string[] = []) {
  delete item.id;
  delete item.type;

  for (const field of extraFields) {
    if (field in item) delete item[field];
  }

  return item;
}

export function hash(str: string) {
  let hash = 0,
    i,
    chr;
  if (str.length === 0) return hash;
  for (i = 0; i < str.length; i++) {
    chr = str.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0;
  }
  return hash;
}

export function cleanObject(obj: any): any {
  return Object.fromEntries(
    Object.entries(obj).filter(([_, v]: any) => {
      const notNull = v != null;

      if (!notNull || typeof v === "undefined") {
        return false;
      }

      if (typeof v === "string") {
        return v.length > 0;
      }

      if (Array.isArray(v)) {
        return v.every((item) => item !== null);
      }

      return true;
    })
  );
}

export function clearOtherControls(form: any, changedField: string, value?: string) {
  Object.keys(form.controls).forEach((field) => {
    if (field !== changedField) {
      form.get(field)?.setValue(value, { emitEvent: false });
    }
  });
}

export function flattenObject(obj: any) {
  const flattened: any = {};

  Object.keys(obj).forEach((key) => {
    const value = obj[key];

    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      Object.assign(flattened, flattenObject(value));
    } else {
      flattened[key] = value;
    }
  });

  return flattened;
}

export function getField(path: string, obj: any, separator = ".") {
  const properties = Array.isArray(path) ? path : path.split(separator);
  return properties.reduce((prev, curr) => prev?.[curr], obj);
}

function clamp_range(range: any) {
  if (range.e.r >= 1 << 20) range.e.r = (1 << 20) - 1;
  if (range.e.c >= 1 << 14) range.e.c = (1 << 14) - 1;
  return range;
}

const crefregex = /(^|[^._A-Z0-9])([$]?)([A-Z]{1,2}|[A-W][A-Z]{2}|X[A-E][A-Z]|XF[A-D])([$]?)([1-9]\d{0,5}|10[0-3]\d{4}|104[0-7]\d{3}|1048[0-4]\d{2}|10485[0-6]\d|104857[0-6])(?![_.\(A-Za-z0-9])/g;

/*
	deletes `nrows` rows STARTING WITH `start_row`
	- ws         = worksheet object
	- start_row  = starting row (0-indexed) | default 0
	- nrows      = number of rows to delete | default 1
  from: https://github.com/SheetJS/sheetjs/issues/352#issuecomment-456976898
*/

export function xlsx_delete_row(ws: any, start_row: number, nrows = 1) {
  if (!ws) throw new Error("operation expects a worksheet");
  const dense = Array.isArray(ws);
  if (!start_row) start_row = 0;

  /* extract original range */
  const range = xlsx.utils.decode_range(ws["!ref"]);
  let R = 0,
    C = 0;

  const formula_cb = function ($0: any, $1: any, $2: any, $3: any, $4: any, $5: any) {
    let _R = xlsx.utils.decode_row($5),
      _C = xlsx.utils.decode_col($3);
    if (_R >= start_row) {
      _R -= nrows;
      if (_R < start_row) return "#REF!";
    }
    return $1 + ($2 == "$" ? $2 + $3 : xlsx.utils.encode_col(_C)) + ($4 == "$" ? $4 + $5 : xlsx.utils.encode_row(_R));
  };

  let addr, naddr;
  /* move cells and update formulae */
  if (dense) {
    for (R = start_row + nrows; R <= range.e.r; ++R) {
      if (ws[R])
        ws[R].forEach(function (cell: any) {
          cell.f = cell.f.replace(crefregex, formula_cb);
        });
      ws[R - nrows] = ws[R];
    }
    ws.length -= nrows;
    for (R = 0; R < start_row; ++R) {
      if (ws[R])
        ws[R].forEach(function (cell: any) {
          cell.f = cell.f.replace(crefregex, formula_cb);
        });
    }
  } else {
    for (R = start_row + nrows; R <= range.e.r; ++R) {
      for (C = range.s.c; C <= range.e.c; ++C) {
        addr = xlsx.utils.encode_cell({ r: R, c: C });
        naddr = xlsx.utils.encode_cell({ r: R - nrows, c: C });
        if (!ws[addr]) {
          delete ws[naddr];
          continue;
        }
        if (ws[addr].f) ws[addr].f = ws[addr].f.replace(crefregex, formula_cb);
        ws[naddr] = ws[addr];
      }
    }
    for (R = range.e.r; R > range.e.r - nrows; --R) {
      for (C = range.s.c; C <= range.e.c; ++C) {
        addr = xlsx.utils.encode_cell({ r: R, c: C });
        delete ws[addr];
      }
    }
    for (R = 0; R < start_row; ++R) {
      for (C = range.s.c; C <= range.e.c; ++C) {
        addr = xlsx.utils.encode_cell({ r: R, c: C });
        if (ws[addr] && ws[addr].f) ws[addr].f = ws[addr].f.replace(crefregex, formula_cb);
      }
    }
  }

  /* write new range */
  range.e.r -= nrows;
  if (range.e.r < range.s.r) range.e.r = range.s.r;
  ws["!ref"] = xlsx.utils.encode_range(clamp_range(range));

  /* merge cells */
  if (ws["!merges"])
    ws["!merges"].forEach(function (merge: any, idx: any) {
      let mergerange;
      switch (typeof merge) {
        case "string":
          mergerange = xlsx.utils.decode_range(merge);
          break;
        case "object":
          mergerange = merge;
          break;
        default:
          throw new Error("Unexpected merge ref " + merge);
      }
      if (mergerange.s.r >= start_row) {
        mergerange.s.r = Math.max(mergerange.s.r - nrows, start_row);
        if (mergerange.e.r < start_row + nrows) {
          delete ws["!merges"][idx];
          return;
        }
      } else if (mergerange.e.r >= start_row) mergerange.e.r = Math.max(mergerange.e.r - nrows, start_row);
      clamp_range(mergerange);
      ws["!merges"][idx] = mergerange;
    });
  if (ws["!merges"])
    ws["!merges"] = ws["!merges"].filter(function (x: any) {
      return !!x;
    });

  /* rows */
  if (ws["!rows"]) ws["!rows"].splice(start_row, nrows);
}

export function chartExplainTemplateParse(explainTemplate?: string, plainLanguageItems: string[] = []) {
  if (explainTemplate) {
    const select = ["first", "second", "third"];

    const parseRegex = /{{(.+?)}}/g;

    return explainTemplate.replaceAll(parseRegex, (match, code) => {
      const idx = select.indexOf(code);

      if (idx === -1) return "no data found";

      return plainLanguageItems[idx];
    });
  }

  // Combine the items into a sentence
  let summary = "In the reported data, ";
  if (plainLanguageItems.length > 2) {
    // Join all items with commas, but the last item with 'and'
    const allButLast = plainLanguageItems.slice(0, -1).join(", ");
    const lastItem = plainLanguageItems[plainLanguageItems.length - 1];
    summary += `${allButLast}, and ${lastItem}`;
  } else if (plainLanguageItems.length === 2) {
    // No comma, just 'and'
    summary += `${plainLanguageItems[0]} and ${plainLanguageItems[1]}`;
  } else if (plainLanguageItems.length === 1) {
    // If there's only one item, just add it
    summary += `${plainLanguageItems[0]}`;
  }

  // Finish the sentence if there are items
  if (plainLanguageItems.length > 0) {
    summary += " represent the top categories.";
  } else {
    summary += "No data available.";
  }

  return summary;
}
