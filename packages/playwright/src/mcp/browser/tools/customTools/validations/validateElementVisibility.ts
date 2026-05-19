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
import { checkLocatorVisibilityInAllFrames } from '../helpers/helpers';
import { getTimeout } from '../helpers/utils';
import { validateElementVisibilitySchema } from '../helpers/schemas';

export const validate_element_visibility = defineTabTool({
  capability: 'core',
  schema: {
    name: 'validate_element_visibility',
    title: 'Validate element visibility',
    description: 'Validate that an element identified by a Playwright locator is visible or not visible anywhere on the page across all frames. Use visibility "visible" to verify the element is visible at least once (search stops on first match); use "not-visible" to verify it appears in no frame.',
    inputSchema: validateElementVisibilitySchema,
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    const { element, locator, visibility } = validateElementVisibilitySchema.parse(params);
    const matchType = visibility === 'visible' ? 'exist' : 'not-exist';

    await tab.waitForCompletion(async () => {
      const createEvidenceCommand = () => JSON.stringify({
        description: 'Evidence showing how validation was performed',
        toolName: 'validate_element_visibility',
        locator,
        args: { locator, visibility },
      });

      let passed = false;
      let evidenceMessage = '';
      let found = false;

      const timeout = getTimeout(tab.context);

      try {
        const results = await checkLocatorVisibilityInAllFrames(tab.page, locator, matchType, timeout);

        found = results.some(r => r.found);
        passed = visibility === 'visible' ? found : !found;

        if (passed) {
          evidenceMessage = visibility === 'visible'
            ? `The element "${element}" was found on the page.`
            : `The element "${element}" was correctly not found on the page.`;
        } else {
          evidenceMessage = visibility === 'visible'
            ? `The element "${element}" was not found on the page.`
            : `The element "${element}" was found on the page — it should not appear.`;
        }

      } catch (error) {
        passed = false;
        const errorMessage = error instanceof Error ? error.message : String(error);
        evidenceMessage = `Failed to validate visibility of element "${element}" on the page.`;

        console.log(`Failed to validate element visibility for "${element}". Error: ${errorMessage}`);
      }

      const evidence = [{
        command: createEvidenceCommand(),
        message: evidenceMessage,
      }];

      const payload = {
        summary: {
          total: 1,
          passed: passed ? 1 : 0,
          failed: passed ? 0 : 1,
          status: passed ? 'pass' : 'fail',
          evidence,
        },
      };
      response.addTextResult(JSON.stringify(payload, null, 2));
    });
  },
});
