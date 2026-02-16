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
import { asLocator } from 'playwright-core/lib/utils';
import { defineTabTool } from '../../tool';
import { generateLocator } from '../../utils';
import { getXPathCode } from '../helpers/utils';
import { generateLocatorSchema } from '../helpers/schemas';

export const generate_locator = defineTabTool({
  capability: 'core',
  schema: {
    name: 'generate_locator',
    title: 'Generate Playwright Locator from Ref',
    description: 'Generate a stable Playwright locator string from element ref using Playwright\'s built-in generateLocator function. Returns a single optimized locator string.',
    inputSchema: generateLocatorSchema,
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    const { ref, element, preferCssSelector } = params;

    try {
      await tab.waitForCompletion(async () => {
        // Get locator from ref
        // If ref starts with ###checkLocator, remove the prefix before passing to refLocator
        const refForLocator = ref.startsWith('###checkLocator')
          ? ref.substring('###checkLocator'.length)
          : ref;
        const { locator } = await tab.refLocator({ ref: refForLocator, element });

        // Always generate locator first
        let generatedLocator = await generateLocator(locator, preferCssSelector ?? false);
        let locatorType = 'playwright-generated';

        // If generated locator starts with getByText and ref has ###checkTextLocator prefix, use xpath instead
        if (ref.startsWith('###checkLocator')) {
          // Get xpath from element using getXPathCode from helperFunctions
          const xpathCode = getXPathCode();
          // Use evaluate with code from helperFunctions
          const xpath = await locator.evaluate((el: Element, code: string) => {
            const func = new Function('element', code);
            return func(el);
          }, xpathCode);
          // Return XPath in Playwright locator format: locator('xpath=...')
          const xpathSelector = `xpath=${xpath}`;
          generatedLocator = asLocator('javascript', xpathSelector);
          locatorType = 'xpath';
        }

        const payload = {
          ref,
          element,
          generatedLocator,
          summary: {
            status: 'success',
            message: `Successfully generated ${locatorType} locator for element "${element}" with ref "${ref}"`,
            locatorType,
            isStable: true,
            canBeReused: true,
          },
        };

        response.addTextResult(JSON.stringify(payload, null, 2));
      });
    } catch (error) {
      const errorPayload = {
        ref,
        element,
        summary: {
          status: 'error',
          message: `Failed to generate locator for element "${element}" with ref "${ref}". Error: ${error instanceof Error ? error.message : String(error)}.Snapshot:${JSON.stringify(await tab.captureSnapshot())}`,
        },
        error: error instanceof Error ? error.message : String(error),
      };

      console.error('Generate locator error:', errorPayload);
      response.addTextResult(JSON.stringify(errorPayload, null, 2));
    }
  },
});
