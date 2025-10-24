import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { AdaptStackProps } from "./adpat-stack-props";
import { CfnUserPoolGroup } from "aws-cdk-lib/aws-cognito";
import { Role, ServicePrincipal, PolicyStatement, Effect } from "aws-cdk-lib/aws-iam";
import { AppRole, appRolePermissions, PermissionAction } from "../libs/types/src";
import { AdaptRestApi } from "../constructs/AdaptRestApi";

type PermissionMatrix = {
  [key in AppRole]?: {
    [key in PermissionAction]?: { actions: string[]; resources: string[] }[];
  };
};

type UserGroupRolePermissions = {
  [role: AppRole]: { [action: string]: Set<string> };
};

const API_PERMISSIONS: PermissionMatrix = {
  "Data Sources": {
    Read: [
      {
        actions: ["execute-api:Invoke"],
        resources: [`/GET/data`, `/GET/data/*`, `/GET/dataset`, `/GET/dataset/*`, `/POST/unique`]
      }
    ],
    Write: [
      {
        actions: ["execute-api:Invoke"],
        resources: [`/POST/data`, `/POST/data/*/query`, `/POST/dataset`, `/PUT/data/*`, `/DELETE/data/*`, `/POST/test`]
      }
    ]
  },
  "Data Views": {
    Read: [
      {
        actions: ["execute-api:Invoke"],
        resources: [`/GET/dataview`, `/GET/dataview/*`, `/GET/dataview/*/preview`]
      }
    ],
    Write: [
      {
        actions: ["execute-api:Invoke"],
        resources: [`/POST/dataview`, `/POST/dataview/*`, `/PUT/dataview/*`, `/DELETE/dataview/*`, `/POST/dataview/upload`, `/POST/dataview/*/pull`, `/POST/dataview/*/data`, `/POST/dataview/*/*`]
      }
    ]
  },
  "Report Templates": {
    Read: [
      {
        actions: ["execute-api:Invoke"],
        resources: [`/GET/template/*`, "/GET/template/*/*", `/GET/validate-file/*`, `/POST/unique`]
      }
    ]
    // Write: [
    //   {
    //     actions: ['execute-api:Invoke'],
    //     resources: [`/{METHOD_HTTP_VERB}/{Resource-path}`],
    //   },
    // ],
  },
  Reports: {
    Read: [
      {
        actions: ["execute-api:Invoke"],
        resources: [`/GET/report`, `/GET/report/*`, `/POST/report/*/data`]
      }
    ],
    Write: [
      {
        actions: ["execute-api:Invoke"],
        resources: [`/POST/report`, `/PUT/report/*`, `/POST/report/*/translate`]
      }
    ],
    Approve: [
      {
        actions: ["execute-api:Invoke"],
        resources: [`/POST/report/*/publish`, `/POST/report/*/unpublish`]
      }
    ]
  },
  Glossary: {
    Read: [
      {
        actions: ["execute-api:Invoke"],
        resources: [`/GET/settings/glossary`]
      }
    ]
  },
  Users: {
    Read: [
      {
        actions: ["execute-api:Invoke"],
        resources: [`/GET/users`]
      }
    ],
    Write: [
      {
        actions: ["execute-api:Invoke"],
        resources: ["/PUT/users"]
      }
    ]
  },
  "Tool Settings": {
    Read: [
      {
        actions: ["execute-api:Invoke"],
        resources: [`/GET/settings`]
      }
    ],
    Write: [
      {
        actions: ["execute-api:Invoke"],
        resources: [`/POST/settings`, `/POST/settings/logo`]
      }
    ]
  },
  Default: {
    Read: [
      {
        actions: ["execute-api:Invoke"],
        resources: [`/GET/user`, `/GET/share/*`]
      }
    ],
    Write: [
      {
        actions: ["execute-api:Invoke"],
        resources: [`/POST/event`, `/POST/notifications`, `/POST/share`, `/POST/timedout`]
      }
    ]
  }
};

interface AdaptUserPermissionStackProps extends AdaptStackProps {
  userPoolId: string;
  restApi: AdaptRestApi;
}

export class AdaptUserPermissionStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AdaptUserPermissionStackProps) {
    super(scope, id, props);
    const userGroupRolePermissions = convertAppRolePermissionsToUserGroupRolePermissions(props.restApi);

    for (const role in userGroupRolePermissions) {
      const cleanRole = role.replace(" ", "");
      const rolePermissions = userGroupRolePermissions[role];
      const roleConstruct = new Role(this, `${role}Role`, {
        roleName: `${props.stage}-${cleanRole}Role`,
        assumedBy: new ServicePrincipal("cognito-idp.amazonaws.com")
      });
      for (const action in rolePermissions) {
        roleConstruct.addToPolicy(
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [action],
            resources: [...rolePermissions[action]]
          })
        );
      }
      // create user group and attach role
      const userGroup = new CfnUserPoolGroup(this, `${cleanRole}Group`, {
        userPoolId: props.userPoolId,
        description: `Group for ${role}`,
        groupName: cleanRole,
        roleArn: roleConstruct.roleArn,
        precedence: appRolePermissions[role].precedence
      });
    }
  }
}

function convertAppRolePermissionsToUserGroupRolePermissions(restApi: AdaptRestApi): UserGroupRolePermissions {
  let userGroupRolePermissions: UserGroupRolePermissions = {};
  //   const apiArnPrefix = "arn:aws:execute-api:*:*:*/*";
  const apiId = restApi.api.restApiId;
  const stage = restApi.stageName;
  const region = cdk.Stack.of(restApi).region;
  const accountId = cdk.Stack.of(restApi).account;
  const apiArnPrefix = `arn:aws:execute-api:${region}:${accountId}:${apiId}/${stage}`;

  for (const role in appRolePermissions) {
    const permissions = appRolePermissions[role].permissions;
    for (const object in permissions) {
      const actions = permissions[object];
      for (const action of actions) {
        if (API_PERMISSIONS[object] && API_PERMISSIONS[object][action]) {
          for (const permission of API_PERMISSIONS[object][action]) {
            if (!userGroupRolePermissions[role]) {
              userGroupRolePermissions[role] = {};
            }
            for (const action of permission.actions) {
              if (!userGroupRolePermissions[role][action]) {
                userGroupRolePermissions[role][action] = new Set();
              }
              for (const resource of permission.resources) {
                userGroupRolePermissions[role][action].add(`${apiArnPrefix}${resource}`);
              }
            }
          }
        }
      }
    }
  }
  return userGroupRolePermissions;
}
