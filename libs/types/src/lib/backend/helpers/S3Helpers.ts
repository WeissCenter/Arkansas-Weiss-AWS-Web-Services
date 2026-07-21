import { DeleteObjectCommand, ListObjectsCommand, S3Client } from "@aws-sdk/client-s3";


export async function deleteFolder(client: S3Client, key: string, bucketName: string) {
  const { Contents } = await client.send(new ListObjectsCommand({ Bucket: bucketName, Prefix: key }));

  if (!Contents) return;

  const deletePromises = Contents.map((object) =>
    client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: object.Key }))
  );

  const results = await Promise.allSettled(deletePromises);

  return results;
}