export enum TemplateErrorCode {
  SUPPRESSION,
  BACKEND_FAILURE
}

export class TemplateError extends Error {
  private _code: TemplateErrorCode;
  constructor(message: string, code: TemplateErrorCode) {
    super(message);
    this._code = code;
  }

  get code() {
    return this._code;
  }
}
