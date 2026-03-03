from data.FileTransformer import fileTransformer
from pyspark.sql import SparkSession
from pyspark.sql.functions import col, lit, when, expr, monotonically_increasing_id


def remove_first_row(pysparkDF):
    df_with_id = pysparkDF.withColumn("row_id", monotonically_increasing_id())

    # Find the minimum row_id
    min_row_id = df_with_id.agg({"row_id": "min"}).collect()[0][0]

    # Filter out the first row
    df_without_first_row = df_with_id.filter(df_with_id.row_id != min_row_id).drop("row_id")

    return df_without_first_row

def contains_all(substrings, string):
    return all(substring in string for substring in substrings)


class fS089Transformer(fileTransformer):

    def __init__(self, glue_context, spark_instance, **kwargs) -> None:
        super().__init__(glue_context, spark_instance)
        

    def transform(self, pysparkDF):
        # new_column_names = ["File Record Number", "State Code", "State Agency Number", "LEA Identifier (State)", 
        #                     "School Identifier (State)", "Table Name", "Filler", "RACE", 
        #                     "SEX", "Filler", "Filler", "Filler", "Filler", "Filler", 
        #                     "Filler", "IDEADISABILITYTYPE", "Filler", "Filler", "AGE", 
        #                     "IDEAEDUCATIONALENVIRONMENTFORSCHOOLAGE", "ENGLISHLEARNERSTATUS", 
        #                     "TotalIndicator", "Explanation", "Student Count"]
        new_column_names = [
                "File Record Number",
                "State Code",
                "State Agency Number",
                "LEA Identifier (State)",
                "Filler",
                "Table Name",
                "RACE",
                "SEX",
                "AGE",
                "ENGLISHLEARNERSTATUS",
                "IDEADISABILITYTYPE",
                "Filler",
                "Filler",
                "Filler",
                "Filler",
                "Filler",
                "IDEAEDUCATIONALENVIRONMENTFOREARLYCHILDHOOD",
                "TotalIndicator",
                "Explanation",
                "StudentCount"
            ]
        
        
        first_row = pysparkDF.first()
        print(f"[DEBUG] FS089 FIRST ROW: {first_row}")
        # Extract the first column value
        first_column_value = first_row[0] if first_row is not None else None

        # Extract the first column value
        fourth_column_value = first_row[4] if first_row is not None else None
        print(f"[DEBUG] FS089 YEAR ROW: {first_row[4]}")

        # Convert to string if it's not None
        file_type = str(first_column_value) if first_column_value is not None else None

        year = str(fourth_column_value) if fourth_column_value is not None else None

        print(f"FILE TYPE ? {file_type}")

        pysparkDF = remove_first_row(pysparkDF)

        pysparkDF = pysparkDF.toDF(*new_column_names)


        # Initialize 'CategorySetCode' column
        pysparkDF = pysparkDF.withColumn("CategorySetCode", lit(""))
        pysparkDF = pysparkDF.withColumn("ReportCode", lit("089"))
        pysparkDF = pysparkDF.withColumn("ReportYear", lit(year.split("-")[1]))
        # Set the level

        if contains_all(["SCHOOL", "CHILDREN", "WITH", "DISABILITIES"], file_type):
            pysparkDF = pysparkDF.withColumn("ReportLevel", lit("sch"))
        elif contains_all(["LEA", "CHILDREN", "WITH", "DISABILITIES"], file_type):
            pysparkDF = pysparkDF.withColumn("ReportLevel", lit("lea"))
        elif contains_all(["SEA", "CHILDREN", "WITH", "DISABILITIES"], file_type):
            pysparkDF = pysparkDF.withColumn("ReportLevel", lit("sea"))
        else:
            raise ValueError(file_type)

                

        # Define category conditions
        category_conditions = {
            'CSA': ['`IDEAEDUCATIONALENVIRONMENTFOREARLYCHILDHOOD`', '`IDEADISABILITYTYPE`', '`AGE`'],
            'CSB': ['`IDEAEDUCATIONALENVIRONMENTFOREARLYCHILDHOOD`', '`IDEADISABILITYTYPE`', '`RACE`'],
            'CSC': ['`IDEAEDUCATIONALENVIRONMENTFOREARLYCHILDHOOD`', '`SEX`'],
            'CSD': ['`IDEAEDUCATIONALENVIRONMENTFOREARLYCHILDHOOD`',  '`ENGLISHLEARNERSTATUS`'],
        }

        # Apply category conditions
        for category, cols in category_conditions.items():
            condition_expr = ' AND '.join([f"({col} IS NOT NULL AND {col} != '')" for col in cols])
            pysparkDF = pysparkDF.withColumn("CategorySetCode", when(expr(condition_expr), lit(category)).otherwise(col("CategorySetCode")))

        # Define subtotal columns
        subtotal_columns = ['SEX', 'AGE', 'IDEADISABILITYTYPE', 'RACE', 'ENGLISHLEARNERSTATUS', 'IDEAEDUCATIONALENVIRONMENTFOREARLYCHILDHOOD']

        # Apply subtotal conditions
        for i, column in enumerate(subtotal_columns, start=1):
            condition = (col(column).isNotNull() & (col(column) != "")) & (col('TotalIndicator') == 'Y')
            pysparkDF = pysparkDF.withColumn("CategorySetCode", when(condition, lit(f"ST{i}")).otherwise(col("CategorySetCode")))

        # Apply final condition for "TOT"
        final_condition_expr = ' AND '.join([f"(`{col}` IS NULL OR `{col}` == '')" for col in subtotal_columns]) + " AND `TotalIndicator` == 'Y'"
        pysparkDF = pysparkDF.withColumn("CategorySetCode", when(expr(final_condition_expr), lit("TOT")).otherwise(col("CategorySetCode")))


        return pysparkDF
        