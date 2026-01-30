/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import * as jp from 'jsonpath';
import { defineTabTool } from '../../tool';
import { dataExtractionSchema } from '../helpers/schemas';

export const data_extraction = defineTabTool({
  capability: 'core',
  schema: {
    name: 'data_extraction',
    title: 'Data Extraction',
    description: 'Extract and store  value from data object using JSON path with $$ prefix for variable naming. If jsonPath is not provided, stores the data as is without JSON parsing',
    inputSchema: dataExtractionSchema,
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    const { name, data, jsonPath } = dataExtractionSchema.parse(params);

    let extractedValue;
    let parsedResponseData;

    if (jsonPath) {
      // If jsonPath is provided, parse as JSON and extract using path
      try {
        parsedResponseData = JSON.parse(data);
      } catch (error) {
        response.addResult(JSON.stringify({
          success: false,
          error: `Failed to parse data as JSON: ${error.message}`,
          extractedData: null
        }, null, 2));
        return;
      }

      try {
        const normalizedPath = jsonPath.startsWith('$') ? jsonPath : `$.${jsonPath}`;
        const queryResult = jp.query(parsedResponseData, normalizedPath);
        extractedValue = queryResult.length === 0 ? null : queryResult.length === 1 ? queryResult[0] : queryResult;
      } catch (error) {
        response.addResult(JSON.stringify({
          success: false,
          error: `Failed to extract value using JSON path "${jsonPath}": ${error.message}`,
          extractedData: null
        }, null, 2));
        return;
      }
    } else {
      // If jsonPath is not provided, return data as is
      extractedValue = data;
      parsedResponseData = data;
    }

    const toolResult = {
      success: true,
      extractedData: {
        value: extractedValue,
        variableName: `\$\{${name}\}`,
      },
      data: parsedResponseData,
    };
    response.addResult(JSON.stringify(toolResult, null, 2));
  },
});
