import { Handler, APIGatewayEvent } from "aws-lambda";
import { Context } from "vm";
import {
  AppRolePermissions,
  appRolePermissions,
  aws_generateDailyLogStreamID,
  aws_LogEvent,
  CreateBackendErrorResponse,
  CreateBackendResponse,
  EditUserInput,
  EventType,
  getUserDataFromEvent
} from "../../../libs/types/src";
import {
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminAddUserToGroupCommand,
  AdminListGroupsForUserCommand,
  AdminGetUserCommand,
  AdminRemoveUserFromGroupCommand,
  CognitoIdentityProviderClient,
  GetUserCommand,
  UserNotFoundException
} from "@aws-sdk/client-cognito-identity-provider";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";

// Define Environment Variables
const USER_POOL_ID = process.env.USER_POOL_ID || "";
const LOG_GROUP = process.env.LOG_GROUP || "";
// const ROLE_NAMES = new Set(['admin', 'editor', 'reader']); // FIXME: correct Role Names
const ROLE_NAMES = new Set(Object.keys(appRolePermissions));

// AWS SDK Clients
const client = new CognitoIdentityProviderClient();
const cloudwatch = new CloudWatchLogsClient({ region: "us-east-1" });
export const handler: Handler = async (event: APIGatewayEvent, context: Context) => {
  //   AdminAddUserToGroupCommand
  //   AdminRemoveUserFromGroupCommand
  //   AdminDisableUserCommand

  try {
    if (!event.body) return CreateBackendErrorResponse(400, "missing body");
    const username = getUserDataFromEvent(event).username;
    const logStream = aws_generateDailyLogStreamID();
    const body = JSON.parse(event.body) as EditUserInput;

    const userCommand = new AdminGetUserCommand({
      Username: body.username,
      UserPoolId: USER_POOL_ID
    });

    const userResult = await client.send(userCommand);

    if (body.active === false) {
      const setUserDisableCommand = new AdminDisableUserCommand({
        Username: body.username,
        UserPoolId: USER_POOL_ID
      });

      await client.send(setUserDisableCommand);

      await aws_LogEvent(cloudwatch, LOG_GROUP, logStream, username, EventType.EDIT, `User ${body.username} was disabled`);
    } else if (body.active && !userResult.Enabled) {
      const setUserActiveCommand = new AdminEnableUserCommand({
        Username: body.username,
        UserPoolId: USER_POOL_ID
      });

      await client.send(setUserActiveCommand);

      await aws_LogEvent(cloudwatch, LOG_GROUP, logStream, username, EventType.EDIT, `User ${body.username} was enabled`);
    }

    if (!body.role) return CreateBackendResponse(200);

    if (!ROLE_NAMES.has(body.role)) return CreateBackendErrorResponse(404, "unknown role");

    const userGroupsCommand = new AdminListGroupsForUserCommand({
      Username: body.username,
      UserPoolId: USER_POOL_ID
    });

    const userGroups = await client.send(userGroupsCommand);

    const validGroups = userGroups.Groups?.map((grp) => grp.GroupName!).filter((grp) => ROLE_NAMES.has(grp!));

    if (!validGroups?.includes(body.role!)) {
      await removeUserFromGroups(body.username, validGroups || []);

      if (validGroups?.length) {
        await aws_LogEvent(cloudwatch, LOG_GROUP, logStream, username, EventType.EDIT, `User ${body.username} was removed from the group(s) ${validGroups} `);
      }

      const addGroupCommand = new AdminAddUserToGroupCommand({
        Username: body.username,
        UserPoolId: USER_POOL_ID,
        GroupName: body.role
      });
      await client.send(addGroupCommand);

      await aws_LogEvent(cloudwatch, LOG_GROUP, logStream, username, EventType.EDIT, `User ${body.username} was added to group ${body.role} `);
    }

    return CreateBackendResponse(200);
  } catch (err) {
    if (err instanceof UserNotFoundException) {
      return CreateBackendErrorResponse(404, "User not found");
    }

    console.error(err);
    return CreateBackendErrorResponse(500, "failed to edit user");
  }
};
// remove user from the list of groups
async function removeUserFromGroups(username: string, groups: string[]) {
  return Promise.all(
    groups.map((grp) =>
      client.send(
        new AdminRemoveUserFromGroupCommand({
          Username: username,
          UserPoolId: USER_POOL_ID,
          GroupName: grp
        })
      )
    )
  );
}
