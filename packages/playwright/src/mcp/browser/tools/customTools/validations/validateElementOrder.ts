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
import { generateLocatorString } from '../helpers/helpers';
import { ELEMENT_ATTACHED_TIMEOUT } from '../helpers/utils';
import { validateElementOrderSchema } from '../helpers/schemas';

export const validate_element_order = defineTabTool({
  capability: 'core',
  schema: {
    name: 'validate_element_order',
    title: 'Validate order of multiple elements',
    description: 'Validate that multiple elements appear in the expected visual order using natural reading order (top-to-bottom, then left-to-right). Only checks order, not exact positions.',
    inputSchema: validateElementOrderSchema,
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    const { elements } = validateElementOrderSchema.parse(params);

    await tab.waitForCompletion(async () => {
      let passed = false;
      let evidenceMessage = '';
      const checks: any[] = [];
      const elementCenters: Array<{ element: string; x: number; y: number }> = [];
      const locators: Array<{ element: string; locatorString: string }> = [];

      try {
        if (elements.length < 2)
          throw new Error('At least 2 elements are required to validate order');


        // Helper function to generate payload when element is not found
        const generateElementNotFoundPayload = async (missingElement: string) => {
          // Generate locator strings for all elements
          const allLocators: Array<{ element: string; locatorString: string }> = [];
          for (const { element, ref } of elements) {
            try {
              const locator = await tab.refLocator({ ref, element });
              const locatorString = await generateLocatorString(ref, locator);
              allLocators.push({ element, locatorString });
            } catch {
              allLocators.push({ element, locatorString: 'The UI Element not found' });
            }
          }

          const evidence = [{
            command: JSON.stringify({
              toolName: 'validate_element_order',
              arguments: {
                elements: elements.map(e => ({ element: e.element, ref: e.ref }))
              },
              locators: allLocators
            }),
            message: `The UI Element "${missingElement}" not found`
          }];

          return {
            elements: elements.map(e => ({ element: e.element, ref: e.ref })),
            summary: {
              total: elements.length,
              passed: 0,
              failed: elements.length,
              status: 'fail' as const,
              evidence,
            },
            checks: [],
            elementCenters: [],
            scope: 'multiple-elements',
            comparisonMethod: 'reading-order',
          };
        };

        // Get locators for all elements and check if they are attached
        const elementLocators: Array<{ element: string; ref: string; locator: any }> = [];
        for (const { element, ref } of elements) {
          const locator = await tab.refLocator({ ref, element });
          elementLocators.push({ element, ref, locator });
        }

        // Check if all elements are attached to DOM with timeout
        for (const { element, locator } of elementLocators) {
          try {
            await expect(locator).toBeAttached({ timeout: ELEMENT_ATTACHED_TIMEOUT });
          } catch (error) {
            // Element not found, generate payload and return early
            const payload = await generateElementNotFoundPayload(element);
            console.log('Validate element order - UI element not found:', payload);
            response.addResult(JSON.stringify(payload, null, 2));
            return;
          }
        }

        // Generate locator strings after all elements are confirmed to be attached
        for (const { element, ref, locator } of elementLocators) {
          const locatorString = await generateLocatorString(ref, locator);
          locators.push({ element, locatorString });
        }

        // Get bounding boxes for all elements
        const boxes: Array<{ element: string; ref: string; box: { x: number; y: number; width: number; height: number } | null }> = [];
        for (const { element, ref, locator } of elementLocators) {
          const box = await locator.boundingBox();
          boxes.push({ element, ref, box });

          if (!box)
            throw new Error(`Could not get bounding box for element: "${element}"`);

        }

        // Calculate center points for all elements
        const elementData: Array<{ element: string; ref: string; x: number; y: number; index: number }> = [];
        for (let i = 0; i < boxes.length; i++) {
          const { element, ref, box } = boxes[i];
          if (box) {
            const center = {
              x: box.x + box.width / 2,
              y: box.y + box.height / 2,
            };
            elementData.push({ element, ref, ...center, index: i });
            elementCenters.push({ element, ...center });
          }
        }

        // Helper function to compare elements by reading order (top-to-bottom, then left-to-right)
        // Returns: -1 if a comes before b, 1 if a comes after b, 0 if same position
        const compareReadingOrder = (a: { y: number; x: number }, b: { y: number; x: number }): number => {
          // First compare by y (top-to-bottom)
          const yDiff = a.y - b.y;
          // Use a threshold to account for elements on the same "row" (within 10px)
          const rowThreshold = 10;
          if (Math.abs(yDiff) > rowThreshold)
            return yDiff;

          // If roughly on the same row, compare by x (left-to-right)
          return a.x - b.x;
        };

        // Validate order: check that each element comes before the next one in reading order
        let allInOrder = true;
        const orderIssues: string[] = [];

        for (let i = 0; i < elementData.length - 1; i++) {
          const current = elementData[i];
          const next = elementData[i + 1];
          const comparison = compareReadingOrder(current, next);
          const isInOrder = comparison <= 0;

          const currentPos = `(x: ${Math.round(current.x)}, y: ${Math.round(current.y)})`;
          const nextPos = `(x: ${Math.round(next.x)}, y: ${Math.round(next.y)})`;

          checks.push({
            property: 'reading-order',
            operator: 'before-or-equal',
            expected: `Element "${current.element}" should come before or at same position as "${next.element}" in reading order`,
            actual: isInOrder ? 'in order' : 'out of order',
            result: isInOrder ? 'pass' : 'fail',
            currentElement: current.element,
            nextElement: next.element,
            currentPosition: currentPos,
            nextPosition: nextPos,
            comparison: comparison,
          });

          if (!isInOrder) {
            allInOrder = false;
            orderIssues.push(`"${current.element}" ${currentPos} comes after "${next.element}" ${nextPos} in reading order`);
          }
        }

        passed = allInOrder;

        // Generate evidence message
        const elementNames = elements.map(e => `"${e.element}"`).join(', ');
        if (passed) {
          evidenceMessage = `All elements are in correct reading order (top-to-bottom, then left-to-right): ${elementNames}. ` +
            `Total elements validated: ${elements.length}.`;
        } else {
          evidenceMessage = `Elements are NOT in correct reading order. ` +
            `Expected order: ${elementNames}. ` +
            `Order issues: ${orderIssues.join('; ')}.`;
        }

      } catch (error) {
        passed = false;
        const errorMessage = error instanceof Error ? error.message : String(error);
        evidenceMessage = `Failed to validate element order: ${errorMessage}`;

        console.error(`Failed to validate element order. Error: ${errorMessage}`);
      }

      // Generate evidence as array of objects with command and message
      const evidence = [{
        command: JSON.stringify({
          toolName: 'validate_element_order',
          arguments: {
            elements: elements.map(e => ({ element: e.element, ref: e.ref }))
          },
          locators: locators
        }),
        message: evidenceMessage
      }];

      // Generate final payload matching the structure of other validation tools
      const payload = {
        elements: elements.map(e => ({ element: e.element, ref: e.ref })),
        summary: {
          total: elements.length,
          passed: passed ? elements.length : 0,
          failed: passed ? 0 : elements.length,
          status: passed ? 'pass' : 'fail',
          evidence,
        },
        checks,
        elementCenters: elementCenters.map(ec => ({
          element: ec.element,
          x: Math.round(ec.x),
          y: Math.round(ec.y),
        })),
        scope: 'multiple-elements',
        comparisonMethod: 'reading-order',
      };

      console.log('Validate element order:', payload);
      response.addResult(JSON.stringify(payload, null, 2));
    });
  },
});
