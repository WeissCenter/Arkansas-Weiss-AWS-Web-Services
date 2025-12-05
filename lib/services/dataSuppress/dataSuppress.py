from dar_tool import DataAnonymizer
from collections import defaultdict
from itertools import combinations
import pandas as pd
import json

def handler(event, context):
    
    print("EVENT", event)

    frequency_columns = event.get('frequencyColumns')
    sensitive_columns = event.get('sensitiveColumns')
    parent_organization = event.get('parentOrganization', None)
    child_organization = event.get('childOrganization', None)
    if type(frequency_columns) != list:
        frequency_columns = [frequency_columns]

    if type(sensitive_columns) != list:
        sensitive_columns = [sensitive_columns]

    threshold = event.get('threshold', 30)

    data = event.get('data')

    try:
        for operation in data:
            id = operation.get('id')

            value = operation.get('value', [])

            # skip non list or if list is empty for the time being
            if type(value) != list or len(value) <= 0:
                continue

            total = 0
            for frequency_column in frequency_columns:
                for val in value:
                    total += val.get(frequency_column, 0)

            # Unsuppressed total
            operation['total'] = total

            operation_sensitive_columns = list(filter(lambda x: x in sensitive_columns, value[0].keys()))

            print("operation_sensitive_columns", list(operation_sensitive_columns))

            # sum combinations of filter values for total amounts in insight of charts
            grouped_sums = defaultdict(int)
            column_combinations = []
            for i in range(1, len(operation_sensitive_columns) + 1):
                column_combinations.extend(combinations(operation_sensitive_columns, i))

            for frequency_column in frequency_columns:
                for entry in value:
                    for col_combo in column_combinations: 
                        key = tuple(entry[col] for col in col_combo if col in entry)
                        grouped_sums[(col_combo, key)] += entry.get(frequency_column, 0)

            # unique_results = {}
            # for (col_combo, key), total in grouped_sums.items():
            #     key_dict = dict(zip(col_combo, key))
            #     key_tuple = tuple(sorted(key_dict.items()))
            #     unique_results[key_tuple] = total

            # print("unique_results", unique_results) 

            # result = [
            #     {key: value for key, value in key_tuple} | {"sum": total}
            #     for key_tuple, total in unique_results.items() if len(key_tuple) == 1 and total > threshold
            # ]
            # print("result", result) 

            # operation['sub_totals'] = result

            # append dummy data that'll always get redacted DUE TO DAR-TOOL BUG
            
            # TODO: Fix this when dar-tool bug https://github.com/P20WCommunityOfInnovation/DAR-T/issues/105 gets fixed
            # dummy_data = {
            #     frequency_columns[0]: 0,
            #     parent_organization: 'DUMMY',
            #     child_organization: 'DUMMY',
            #     **{k: 'DUMMY' for k in operation_sensitive_columns}
            # }

            df_anonymized = pd.DataFrame.from_dict(value)

            if parent_organization and parent_organization not in list(df_anonymized.columns):
                # dummy_data.pop(parent_organization, None)
                parent_organization = None

            if child_organization and child_organization not in list(df_anonymized.columns):
                # dummy_data.pop(child_organization, None)
                child_organization = None

            # df_anonymized.loc[len(df_anonymized)] = dummy_data

            for frequency_column in frequency_columns:
               # print("df_anonymized", df_anonymized)
               # print("Initializing anonymizer", frequency_column, parent_organization, child_organization, threshold)
                anonymizer = DataAnonymizer(df_anonymized, sensitive_columns=operation_sensitive_columns, parent_organization=parent_organization, child_organization=child_organization, frequency=frequency_column, minimum_threshold=threshold, redact_zero=True, redact_value=0)

                df_anonymized = anonymizer.apply_anonymization()

            anonymized = []
            # TODO: Fix this when dar-tool bug https://github.com/P20WCommunityOfInnovation/DAR-T/issues/105 gets fixed

            # df_anonymized = df_anonymized.iloc[:-1]

            for index, row in df_anonymized.iterrows():
                
                mapped_obj = value[index]

                for frequency_column in frequency_columns:
                    if row['RedactBinary'] == 1 and mapped_obj[frequency_column] != 0:
                        mapped_obj[frequency_column] = 0
                    else:
                        mapped_obj[frequency_column] = row[frequency_column]
                anonymized.append(mapped_obj)


            operation['value'] = anonymized

            # Need to map the anonymized rows back to the input data

    except KeyError:
        return data
    except Exception as e:
        raise e



    return data
