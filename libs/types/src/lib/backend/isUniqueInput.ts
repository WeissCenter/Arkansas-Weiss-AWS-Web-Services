export interface IsUniqueInput {
  type: string;
  name: string;
  field?: string;
  ignoreID?: {
    idField: string;
    idValue: string;
  };
}
