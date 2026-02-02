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
import { defineTabTool } from '../../tool';
import { runCommandClean } from '../helpers/helpers';
import { makeRequestSchema } from '../helpers/schemas';

export const make_request = defineTabTool({
  capability: 'core',
  schema: {
    name: 'make_request',
    title: 'Make HTTP request using curl command',
    description: 'Execute a curl command to make HTTP requests and return the response',
    inputSchema: makeRequestSchema,
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    const { command } = makeRequestSchema.parse(params);

    let toolResult: any = {
      success: false,
      apiResponse: {
        data: '',
        statusCode: undefined,
        responseTime: undefined,
        contentLength: undefined,
        contentType: undefined,
        server: undefined,
        error: undefined,
        rawStderr: undefined
      }
    };

    try {
      const result = await runCommandClean(command);
      toolResult = {
        success: true,
        apiResponse: result
      };
    } catch (error) {
      toolResult = {
        success: false,
        apiResponse: {
          data: '',
          statusCode: undefined,
          responseTime: undefined,
          contentLength: undefined,
          contentType: undefined,
          server: undefined,
          error: error instanceof Error ? error.message : String(error),
          rawStderr: undefined
        }
      };
    }

    response.addTextResult(JSON.stringify(toolResult, null, 2));
  },
});
