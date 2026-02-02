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
import { expect } from '@playwright/test';
import { defineTabTool } from '../../tool';
import { getAllComputedStylesDirect, generateLocatorString } from '../helpers/helpers';
import { ELEMENT_ATTACHED_TIMEOUT, pickActualValue, parseRGBColor, isColorInRange } from '../helpers/utils';
import { validateStylesSchema } from '../helpers/schemas';

export const validate_computed_styles = defineTabTool({
  capability: 'core',
  schema: {
    name: 'validate_computed_styles',
    title: 'Validate computed styles of element',
    description:
      "Validate element's CSS computed styles against expected values using isEqual / notEqual / inRange operators. Supports RGB color range validation for color properties.",
    inputSchema: validateStylesSchema,
    type: 'readOnly',
  },
  handle: async (tab, rawParams, response) => {
    const { ref, element, checks } = validateStylesSchema.parse(rawParams);

    await tab.waitForCompletion(async () => {
      // Get locator
      const { locator } = await tab.refLocator({ ref, element });

      // Helper function to create evidence command
      const createEvidenceCommand = (locatorString: string, property: string, operator: string, expected?: any) => JSON.stringify({
        description: 'Evidence showing how validation was performed',
        toolName: 'validate_computed_styles',
        locator: locatorString,
        arguments: {
          property,
          operator,
          expected: expected !== undefined ? expected : null
        }
      });

      // Check if element is attached to DOM with timeout
      try {
        await expect(locator).toBeAttached({ timeout: ELEMENT_ATTACHED_TIMEOUT });
      } catch (error) {
        // If element not found, generate payload with error and return early
        // Generate locator string for evidence (even if element not found, try to get locator string)
        let locatorString = '';

        locatorString = await generateLocatorString(ref, locator);

        const evidence = checks.map(check => ({
          command: createEvidenceCommand(locatorString, check.name, check.operator, check.expected),
          message: `CSS Property "${check.name}" validation failed: UI element not found`
        }));

        const payload = {
          ref,
          element,
          summary: {
            total: checks.length,
            passed: 0,
            failed: checks.length,
            status: 'fail' as const,
            evidence,
          },
          checks: checks.map(c => ({
            style: c.name,
            operator: c.operator,
            expected: c.expected,
            actual: undefined,
            result: 'fail' as const,
          })),
        };

        console.log('Validate Computed Styles (element not found):', payload);
        response.addTextResult(JSON.stringify(payload, null, 2));
        return;
      }

      // Generate locator string after element is confirmed to be attached
      const locatorString = await generateLocatorString(ref, locator);

      // 1) Get all computed styles directly
      let allStyles: any;
      try {
        allStyles = await getAllComputedStylesDirect(tab, ref, element);
      } catch (error) {
        // If getting styles fails, use empty object (element is confirmed to exist from toBeAttached check)
        allStyles = {};
      }
      // console.log("All Computed Styles:", allStyles);
      // 2) Validate rules
      const results = checks.map(c => {
        const actual = pickActualValue(allStyles, c.name);

        let passed: boolean;
        if (c.operator === 'isEqual') {
          // isEqual operator: strict equality only
          if (typeof c.expected === 'string' && (c.name.toLowerCase().includes('color') || c.name.toLowerCase().includes('background'))) {
            // For color properties, check if expected is in RGB format
            const expectedRGB = parseRGBColor(c.expected);
            const actualRGB = parseRGBColor(actual || '');

            if (expectedRGB && actualRGB) {
              // Compare RGB values with some tolerance for minor variations
              const tolerance = 5; // Allow small variations in RGB values
              passed = Math.abs(expectedRGB.r - actualRGB.r) <= tolerance &&
                          Math.abs(expectedRGB.g - actualRGB.g) <= tolerance &&
                          Math.abs(expectedRGB.b - actualRGB.b) <= tolerance;
            } else {
              // Fallback to strict equality if RGB parsing fails
              passed = actual === c.expected;
            }
          } else {
            // For non-color properties: strict equality
            passed = actual === c.expected;
          }
        } else if (c.operator === 'notEqual') {
          // notEqual operator: strict inequality
          passed = actual !== c.expected;
        } else if (c.operator === 'inRange') {
          // inRange operator: check if value is in list or RGB color is within range
          if (Array.isArray(c.expected)) {
            // For inRange with array: any matching value passes
            passed = actual !== undefined && c.expected.includes(actual);
          } else if (typeof c.expected === 'object' && 'minR' in c.expected) {
            // For inRange with RGB range object: check if color is within range
            passed = actual !== undefined && isColorInRange(actual, c.expected as { minR: number; maxR: number; minG: number; maxG: number; minB: number; maxB: number });
          } else {
            passed = false; // Invalid expected value - inRange only supports arrays and RGB range objects
          }
        } else {
          passed = false; // Unknown operator
        }

        return {
          style: c.name,
          operator: c.operator,
          expected: c.expected,
          actual,
          result: passed ? 'pass' : 'fail',
        };
      });


      const passedCount = results.filter(r => r.result === 'pass').length;

      // Generate evidence as array of objects
      const evidence = results.map(result => {
        const expectedValue = typeof result.expected === 'object' ? JSON.stringify(result.expected) : result.expected;
        const message = result.result === 'pass'
          ? `CSS Property "${result.style}" validation passed: actual value "${result.actual}" ${result.operator === 'isEqual' ? 'equals' : result.operator === 'notEqual' ? 'does not equal' : 'is in range'} expected "${expectedValue}"`
          : `CSS Property "${result.style}" validation failed: actual value "${result.actual}" ${result.operator === 'isEqual' ? 'does not equal' : result.operator === 'notEqual' ? 'equals' : 'is not in range'} expected "${expectedValue}"`;

        return {
          command: createEvidenceCommand(locatorString, result.style, result.operator, result.expected),
          message
        };
      });

      // 3) Answer
      const payload = {
        ref,
        element,
        summary: {
          total: results.length,
          passed: passedCount,
          failed: results.length - passedCount,
          status: passedCount === results.length ? 'pass' : 'fail',
          evidence,
        },
        checks: results,
      };

      console.log('Validate Computed Styles:', payload);
      response.addTextResult(JSON.stringify(payload, null, 2));
    });
  },
});
