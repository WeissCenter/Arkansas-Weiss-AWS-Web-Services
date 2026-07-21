from dar_tool import DataAnonymizer
import sys
from awsglue.transforms import *
from awsglue.utils import getResolvedOptions
from pyspark.context import SparkContext
from awsglue.context import GlueContext
from awsglue.job import Job
from awsglue.dynamicframe import DynamicFrame
import boto3
from boto3.dynamodb.types import TypeDeserializer
import uuid
import json
import traceback
import sys
from pyspark.sql import functions as f
from pyspark.sql.functions import lit, isnan, col, count
from pyspark.sql.window import Window
import pyspark
from itertools import combinations
import hashlib
from pyspark.sql import SQLContext
from pyspark.sql.types import StringType
import pandas as pd

def hash_row(row, columns):
    # Concatenate the values of the selected columns into a single string
    row_data = ''.join(str(row[col] if col in row else '') for col in columns)
    # Return a hash of the concatenated string
    return hashlib.md5(row_data.encode()).hexdigest()

def clearS3(bucket, prefix):
    s3 = boto3.resource('s3')
    bucket = s3.Bucket(bucket)
    bucket.objects.filter(Prefix=prefix).delete()



args = getResolvedOptions(sys.argv, ["JOB_NAME", "report-id", "glue-database", "table-name", "settings-table-name", "data-pull-s3", "report-data-s3", "published-report-data-crawler", "user"])
sc = SparkContext()
sc.setLogLevel('ERROR')
glueContext = GlueContext(sc)
spark = glueContext.spark_session
job = Job(glueContext)
job.init(args["JOB_NAME"], args)
dbClient = boto3.client('dynamodb')
logger = glueContext.get_logger()

deserializer = TypeDeserializer()


try:
    report = args["report_id"]
    table_name = args["table_name"]
    settings_table_name = args["settings_table_name"]
    data_pull_s3 = args["data_pull_s3"]
    report_data_s3 = args["report_data_s3"]
    glue_database = args["glue_database"]
    published_report_data_crawler = args["published_report_data_crawler"]

    dynamoResponse = dbClient.get_item(TableName=table_name, Key={"type": {"S": "Report"}, "id": {"S": f"ID#{report}#Version#draft#Lang#en"}})
    settingsDynamoResponse = dbClient.get_item(TableName=settings_table_name, Key={"type": {"S": "Settings"}, "id": {"S": f"ID#current"}})

    dynamo_report = {k: deserializer.deserialize(v) for k, v in dynamoResponse["Item"].items()} 
    dynamo_settings = {k: deserializer.deserialize(v) for k, v in settingsDynamoResponse["Item"].items()} 
    
    
    print('DATA VIEW', dynamo_report['dataView'].replace("-", "_"))

    new_node = glueContext.create_data_frame.from_catalog(database=glue_database, table_name=dynamo_report['dataView'].replace("-", "_"), additional_options={"useCatalogSchema": True, "useSparkDataSource": True})

    # Track which columns are strings so we can keep '' for them but restore real
    # nulls on the numeric/date columns before rebuilding the Spark frame below.
    string_columns = {field.name for field in new_node.schema.fields if isinstance(field.dataType, StringType)}

    data_frame = new_node.toPandas().fillna('')

    if 'suppression' in dynamo_report['template'] and dynamo_report['template']['suppression'].get('required', False):
        suppression =  dynamo_report['template']['suppression']
        frequency_columns = suppression.get('frequencyColumns', [])
        sensitive_columns = [col.lower() for col in suppression.get('sensitiveColumns', [])]
        parent_organization = suppression.get('parentOrganization', None)
        child_organization = suppression.get('childOrganization', None)
        hashing_rows = list(sensitive_columns)

        if parent_organization != None and type(parent_organization) is str:
            parent_organization = parent_organization.lower()

            hashing_rows.append(parent_organization)
        
        if child_organization != None and type(child_organization) is str:
            child_organization = child_organization.lower()

            hashing_rows.append(child_organization)

        # generate a hash for each row so can apply once suppression is complete

        data_frame['hash'] = data_frame.apply(lambda row: hash_row(row, list(sensitive_columns)), axis=1)

        suppressed_data_frame = data_frame.copy()

        for frequency in frequency_columns:
            try:
                normalized_frequency = frequency.lower()
                
                # force 
                suppressed_data_frame[normalized_frequency] = pd.to_numeric(suppressed_data_frame[normalized_frequency]) 

                anonymizer = DataAnonymizer(suppressed_data_frame, sensitive_columns=list(sensitive_columns), redact_value=0, redact_zero=True, child_organization=child_organization, parent_organization=parent_organization, frequency=normalized_frequency, minimum_threshold=int(dynamo_settings.get("nSize", 30)))

                suppressed_data_frame = anonymizer.apply_anonymization()

                suppressed_data_frame['hash'] = suppressed_data_frame.apply(lambda row: hash_row(row, hashing_rows), axis=1)

                suppressed_data_frame = data_frame.merge(suppressed_data_frame[['hash', normalized_frequency]], on='hash', how='left', suffixes=('', '_b'))

                data_frame[frequency] = suppressed_data_frame[f'{normalized_frequency}_b'].combine_first(suppressed_data_frame[normalized_frequency])

                data_frame.drop(columns=['hash'], inplace=True)
            except Exception as e:
                logger.error(f"Error processing frequency '{frequency}': {e}")
                continue

    clearS3(report_data_s3, report)

    # fillna('') above turned nulls in non-string columns into empty strings. When
    # spark.createDataFrame infers the schema it then sees both Decimal (populated
    # rows) and String ('' rows) for the same column and fails with
    # "Can not merge type DecimalType and StringType". Restore real nulls (None ->
    # NullType, which merges cleanly with any type) on every non-string column.
    for column in data_frame.columns:
        if column not in string_columns:
            data_frame[column] = data_frame[column].apply(lambda value: None if value == '' else value)

    glueContext.write_dynamic_frame.from_options(
        frame=DynamicFrame.fromDF(spark.createDataFrame(data_frame), glueContext, str(uuid.uuid4())),
        connection_type="s3",
        format="glueparquet",
        connection_options={
            "path": f"s3://{report_data_s3}/{report}",
            "partitionKeys": [],
        },
        format_options={"compression": "snappy"},)


    glue_client = boto3.client('glue')
    glue_client.start_crawler(Name=published_report_data_crawler)



except Exception as e:
    logger.error(f"ERROR: {e}")
    logger.error(f"TRACEBACK: {traceback.format_exc()}")
    raise Exception(json.dumps({"user": args["user"], "err": traceback.format_exc()}))



