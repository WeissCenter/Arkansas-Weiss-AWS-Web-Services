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


class fS175Transformer(fileTransformer):

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
        "LEA Identifier",
        "School Identifier",
        "Table Name",
        "Grade Level",
        "Major Racial and Ethnic Groups",
        "Sex",
        "Disability Status",
        "English Learner Status",
        "Migratory Status",
        "Economically Disadvantaged Status",
        "Homeless Enrolled Status",
        "Assessment Administered M",
        "Filler",
        "Proficiency Status",
        "Foster Care Status",
        "Military Connected Student Status",
        "Total Indicator",
        "Explanation",
        "Student Count"
      ]
        
        
        first_row = pysparkDF.first()

        # Extract the first column value
        first_column_value = first_row[0] if first_row is not None else None

        # Extract the first column value
        fourth_column_value = first_row[4] if first_row is not None else None

        # Convert to string if it's not None
        file_type = str(first_column_value) if first_column_value is not None else None

        year = str(fourth_column_value) if fourth_column_value is not None else None

        print(f"FILE TYPE ? {file_type}")

        pysparkDF = remove_first_row(pysparkDF)

        pysparkDF = pysparkDF.toDF(*new_column_names)


        # Initialize 'CategorySetCode' column
        pysparkDF = pysparkDF.withColumn("CategorySetCode", lit(""))
        pysparkDF = pysparkDF.withColumn("ReportCode", lit("175"))
        if (year is not None) and ("-" in year):
            pysparkDF = pysparkDF.withColumn("ReportYear", lit(year.split("-")[1]))
        elif (year is not None) and (" " in year):
            pysparkDF = pysparkDF.withColumn("ReportYear", lit(year.split(" ")[1]))
        else:
            raise ValueError(f"Unexpected year format: {year}")
        
        # Set the level

        if contains_all(["SEA", "STUDENT", "PERFORMANCE", "MATH"], file_type):
            pysparkDF = pysparkDF.withColumn("ReportLevel", lit("sch"))
        elif contains_all(["LEA", "STUDENT", "PERFORMANCE", "MATH"], file_type):
            pysparkDF = pysparkDF.withColumn("ReportLevel", lit("lea"))
        elif contains_all(["SCHOOL", "STUDENT", "PERFORMANCE", "MATH"], file_type):
            pysparkDF = pysparkDF.withColumn("ReportLevel", lit("sea"))
        else:
            raise ValueError(file_type)

        included_in_all = ["`Assessment Administered M`", "`Grade Level`", "`Proficiency Status`"]

        # Define category conditions
        category_conditions = {
            "CSA": ["`Major Racial and Ethnic Groups`"],
            "CSB": ["`Sex`"],
            "CSC": ["`Disability Status`"],
            "CSD": ["`English Learner Status`"],
            "CSE": ["`Economically Disadvantaged Status`"],
            "CSF": ["`Migratory Status`"],
            "CSG": ["`Homeless Enrolled Status`"],
            "CSH": ["`Foster Care Status`"],
            "CSI": ["`Military Connected Student Status`"],
            "CSJ": ["`Major Racial and Ethnic Groups`", "`Disability Status`"]
        }

        # Apply category conditions
        for category, cols in category_conditions.items():
            super_cols = [*included_in_all, *cols]
            condition_expr = ' AND '.join([f"({col} IS NOT NULL AND {col} != '')" for col in super_cols])
            pysparkDF = pysparkDF.withColumn("CategorySetCode", when(expr(condition_expr), lit(category)).otherwise(col("CategorySetCode")))

        # Define subtotal columns
        subtotal_columns = included_in_all

        # Apply subtotal conditions
        for i, column in enumerate(subtotal_columns, start=1):
            condition = (col(column).isNotNull() & (col(column) != "")) & (col('TotalIndicator') == 'Y')
            pysparkDF = pysparkDF.withColumn("CategorySetCode", when(condition, lit(f"ST{i}")).otherwise(col("CategorySetCode")))

        # Apply final condition for "TOT"
        final_condition_expr = ' AND '.join([f"(`{col}` IS NULL OR `{col}` == '')" for col in subtotal_columns]) + " AND `TotalIndicator` == 'Y'"
        pysparkDF = pysparkDF.withColumn("CategorySetCode", when(expr(final_condition_expr), lit("TOT")).otherwise(col("CategorySetCode")))


        return pysparkDF
        