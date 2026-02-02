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
import { waitSchema } from '../helpers/schemas';

export const wait = defineTabTool({
  capability: 'core',
  schema: {
    name: 'wait',
    title: 'Wait',
    description: 'Wait for a specified duration in seconds',
    inputSchema: waitSchema,
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    const { seconds } = waitSchema.parse(params);

    await tab.waitForCompletion(async () => {
      await new Promise(resolve => setTimeout(resolve, seconds * 1000));
      response.addTextResult(`Waited for ${seconds} second(s)`);
    });
  },
});
