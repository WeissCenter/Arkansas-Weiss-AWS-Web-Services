from functools import partial
import sys
import uuid
import json
import re
import boto3
import traceback
from data.transformers.edfactsCSVTransformer import edFactsCSVTransformer
from data.transformers.FS175Transformer import fS175Transformer
import pandas as pd
from awsglue.transforms import *
from awsglue.utils import getResolvedOptions
from pyspark.context import SparkContext
from awsglue.context import GlueContext
from awsglue.job import Job
from awsglue.dynamicframe import DynamicFrame
from boto3.dynamodb.types import TypeDeserializer
from sql_metadata import Parser
from data.FileTransformer import fileTransformerFactory
from data.transformers.FS002Transformer import fS002Transformer
from data.transformers.FS089Transformer import fS089Transformer
from data.transformers.FS007Transformer import fs007Transformer
from data.transformers.PartCChildCountAndSettingsTransformer import partCChildCountAndSettingsTransformer

args = getResolvedOptions(sys.argv, ["JOB_NAME", "data-view-id", "table-name", "data-pull-s3", "templates-table-name", "data-staging-s3", "data-pull-crawler", "user"])
sc = SparkContext()
sc.setLogLevel('ERROR')
glueContext = GlueContext(sc)
spark = glueContext.spark_session
job = Job(glueContext)
job.init(args["JOB_NAME"], args)
dbClient = boto3.client('dynamodb')
s3_client = boto3.client('s3')
logger = glueContext.get_logger()


# test config for 175 will eventually just slam it in the templates for data collections


fs_list = [
    "FS005",
    "FS006",
    "FS007",
    "FS009",
    "FS070",
    "FS088",
    "FS099",
    "FS112",
    "FS143",
    "FS144",
    "FS175",
    "FS178",
    "FS185",
    "FS188",
    "FS901",
    "FS902",
    "FS903",
    "FS904",
    "FS905",
]


common_opts = {"quoteChar": '\'', "withHeader": False, "separator": ","}

file_transformer_factory = fileTransformerFactory(glueContext, spark)

file_transformer_factory.register("FS002", fS002Transformer, common_opts)
file_transformer_factory.register("FS089", fS089Transformer, common_opts)
file_transformer_factory.register("FS007", fs007Transformer, common_opts)
 


for fs_code in fs_list:
    file_transformer_factory.register(fs_code, edFactsCSVTransformer, common_opts)


file_transformer_factory.register("partCHTML", partCChildCountAndSettingsTransformer, {"quoteChar": '\'', "withHeader": False, "separator": ","})
deserializer = TypeDeserializer()

def parseQuery(query, values):
    # regex to parse ${} placeholders out of the queries
    pattern = r'\$\{(\w+)\}'
    

    def replacer(match):
        variable_name = match.group(1)
        return f"'{str(values.get(variable_name, f'${{{variable_name}}}'))}'"  # Keep the original format if not found in dict

   
    result = re.sub(pattern, replacer, query)
    return result

def convertTableName(table):
    return table.lower().replace(".", "_")

def sparkSqlQuery(spark, glueContext, query, mapping) -> DynamicFrame:
    for alias, frame in mapping.items():
        frame.toDF().createOrReplaceTempView(alias)
    result = spark.sql(query)
    return DynamicFrame.fromDF(result, glueContext, str(uuid.uuid4()))

def getItemFromDDB(TableName, ItemType, ID):
    dynamoResponse = dbClient.get_item(TableName=TableName, Key={"type": {"S": ItemType}, "id": {"S": f"ID#{ID}"}})

    if not dynamoResponse["Item"]:
        raise f"item {id} of type {ItemType} does not exist"
        
    return {k: deserializer.deserialize(v) for k, v in dynamoResponse["Item"].items()} 

def clearS3(bucket, prefix):
    s3 = boto3.resource('s3')
    bucket = s3.Bucket(bucket)
    bucket.objects.filter(Prefix=prefix).delete()

def handleFileDataSource(nodes, dynamo_data_source, s3, format):
    path = dynamo_data_source['path']

    fileSpec = dynamo_data_source["fileSpec"]

    format_options = {}
    
    
    if format == 'csv':
        format_options = {"quoteChar": '\'', "withHeader": True, "separator": ","}

    try:
        format_options = file_transformer_factory.get_format_options(fileSpec)
    except:
        pass


    new_node = glueContext.create_dynamic_frame.from_options(
        format_options=format_options,
        connection_type="s3",
        format=format,
        connection_options={
            "paths": [
                f"s3://{s3}/{path}"
            ]
        },
    )   

    try:
        transformer = file_transformer_factory.get_transformer(fileSpec)

        df = transformer.transform(new_node.toDF())

        new_node = DynamicFrame.fromDF(df, glueContext, str(uuid.uuid4()))
    except:
        pass # ignore and try parsing normally


    nodes.append(new_node)

def handleTableDataSource(nodes, data_source, dynamo_data_source):
    schema = data_source["schema"]
    table = data_source["table"]
            
    new_node = glueContext.create_dynamic_frame.from_options(
                        connection_type="sqlserver",
                        connection_options={
                            "useConnectionProperties": "true",
                            "dbtable": f"{schema}.{table}",
                            "connectionName": dynamo_data_source["glueConnection"],
                        }
            )
            
    nodes.append(new_node)

def handleQueryDataSource(nodes, data_source, dynamo_data_source): 
    query = data_source["query"]
            
    tables = Parser(query).tables
            
    query_nodes = []
            
    for table in tables:
        query_node = glueContext.create_dynamic_frame.from_options(
                        connection_type="sqlserver",
                        connection_options={
                            "useConnectionProperties": "true",
                            "dbtable": table,
                            "connectionName": dynamo_data_source["glueConnection"],
                        }
                )
                
        mappedTable = convertTableName(table)
                
        query = query.replace(table, mappedTable)
                
        query_nodes.append({"table": mappedTable, "node": query_node})
            
    mapping = {f"{node['table']}" : node["node"] for node in query_nodes}

    sql_node = sparkSqlQuery(spark, glueContext, query=query, mapping=mapping)

    sqlDF = sql_node.toDF()

    print("SHAPE", (sqlDF.count(), len(sqlDF.columns)))
            
    nodes.append(sql_node)

def handleDBDataCollection(nodes, dbClient, table_name, dynamo_data_view):
 


    data_source = dynamo_data_view['data']['dataSource']

    dynamoDSResponse = dbClient.get_item(TableName=table_name, Key={"type": {"S": "DataSource"}, "id": {"S": f"ID#{data_source}"}})
            
    if not dynamoDSResponse["Item"]:
        raise f"Data Source {data_source} does not exist"
                
    dynamo_data_source = {k: deserializer.deserialize(v) for k, v in dynamoDSResponse["Item"].items()}

    # reduce fields array to object

    values = {field['id'] : field['value'] for field in dynamo_data_view['data']['fields']}
            
    for file in dynamo_data_view['data']['files']:

        query_nodes = []
        
        query = file['database']['query']

        # parse and replace markers

        query = parseQuery(query, values)

        print("QUERY", query)

        tables = Parser(query).tables

        print("TABLES", tables)

        for table in tables:
            query_node = glueContext.create_dynamic_frame.from_options(
                            connection_type="sqlserver",
                            connection_options={
                                "useConnectionProperties": "true",
                                "dbtable": table,
                                "connectionName": dynamo_data_source["glueConnection"],
                            }
                    )
            mappedTable = convertTableName(table)

            print("MAPPED TABLE", mappedTable)
                    
            query = query.replace(table, mappedTable)
                    
            query_nodes.append({"table": mappedTable, "node": query_node})

        mapping = {f"{node['table']}" : node["node"] for node in query_nodes}

        print("MAPPING", mapping)

        sql_node = sparkSqlQuery(spark, glueContext, query=query, mapping=mapping)
                
        nodes.append(sql_node)

def handleFileDataCollection(nodes, dynamo_data_view, data_staging_s3):
    format_options = {"quoteChar": '\'', "withHeader": True, "separator": ","}
    
        
    # get the data collection if it exists.
    
    reporting_year = getReportingYear(dynamo_data_view)
    template_dynamo_response = dbClient.get_item(TableName=templates_table_name, Key={"type": {"S": "DataCollection"}, "id": {"S": f"ID#{dynamo_data_view['data']['id']}#YEAR#{reporting_year}"}})


    dynamo_template = {k: deserializer.deserialize(v) for k, v in template_dynamo_response["Item"].items()} 
        


    # get data collection template
    for idx, file in enumerate(dynamo_data_view['data']['files']):
        
        fileSpec = file['id']

        try:
            format_options = file_transformer_factory.get_format_options(fileSpec)
        except:
            pass

        data_parse = file.get('dataParse', None)


        new_node = None

        kwargs = []

        if data_parse is not None:
            from_what = data_parse.get('from')
            
            if from_what == 'html':

                response = s3_client.get_object(Bucket=data_staging_s3, Key=f"{dynamo_data_view['dataViewID']}/{fileSpec}/{file['location']}")
                html_content = response['Body'].read().decode('utf-8')

                html_dfs = pd.read_html(html_content)

                # empty_df = spark.createDataFrame([])
                # new_node = DynamicFrame.fromDF(empty_df, glueContext, str(uuid.uuid4()))

                kwargs.append(html_dfs)
                kwargs.append(data_parse)
                kwargs.append(html_content)


            elif from_what == 'csv':
                    new_node = glueContext.create_dynamic_frame.from_options(
                    format_options=format_options,
                    connection_type="s3",
                    format='csv',
                    connection_options={
                        "paths": [
                            f"s3://{data_staging_s3}/{dynamo_data_view['dataViewID']}/{fileSpec}/{file['location']}"
                        ]
                    },
                )
            else:
                    raise ValueError("unknown from type")
        else:
            new_node = glueContext.create_dynamic_frame.from_options(
                    format_options=format_options,
                    connection_type="s3",
                    format='csv',
                    connection_options={
                        "paths": [
                            f"s3://{data_staging_s3}/{dynamo_data_view['dataViewID']}/{fileSpec}/{file['location']}"
                        ]
                    }
            )
            
        print(  f"s3://{data_staging_s3}/{dynamo_data_view['dataViewID']}/{fileSpec}/{file['location']}")
   
        transformer = file_transformer_factory.get_transformer(fileSpec, config=dynamo_template['files'][idx])
        
        df = transformer.transform((new_node or None) and new_node.toDF(), *kwargs)

        new_node = DynamicFrame.fromDF(df, glueContext, str(uuid.uuid4()))


        nodes.append(new_node)

def handleDataView(dbClient, table_name, dynamo_data_view, data_staging_s3):
    nodes = []
    
    view_type = dynamo_data_view.get('dataViewType')
    
    if view_type == 'collection':
        handleFileDataCollection(nodes, dynamo_data_view, data_staging_s3)
    elif view_type == 'database':
        handleDBDataCollection(nodes, dbClient, table_name, dynamo_data_view)

            
    
    return nodes;

def handleDataSources(dbClient, table_name, dynamo_data_set, data_staging_s3):
    nodes = []

    for data_source in dynamo_data_set['dataSources']:
        dynamoDSResponse = dbClient.get_item(TableName=table_name, Key={"type": {"S": "DataSource"}, "id": {"S": f"ID#{data_source['dataSource']}"}})
            
        if not dynamoDSResponse["Item"]:
            raise f"Data Source {data_source} does not exist"
                
        dynamo_data_source = {k: deserializer.deserialize(v) for k, v in dynamoDSResponse["Item"].items()}
            
        if "schema" in data_source and "table" in data_source:
            handleTableDataSource(nodes, data_source, dynamo_data_source)
                
        if "query" in data_source:
            handleQueryDataSource(nodes, data_source, dynamo_data_source)

        if not "schema" in data_source and not "query" in data_source and not "table" in data_source:
            handleFileDataSource(nodes, dynamo_data_source, data_staging_s3, 'csv')

    return nodes

def handleRelationships(nodes, dynamo_data_set):
    super_dataframe = None
    for index, relationship in enumerate(dynamo_data_set["dataSourceRelationships"]):
        left = None
            
        if index == 0:
            left = nodes[index].toDF()
        else:
            left = super_dataframe.toDF()
            
        right = nodes[index + 1].toDF()
            
            
        super_dataframe = DynamicFrame.fromDF(
                left.join(
                    right,
                    (
                        left[relationship["fromField"].lower()] == right[relationship["toField"].lower()]
                    ),
                    relationship["joinType"]
                ),
                glueContext,
                f'{index}'
            )
    
    return super_dataframe


def getReportingYear(dynamo_data_view):
    if ('reportingYear' in dynamo_data_view):
        # newer dataViews have the reporting year field at the top level
        return dynamo_data_view.get('reportingYear')
    else:
        # older dataViews have the reporting year field in the fields array
        return next((field['value'] for field in dynamo_data_view['data']['fields'] if field['id'] == 'reportingYear'), None)

try:

    data_view = args["data_view_id"]
    table_name = args["table_name"]
    data_pull_s3 = args["data_pull_s3"]
    data_staging_s3 = args["data_staging_s3"]
    data_pull_crawler = args["data_pull_crawler"]
    templates_table_name = args["templates_table_name"]
    
    dynamoResponse = dbClient.get_item(TableName=table_name, Key={"type": {"S": "DataView"}, "id": {"S": f"ID#{data_view}"}})

    dbClient.update_item(TableName=table_name,Key={"type": {"S": "DataView"}, "id": {"S": f"ID#{data_view}"}}, UpdateExpression="SET #status = :dataPullStatus", ExpressionAttributeValues={":dataPullStatus": {"S": "PROCESSING"}}, ExpressionAttributeNames={"#status": "status"})
    
    
    if not dynamoResponse["Item"]:
        raise f"Data View {data_view} does not exist"
        
    dynamo_data_view = {k: deserializer.deserialize(v) for k, v in dynamoResponse["Item"].items()} 

    
    nodes = handleDataView(dbClient, table_name, dynamo_data_view, data_staging_s3)

    logger.info(f"NODES: {nodes}")
    
    # super_dataframe = handleRelationships(nodes, dynamo_data_view)

    # if not super_dataframe:
    #     super_dataframe = nodes[0]


    clearS3(data_pull_s3, data_view)

    for index, file in enumerate(dynamo_data_view['data']['files']):
    
        result = glueContext.write_dynamic_frame.from_options(
            frame=nodes[index],
            connection_type="s3",
            format="glueparquet",
            connection_options={
                "path": f"s3://{data_pull_s3}/{data_view}/file={file['id']}",
                "partitionKeys": [],
            },
            format_options={"compression": "snappy"},
        )

# .otherwise(col("CategorySetCode"))

    glue_client = boto3.client('glue')
    glue_client.start_crawler(Name=data_pull_crawler)


    job.commit()
except Exception as e:
    #logger.error(f"TRACEBACK: {traceback.format_exc()}")
    raise Exception(json.dumps({"user": args["user"], "err": f"{e}"}))
    
