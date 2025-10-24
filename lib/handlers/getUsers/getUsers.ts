// @ts-nocheck // FIXME: come back and fix typescript errors
import { APIGatewayEvent, Context, Handler } from "aws-lambda";
import { CreateBackendResponse, CreateBackendErrorResponse, appRolePermissions } from "../../../libs/types/src";
import { AdminListGroupsForUserCommand, CognitoIdentityProviderClient, GroupType, ListUsersCommand } from "@aws-sdk/client-cognito-identity-provider";

// Define Environment Variables
const USER_POOL_ID = process.env.USER_POOL_ID || "";
// const ROLE_NAMES = new Set(['admin', 'editor', 'reader']); // FIXME: correct Role Names
const ROLE_NAMES = new Set(Object.keys(appRolePermissions));

// AWS SDK Clients
const client = new CognitoIdentityProviderClient();

export const handler: Handler = async (event: APIGatewayEvent, context: Context) => {
  console.log(event);
  try {
    const command = new ListUsersCommand({
      UserPoolId: USER_POOL_ID
    });

    const result = await client.send(command);

    const userReturnObj = await Promise.all(
      result.Users?.flatMap(async (user) => {
        const select = new Set(["given_name", "family_name", "email"]);

        const attributes = {};

        for (const attri of user.Attributes) {
          if (select.has(attri.Name)) attributes[attri.Name] = attri.Value;
        }

        const listGroupsCommand = new AdminListGroupsForUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: user.Username
        });

        const groupsResult = await client.send(listGroupsCommand);

        const validGroups = groupsResult.Groups.filter((grp) => ROLE_NAMES.has(grp?.GroupName));

        // if(!validGroups.length) return [];
        let mostSeniorRole: GroupType | null = null;
        if (validGroups.length >= 1) {
          mostSeniorRole = validGroups.filter((group) => group.hasOwnProperty("Precedence")).reduce((lowest, group) => (group.Precedence < lowest.Precedence ? group : lowest), validGroups[0]);
        }

        return {
          active: user.Enabled || false,
          role: mostSeniorRole?.GroupName || "",
          username: user.Username,
          lastLogin: user.UserLastModifiedDate.getTime(),
          attributes
        };
      })
    );

    return CreateBackendResponse(200, userReturnObj.flat());
  } catch (err) {
    console.error(err);
    return CreateBackendErrorResponse(500, "failed retrieve user settings");
  }
};
