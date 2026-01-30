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
import { checkTextExistenceInAllFrames } from '../helpers/helpers';
import { validateTextInWholePageSchema } from '../helpers/schemas';

export const validate_text_in_whole_page = defineTabTool({
  capability: 'core',
  schema: {
    name: 'validate_text_in_whole_page',
    title: 'Validate text in whole page',
    description: 'Validate that text exists or does not exist anywhere on the page',
    inputSchema: validateTextInWholePageSchema,
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    const { element, expectedText, matchType } = validateTextInWholePageSchema.parse(params);

    await tab.waitForCompletion(async () => {
      // Get locator for whole page and generate locator string
      const locatorString = 'page.locator("body")';

      // Helper function to create evidence command
      const createEvidenceCommand = () => JSON.stringify({
        description: 'Evidence showing how validation was performed',
        toolName: 'validate_text_in_whole_page',
        locator: locatorString,
        args: {
          expectedText,
          matchType
        }
      });

      let passed = false;
      let evidenceMessage = '';
      let actualCount = 0;
      let foundFrames: string[] = [];

      try {
        // Use checkTextExistenceInAllFrames to search across all frames
        const results = await checkTextExistenceInAllFrames(tab.page, expectedText, matchType);

        // Count found results
        const foundResults = results.filter(r => r.found);
        actualCount = foundResults.reduce((sum, r) => sum + (r.count || 0), 0);
        foundFrames = foundResults.map(r => `${r.frame} (${r.count})`);

        // Determine if test passes based on matchType
        if (matchType === 'exact' || matchType === 'contains') {
          if (actualCount > 0) {
            passed = true;
            evidenceMessage = `The text "${expectedText}" appeared ${actualCount} time(s) on the page using ${matchType} matching in frame(s): ${foundFrames.join(', ')}.`;
          } else {
            passed = false;
            evidenceMessage = `The text "${expectedText}" was not found on the page using ${matchType} matching.`;
          }
        } else { // not-contains
          if (actualCount === 0) {
            passed = true;
            evidenceMessage = `The text "${expectedText}" was correctly not found on the page using ${matchType} matching.`;
          } else {
            passed = false;
            evidenceMessage = `The text "${expectedText}" was found ${actualCount} time(s) on the page using ${matchType} matching in frames: ${foundFrames.join(', ')} — it should not appear.`;
          }
        }

      } catch (error) {
        passed = false;
        const errorMessage = error instanceof Error ? error.message : String(error);
        evidenceMessage = `Failed to validate text "${expectedText}" on the page.`;

        console.log(`Failed to validate text in whole page for "${element}". Error: ${errorMessage}`);
      }

      // Generate evidence as array with single object
      const evidence = [{
        command: createEvidenceCommand(),
        message: evidenceMessage
      }];

      // Generate final payload
      const payload = {
        element,
        expectedText,
        matchType,
        summary: {
          total: 1,
          passed: passed ? 1 : 0,
          failed: passed ? 0 : 1,
          status: passed ? 'pass' : 'fail',
          evidence,
        },
        checks: [{
          property: 'text-presence',
          operator: matchType,
          expected: matchType === 'not-contains' ? 'not-present' : 'present-once',
          actual: actualCount > 0 ? `present-${actualCount}-times` : 'not-present',
          actualCount: actualCount,
          foundFrames: foundFrames,
          result: passed ? 'pass' : 'fail',
        }],
        scope: 'whole-page-all-frames',
        searchMethod: 'checkTextExistenceInAllFrames',
      };

      console.log('Validate text in whole page:', payload);
      response.addResult(JSON.stringify(payload, null, 2));
    });
  },
});
