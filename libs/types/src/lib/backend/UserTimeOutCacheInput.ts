export type UserTimeOutCacheAction = "EDIT" | "CREATION" | "GENERIC_SAVE" | "CLEAR";

export interface UserTimeOutCacheInput {
  action: UserTimeOutCacheAction;
  type: "DataSource" | "DataView" | "Report" | "Generic";
  body?: any;
}
