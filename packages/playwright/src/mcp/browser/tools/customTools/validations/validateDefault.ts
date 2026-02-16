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
import { expect } from '@zealous-tech/playwright/test';
import { defineTabTool } from '../../tool';
import { buildValidationErrorPayload, buildValidationPayload, createValidationEvidence, generateLocatorString, parseValidationResult } from '../helpers/helpers';
import { ELEMENT_ATTACHED_TIMEOUT} from '../helpers/utils';
import { defaultValidationSchema } from '../helpers/schemas';

export const default_validation = defineTabTool({
  capability: 'core',
  schema: {
    name: 'default_validation',
    title: 'Default Validation Tool',
    description: 'Flexible validation tool supporting two modes: (1) Element-based: provide ref+element to validate UI element, (2) Data-based: provide data (from browser_evaluate extraction like ${tableData}) to validate extracted data. jsCode receives either "element" or "data" parameter and must return either "pass"/"fail" string OR a rich object { result: "pass"|"fail", message: "Human readable message", expected: any, actual: any }.',
    inputSchema: defaultValidationSchema,
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    const { ref, element, jsCode } = params;
    if (!ref || !element) {
      const errorMessage = 'Missing required parameters: provide either "data" for data validation, or "ref" + "element" for element validation.';
      const evidence = [createValidationEvidence('element', jsCode, 'Either "data" parameter OR both "ref" and "element" parameters are required.')];
      const payload = buildValidationErrorPayload('element', jsCode, errorMessage, evidence);
      response.addTextResult(JSON.stringify(payload, null, 2));
      return;
    }

    await tab.waitForCompletion(async () => {
      try {
        const { locator } = await tab.refLocator({ ref, element });

        // Check if element is attached to DOM
        try {
          await expect(locator).toBeAttached({ timeout: ELEMENT_ATTACHED_TIMEOUT });
        } catch {
          const locatorString = await generateLocatorString(ref, locator, true);
          const errorMessage = `The UI Element "${element}" not found`;
          const evidence = [createValidationEvidence('element', jsCode, errorMessage, { element, locatorString })];
          const payload = buildValidationErrorPayload('element', jsCode, 'UI element not found', evidence, { ref, element });
          console.log('Default validation - UI element not found:', payload);
          response.addTextResult(JSON.stringify(payload, null, 2));
          return;
        }

        const locatorString = await generateLocatorString(ref, locator, true);

        // Execute JavaScript code on the element
        const result = await locator.evaluate((el: Element, code: string) => {
          try {
            const func = new Function('element', 'document', `'use strict'; ${code}`);
            const safeContext = {
              element: el,
              document,
              console: { log: () => {}, warn: () => {}, error: () => {} },
              setTimeout: undefined,
              setInterval: undefined,
              eval: undefined,
              Function: undefined,
              window: {
                innerWidth: window.innerWidth,
                innerHeight: window.innerHeight,
                localStorage: window.localStorage,
                sessionStorage: window.sessionStorage
              }
            };
            return func.call(safeContext, el, document);
          } catch (error) {
            return { error: error instanceof Error ? error.message : String(error), type: 'execution_error' };
          }
        }, jsCode);

        const validationResult = parseValidationResult(result, element);
        const evidence = [createValidationEvidence('element', jsCode, validationResult.evidenceMessage, {
          expectedValue: validationResult.expectedValue,
          actualValue: validationResult.actualValue,
          element,
          locatorString,
        })];

        const payload = buildValidationPayload('element', jsCode, validationResult, evidence, { ref, element });
        console.log('Default validation executed:', payload);
        response.addTextResult(JSON.stringify(payload, null, 2));

      } catch (error) {
        let locatorString = '';
        try {
          const { locator } = await tab.refLocator({ ref, element });
          locatorString = await generateLocatorString(ref, locator, true);
        } catch { /* ignore */ }

        const errorMessage = `Failed to execute JavaScript code on element "${element}".`;
        console.log(`${errorMessage} Error: ${error instanceof Error ? error.message : String(error)}`);

        const evidence = [createValidationEvidence('element', jsCode, errorMessage, { element, locatorString })];
        const payload = buildValidationErrorPayload('element', jsCode, error instanceof Error ? error.message : String(error), evidence, { ref, element });
        console.error('Default validation error:', payload);
        response.addTextResult(JSON.stringify(payload, null, 2));
      }
    });
  },
});
