from data.FileTransformer import fileTransformer
from pyspark.sql import SparkSession
from pyspark.sql.functions import col, lit, when, expr, monotonically_increasing_id
import pandas as pd
from pyspark.sql.functions import col, isnan
from bs4 import BeautifulSoup
import re



class partCChildCountAndSettingsTransformer(fileTransformer):

    def __init__(self, glue_context, spark_instance, **kwargs) -> None:
        super().__init__(glue_context, spark_instance)

    def _create_row(self, length, index, value, section, value_index):
        row = [''] * length
        row[index] = f"{value}"
        row[value_index] = "0"
        row[0] = section
        return row

    def _get_additional_html_info(self, html_content, part_c_parse_config):
        additional_rows = []
        # Parser made explicit: lxml is not installed in the isolated VPC, so we use
        # the bundled html5lib (browser-grade leniency) rather than letting bs4 guess.
        soup = BeautifulSoup(html_content, 'html5lib')

        sections = ['A', 'B', 'C', 'D', 'E']

        collection_acknowledgement_node = soup.find(lambda tag: tag.name == 'p' and  '''Has your state elected under''' in tag.text)
        collection_acknowledgement = collection_acknowledgement_node.find("b").text.lstrip();

        comment_nodes = soup.find_all(lambda tag: tag.name == 'p' and  "Comment:" in tag.text)
        comments = [cmt.text.replace("Comment:", "").lstrip() for cmt in comment_nodes]

        error_comment_node = soup.find(lambda tag: tag.name == 'p' and  "Error Comments:" in tag.text)
        error_comment = error_comment_node.text.replace("Error Comments:", "").lstrip()

        section_c_acknowledgement_root_node = soup.find(lambda tag: tag.name == 'tr' and  '''Report yes or no if your state collects more than two reporting categories for gender (male and female).: ''' in tag.text)
        section_c_acknowledgement_node = section_c_acknowledgement_root_node.find("td", {"class": "total_col"})
        section_c_acknowledgement = section_c_acknowledgement_node.text.lstrip()

        disclosure_node = soup.find(lambda tag: tag.name == 'p', {"class": "lastline"})
        disclosure = disclosure_node.text.lstrip()

        section_e_date_node = soup.find(lambda tag: tag.name == 'p' and "Cumulative Child Count Reference Period:" in tag.text)
        section_e_date_all = section_e_date_node.text.lstrip()
        date_pattern = r'\b(?:0?[1-9]|1[0-2])/(?:0?[1-9]|[12][0-9]|3[01])/\d{4}\b'

        date_matches = re.findall(date_pattern, section_e_date_all)

        section_e_date_left = date_matches[0]
        section_e_date_right = date_matches[1]

        acknowledgement_index = part_c_parse_config['header'].index("acknowledgement")
        comment_index = part_c_parse_config['header'].index("comment")
        value_index = part_c_parse_config['header'].index("value")

        header_len = len(part_c_parse_config['header'])

        collection_acknowledgement_row = self._create_row(header_len, acknowledgement_index, collection_acknowledgement,  'data-collection-acknowledgement', value_index)
        section_c_acknowledgement_row = self._create_row(header_len, acknowledgement_index, section_c_acknowledgement, 'section-c-collection-acknowledgement', value_index)
        error_comment_row = self._create_row(header_len, comment_index, error_comment, 'error-comment', value_index)
        disclosure_row = self._create_row(header_len, comment_index, disclosure, 'disclosure', value_index)
        left_date_row = self._create_row(header_len, comment_index, section_e_date_left, 'section-e-date-left', value_index)
        right_date_row = self._create_row(header_len, comment_index, section_e_date_right, 'section-e-date-right', value_index)

        additional_rows.extend([collection_acknowledgement_row, section_c_acknowledgement_row, error_comment_row, disclosure_row, left_date_row, right_date_row])

        for section, comment in zip(sections, comments):
            comment_row = self._create_row(header_len, comment_index, comment, f"{section}-comment", value_index)
            additional_rows.append(comment_row)


        return additional_rows
        

    def transform(self, pysparkDF, html_dataframes, dataParse, html_content):
        
        mappedRows = []
        part_c_parse_config = dataParse['config']


        additional_rows = self._get_additional_html_info(html_content, part_c_parse_config)

        mappedRows.extend(additional_rows)


        for section, table in zip(part_c_parse_config['groups'], html_dataframes):


            table = table[~table.apply(lambda x: x.str.contains('Birth through 2') | x.str.contains('3 or Older')).any(axis=1)]

            m = ~table.apply(lambda x: pd.to_numeric(x, errors = 'coerce')).notnull().any(axis=1)
    
            chunks = []
            start_idx = 0


            for i, is_all_strings in enumerate(m):
                if is_all_strings:
                    if i > start_idx:
                        chunks.append(table.iloc[start_idx:i])
                    start_idx = i + 1


            if start_idx < len(table):
                chunks.append(table.iloc[start_idx:])


            for cur_index, cursor in enumerate(chunks):

                cursor = cursor.fillna(0)

                for index, row in cursor.iterrows():
                    new_rows = []


                    for mapping_idx, row_mapping in enumerate(section['rowMapping']):

                        
                        field = row_mapping.get("field", None)
                        index = row_mapping.get("index", None)
                        label = row_mapping.get("label", None)
                        children = row_mapping.get("children", [])
                        value = row_mapping.get("value", False)

                        if index is None:
                            raise ValueError('missing index')
                        
                        if field is None and label is None:
                            raise ValueError('missing field or label')
                        
                        val = str(row[mapping_idx])


                        
                        if value:
                            new_row = [''] * len(part_c_parse_config['header'])

                            section_id = section['id']

                            new_row[0] = f'{section_id}.{cur_index+1}' if len(chunks) <= 1 else f'{section_id}.{cur_index+1}'
                            new_row[int(index)] = val

                            for sub_mapping_idx, sub_row_mapping in enumerate(section['rowMapping']):
                                if sub_row_mapping['field'] == row_mapping['field'] or sub_row_mapping.get('value', False):
                                    continue
                                
                                sub_index = sub_row_mapping.get("index", None)

                                if sub_index is None:
                                    raise ValueError('missing sub index')

                                new_row[int(sub_index)] = str(row[sub_mapping_idx])
                            
                        
                            

                            for child_idx, child in enumerate(children):
                                index = child.get("index", None)
                                label = child.get("label", None)

                                if label is None:
                                    raise ValueError('missing label')
                                
                                if index is None:
                                    raise ValueError('missing index')
                                
                                new_row[int(index)] = str(label)
                            
                                
                            new_rows.append(new_row)

                    
                    mappedRows.extend(new_rows)
                        
        return self.spark_instance.createDataFrame(mappedRows, part_c_parse_config.get('header', []))
            