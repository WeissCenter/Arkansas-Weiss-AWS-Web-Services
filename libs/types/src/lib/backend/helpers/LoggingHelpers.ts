import { CloudWatchLogsClient, PutLogEventsCommand, CreateLogStreamCommand, DescribeLogStreamsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { EventType } from "../EventType";

export function aws_generateDailyLogStreamID() {
  return `${new Date().toLocaleDateString("en-us", { day: "numeric", year: "numeric", month: "numeric" })}-daily-logs`;
}

export async function aws_LogEvent(cloudwatch: CloudWatchLogsClient, group: string, stream: string, userID: string, eventType: EventType, event: string, extraMeta: { label: string; value: string }[] = []) {
  const checkIfLogStreamExistsCommand = new DescribeLogStreamsCommand({
    logGroupName: group,
    logStreamNamePrefix: stream
  });

  const existsResult = await cloudwatch.send(checkIfLogStreamExistsCommand);

  if (!existsResult?.logStreams?.length) {
    // create the log stream here
    const createCommand = new CreateLogStreamCommand({
      logGroupName: group,
      logStreamName: stream
    });

    await cloudwatch.send(createCommand);
  }

  const metaFields = [{ label: "user", value: userID }, { label: "type", value: eventType }, ...extraMeta].map((item) => `${item.label}=${item.value}`).join(",");

  const cloudWatchInput = {
    logGroupName: group,
    logStreamName: stream,
    logEvents: [
      {
        timestamp: Date.now(),
        message: `EVENT: ${metaFields}; ${event}`
      }
    ]
  };

  const command = new PutLogEventsCommand(cloudWatchInput);
  return cloudwatch.send(command);
}
