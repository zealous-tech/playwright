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
import { resolveLocator } from '../helpers/helpers';
import { verifyReusableLocatorsSchema } from '../helpers/schemas';
import { getTimeout, tryReadElementValue } from '../helpers/utils';

export const verify_reusable_locators = defineTabTool({
  capability: 'core',
  schema: {
    name: 'verify_reusable_locators',
    title: 'Verify reusable locators',
    description:
      'Given up to five ordered { id, locator } pairs, evaluates each locator on the active page. ' +
      'Returns the id of the first candidate whose locator resolves, matches at least one attached element, and yields a readable value ' +
      '(control value or text content). Returns null if none succeed.',
    inputSchema: verifyReusableLocatorsSchema,
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    const { candidates } = params;
    const timeout = getTimeout(tab.context);

    await tab.waitForCompletion(async () => {
      let matchedId: string | null = null;
      for (const { id, locator: locatorStr } of candidates) {
        try {
          const loc = resolveLocator(tab.page, locatorStr);
          await tryReadElementValue(loc, timeout);
          matchedId = id;
          break;
        } catch {
          // try next candidate
        }
      }
      response.addTextResult(JSON.stringify({ matchedId }));
    });
  },
});
