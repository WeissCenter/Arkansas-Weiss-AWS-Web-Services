export function getSubscription(db: any, TABLE_NAME: string, id: string) {
  const params = {
    TableName: TABLE_NAME,
    Key: {
      id: id
    }
  };
  return db.get(params);
}
