from functools import reduce
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


class edFactsCSVTransformer(fileTransformer):

    def __init__(self, glue_context, spark_instance, config={"columns": [], "report_code": "", "report_levels": {}, "subtotal_columns": [], "category_conditions": {}, "included_in_all": [] }) -> None:
        super().__init__(glue_context, spark_instance)
        self.columns = config["columns"]
        self.report_code = config["report_code"]
        self.report_levels = config["report_levels"]
        self.included_in_all = config["included_in_all"]
        self.subtotal_columns = config["subtotal_columns"]
        self.category_conditions = config["category_conditions"]
        


    def transform(self, pysparkDF):

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

        pysparkDF = pysparkDF.toDF(*self.columns)


        # Initialize 'CategorySetCode' column
        pysparkDF = pysparkDF.withColumn("CategorySetCode", lit(""))
        pysparkDF = pysparkDF.withColumn("ReportCode", lit(self.report_code))
        if (year is not None) and ("-" in year):
            pysparkDF = pysparkDF.withColumn("ReportYear", lit(year.split("-")[1]))
        elif (year is not None) and (" " in year):
            pysparkDF = pysparkDF.withColumn("ReportYear", lit(year.split(" ")[1]))
        else:
            raise ValueError(f"Unexpected year format: {year}")
        # Set the level
        

        for level, header in self.report_levels.items():
            if contains_all(header.strip().split(" "), file_type):
                pysparkDF = pysparkDF.withColumn("ReportLevel", lit(level))
                break
            
        if not ("ReportLevel" in pysparkDF.columns):
             raise ValueError(file_type)


        # Apply category conditions
        for category, cols in self.category_conditions.items():
            super_cols = self.included_in_all + cols

            condition_expr = ' AND '.join([f"(`{col}` IS NOT NULL AND `{col}` != '')" for col in super_cols])
           # print("test", when(expr(condition_expr), lit(category)).otherwise(col("CategorySetCode")))
            pysparkDF = pysparkDF.withColumn("CategorySetCode", when(expr(condition_expr), lit(category)).otherwise(col("CategorySetCode")))


        # Apply subtotal conditions
        for i, columns in enumerate(self.subtotal_columns, start=1):
            # Build a dynamic condition for the columns in the current subtotal set
            column_conditions = [
                (col(column).isNotNull() & (col(column) != ""))
                for column in columns
            ]
            
            # Combine all column conditions using the `&` operator
            combined_condition = (
                reduce(lambda x, y: x & y, column_conditions) & (col('TotalIndicator') == 'Y')
            )
            
            # Apply the condition to update the "CategorySetCode" column
            pysparkDF = pysparkDF.withColumn(
                "CategorySetCode",
                when(combined_condition, lit(f"ST{i}")).otherwise(col("CategorySetCode"))
            )
            
        if len(self.subtotal_columns) > 0:
            # Initialize a list to store the conditions for each list of columns
            conditions = []

                # Iterate through each list in `subtotal_columns`
            for columns in self.subtotal_columns:
                    # Create a condition for the current group of columns
                group_condition = ' AND '.join([f"(`{col}` IS NULL OR `{col}` == '')" for col in columns])
                conditions.append(f"({group_condition})")

                # Combine all group conditions with OR
            final_condition_expr = f"({' AND '.join(conditions)}) AND `TotalIndicator` == 'Y'"
            
                # Apply the condition to update the "CategorySetCode" column
            pysparkDF = pysparkDF.withColumn(
                "CategorySetCode",
                when(expr(final_condition_expr), lit("TOT")).otherwise(col("CategorySetCode"))
        )
            

        return pysparkDF
        