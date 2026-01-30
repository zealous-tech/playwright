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
import { checkElementVisibilityUnique } from '../helpers/helpers';
import { validateElementInWholePageSchema } from '../helpers/schemas';

export const validate_element_in_whole_page = defineTabTool({
  capability: 'core',
  schema: {
    name: 'validate_element_in_whole_page',
    title: 'Validate element in whole page',
    description: 'Validate that element with specific role and accessible name exists or does not exist anywhere on the page. Use matchType "exist" to verify element exists exactly once, or "not-exist" to verify element does not exist.',
    inputSchema: validateElementInWholePageSchema,
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    const { element, role, accessibleName, matchType } = validateElementInWholePageSchema.parse(params);

    await tab.waitForCompletion(async () => {
      // Get locator for whole page and generate locator string
      const locatorString = 'page.locator("body")';

      // Helper function to create evidence command
      const createEvidenceCommand = () => JSON.stringify({
        description: 'Evidence showing how validation was performed',
        toolName: 'validate_element_in_whole_page',
        locator: locatorString,
        arguments: {
          role,
          accessibleName,
          matchType
        }
      });

      let passed = false;
      let evidenceMessage = '';
      let actualCount = 0;
      let foundFrames: string[] = [];

      try {
        // Use checkElementVisibilityUnique to search across all frames
        const results = await checkElementVisibilityUnique(tab.page, role, accessibleName);

        // Count found results
        const foundResults = results.filter(result => result.found);
        actualCount = foundResults.length;
        foundFrames = foundResults.map(result => result.frame);

        // Determine if test passes based on matchType
        if (matchType === 'exist') {
          if (actualCount === 1) {
            passed = true;
            evidenceMessage = `The element "${element}" was found once on the page using ${matchType} matching in frame: ${foundFrames[0]}.`;
          } else if (actualCount > 1) {
            passed = false;
            evidenceMessage = `The element "${element}" appeared ${actualCount} times on the page using ${matchType} matching in frames: ${foundFrames.join(', ')}. Expected only one occurrence.`;
          } else {
            passed = false;
            evidenceMessage = `The element "${element}" was not found on the page using ${matchType} matching.`;
          }
        } else { // not-exist
          if (actualCount === 0) {
            passed = true;
            evidenceMessage = `The element "${element}" was correctly not found on the page using ${matchType} matching.`;
          } else {
            passed = false;
            evidenceMessage = `The element "${element}" was found ${actualCount} time(s) on the page using ${matchType} matching in frames: ${foundFrames.join(', ')} — it should not appear.`;
          }
        }

      } catch (error) {
        passed = false;
        const errorMessage = error instanceof Error ? error.message : String(error);
        evidenceMessage = `Failed to find element "${element}" on the page.`;

        console.log(`Failed to validate element in whole page for "${element}". Error: ${errorMessage}`);
      }

      // Generate evidence as array with single object
      const evidence = [{
        command: createEvidenceCommand(),
        message: evidenceMessage
      }];

      // Generate final payload
      const payload = {
        element,
        role,
        accessibleName,
        matchType,
        summary: {
          total: 1,
          passed: passed ? 1 : 0,
          failed: passed ? 0 : 1,
          status: passed ? 'pass' : 'fail',
          evidence,
        },
        checks: [{
          property: 'element-presence',
          operator: matchType,
          expected: matchType === 'not-exist' ? 'not-present' : 'present-once',
          actual: actualCount > 0 ? `present-${actualCount}-times` : 'not-present',
          actualCount: actualCount,
          foundFrames: foundFrames,
          result: passed ? 'pass' : 'fail',
        }],
        scope: 'whole-page-all-frames',
        searchMethod: 'checkElementVisibilityUnique',
      };

      console.log('Validate element in whole page:', payload);
      response.addResult(JSON.stringify(payload, null, 2));
    });
  },
});
