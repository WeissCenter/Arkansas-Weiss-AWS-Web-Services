import { UserTimeOutCacheAction } from "./UserTimeOutCacheInput";

export type UserCacheItemType = "DataSource" | "DataView" | "Report" | "Generic";

export type CacheKey = `${UserCacheItemType}_${UserTimeOutCacheAction}`;

export type UserTimeOutCache = {
  action: UserTimeOutCacheAction;
  type: UserCacheItemType;
  body: any;
  dirty: boolean;
  added: number;
  expiry: number;
};
