import { IGlossaryTerm } from "./IGlossaryTerm";
import { ISection } from "./ISection";

export type TemplateType = "DataCollection" | "ReportTemplate" | "ValidationTemplate";

export type ITemplateFilters = Record<string, IFilter<unknown> | IFilterGroup>;
export interface ITemplate {
  id: string;
  title: string;
  description: string;
  metaTags?: string[];
  reportingLevels?: string[];
  multiFile: boolean;
  suppression: ISuppression;
  filters: ITemplateFilters;
  sortableCategories?: SortableCategory;
  conditionalFilters?: ITemplateFilters;
  pages?: ITemplatePage[];
  sections?: ISection[];
}

export interface ViewerTemplate extends Omit<ITemplate, "suppression"> {
  suppression?: ISuppression;
  suppressed?: boolean; // indicates if the template is suppressed
}

export interface SortableCategory {
  categoryField: string;
  categories: {
    [key: string]: Record<string, string[]>;
  };
}

export interface ITemplatePage {
  id: string;
  context?: TemplateContext;
  name: string; // tab name
  title: string; // section title
  filters?: ITemplateFilters;
  description: string;
  sections: ISection[];
}

export interface ISuppression {
  required: boolean;
  parentOrganization?: string;
  sensitiveColumns: string[];
  frequencyColumns: string[];
}

export interface IFilterGroup {
  exclusive: boolean; // these filters are mutually exclusive with eachother
  filters: ITemplateFilters;
}

export interface TemplateContext {
  dataViewID: string;
  fileSpec: string;
  templateFilters?: Record<string, IFilter<unknown>>; // flattened
  appliedFilters?: any;
  suppress: boolean;
  template: ITemplate | ISummaryTemplate;
  glossaryService: Map<string, IGlossaryTerm>;
}

export interface TemplateFunction {
  function: string;
  dependents: Record<string, TemplateFunction>;
  args: any[];
}

export interface StringTemplate {
  template: string;
  variables: Record<string, TemplateFunction>;
}

export enum IFilterType {
  SELECT = "select",
  SEARCH = "search",
  RADIAL = "radial"
}

export interface RadialFilter {
  options: { label: string; value: any }[];
}

export interface SelectFilter {
  placeholder: string;
  multi: boolean;
  default: string;
  options: { label: string; value: any }[];
}

export interface SearchFilter {
  placeholder: string;
}

export interface IFilter<F> {
  code: string;
  label: string;
  field: string; // what to filter against
  type: IFilterType;
  dataType: "number" | "string";
  tags?: Record<string, any>;
  condition?: IFilterCondition;
  filter: F;
  children: Record<string, IFilter<unknown>>;
}

export interface IFilterCondition {
  operator: "OR" | "AND" | "NOR" | "NAND";
  pages?: string[];
  conditions: ICondition[];
}

export interface ICondition {
  parent: string;
  page?: string; // only valid if on defined page
  value: string[];
}

export interface IRenderedTemplate {
  id: string;
  title: StringTemplate | string;
  description: StringTemplate | string;
  sections?: Promise<ISection>[];
  pages?: Promise<ITemplatePage[]>;
}

export interface InfoField {
  label: StringTemplate | string;
  value: StringTemplate | string;
}
export interface DataSummarySubSection {
  label: StringTemplate | string;
  value: StringTemplate | string;
  sections: DataSummarySubSection[];
}
export interface DataSummarySection {
  label: StringTemplate | string;
  sections: DataSummarySubSection[];
}

export interface ISummaryTemplate {
  id: string;
  title: StringTemplate | string;
  description: StringTemplate | string;
  infoFields: InfoField[];
  dataSummary: DataSummarySection[];
}
