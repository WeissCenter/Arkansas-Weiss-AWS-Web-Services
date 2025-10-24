import * as cdk from "aws-cdk-lib";
import { AdaptStackProps } from "./adpat-stack-props";
import { Construct } from "constructs";
import { AdaptDynamoTable } from "../constructs/AdaptDynamoTable";
import { AttributeType } from "aws-cdk-lib/aws-dynamodb";

export class AdaptDynamoStack extends cdk.Stack {
  tables: { [key: string]: AdaptDynamoTable } = {};

  constructor(scope: Construct, id: string, props: AdaptStackProps) {
    super(scope, id, props);

    const dataSourceTable = new AdaptDynamoTable(this, `${id}-adapt-data-source`, {
      partitionKey: { name: "type", type: AttributeType.STRING },
      sortKey: { name: "id", type: AttributeType.STRING },
      tableName: `${props.stage}-AdaptDataSource`
    });

    const templatesTable = new AdaptDynamoTable(this, `${id}-adapt-templates`, {
      partitionKey: { name: "type", type: AttributeType.STRING },
      sortKey: { name: "id", type: AttributeType.STRING },
      tableName: `${props.stage}-AdaptTemplates`
    });

    const reportTable = new AdaptDynamoTable(this, `${id}-adapt-report`, {
      partitionKey: { name: "type", type: AttributeType.STRING },
      sortKey: { name: "id", type: AttributeType.STRING },
      tableName: `${props.stage}-AdaptReport`
    });

    // reportTable.addGlobalSecondaryIndex({
    //   indexName: "report-slug-query",
    //   partitionKey: { name: "type", type: AttributeType.STRING },
    //   sortKey: { name: "slug", type: AttributeType.STRING },
    // });

    reportTable.addGlobalSecondaryIndex({
      indexName: "report-slug-query",
      partitionKey: { name: "slug", type: AttributeType.STRING },
      sortKey: { name: "lang", type: AttributeType.STRING }
    });

    const settingsTable = new AdaptDynamoTable(this, `${id}-adapt-settings`, {
      partitionKey: { name: "type", type: AttributeType.STRING },
      sortKey: { name: "id", type: AttributeType.STRING },
      tableName: `${props.stage}-AdaptSettings`
    });

    const pushNotificationsTable = new AdaptDynamoTable(this, `${id}-adapt-push-notifications`, {
      partitionKey: { name: "id", type: AttributeType.STRING },
      tableName: `${props.stage}-AdaptPushNotifications`
    });

    const shareTable = new AdaptDynamoTable(this, `${id}-adapt-share`, {
      partitionKey: { name: "slug", type: AttributeType.STRING },
      tableName: `${props.stage}-AdaptShare`
    });

    const userActivityTable = new AdaptDynamoTable(this, `${id}-adapt-user-activity`, {
      partitionKey: { name: "username", type: AttributeType.STRING },
      tableName: `${props.stage}-AdaptUserActivity`
    });

    // this.exportValue(pushNotificationsTable.tableArn);
    // this.exportValue(pushNotificationsTable.tableName);

    this.tables = {
      dataSourceTable,
      templatesTable,
      reportTable,
      settingsTable,
      pushNotificationsTable,
      shareTable,
      userActivityTable
    };
  }
}
