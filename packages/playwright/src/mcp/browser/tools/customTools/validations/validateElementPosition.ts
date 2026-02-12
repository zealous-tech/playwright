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
import { validateElementPositionSchema } from '../helpers/schemas';

export const validate_element_position = defineTabTool({
  capability: 'core',
  schema: {
    name: 'validate_element_position',
    title: 'Validate element position relative to another element',
    description: 'Validate the positional relationship between two elements by comparing their bounding boxes. Checks if element1 is left, right, up, or down relative to element2.',
    inputSchema: validateElementPositionSchema,
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    const { elements, relationship } = validateElementPositionSchema.parse(params);
    const element1 = elements[0].element;
    const ref1 = elements[0].ref;
    const element2 = elements[1].element;
    const ref2 = elements[1].ref;

    await tab.waitForCompletion(async () => {
      let passed = false;
      let evidence = '';
      let actualRelationship = '';
      let horizontalDiff = 0;
      let verticalDiff = 0;
      let center1 = { x: 0, y: 0 };
      let center2 = { x: 0, y: 0 };
      let locatorString1 = '';
      let locatorString2 = '';

      try {
        const { locator: locator1 } = await tab.refLocator({ ref: ref1, element: element1 });
        const { locator: locator2 } = await tab.refLocator({ ref: ref2, element: element2 });

        // Helper function to generate payload when element is not found
        const generateElementNotFoundPayload = async (
          missingElement: string,
          missingRef: string,
          missingLocator: any,
          otherElement: string,
          otherRef: string,
          otherLocator: any
        ) => {
          // Generate locator strings for both elements
          const locatorString1 = await generateLocatorString(missingRef, missingLocator);
          const locatorString2 = await generateLocatorString(otherRef, otherLocator);

          const evidenceArray = [{
            command: JSON.stringify({
              toolName: 'validate_element_position',
              locators: [
                {
                  element: missingElement,
                  locatorString: locatorString1
                },
                {
                  element: otherElement,
                  locatorString: locatorString2
                }
              ],
              arguments: {
                relationship: relationship
              }
            }),
            message: `The UI Element "${missingElement}" not found`
          }];

          return {
            element1,
            ref1,
            element2,
            ref2,
            relationship,
            summary: {
              total: 1,
              passed: 0,
              failed: 1,
              status: 'fail',
              evidence: evidenceArray,
            },
            checks: [{
              property: 'position-relationship',
              operator: 'equals',
              expected: relationship,
              actual: 'unknown',
              result: 'fail',
            }],
            scope: 'two-elements',
            comparisonMethod: 'bounding-box-centers',
          };
        };

        // Check if both elements are attached to DOM with timeout
        try {
          await expect(locator1).toBeAttached({ timeout: ELEMENT_ATTACHED_TIMEOUT });
        } catch (error) {
          // Element1 not found, generate payload and return early
          const payload = await generateElementNotFoundPayload(element1, ref1, locator1, element2, ref2, locator2);
          console.log('Validate element position - UI element not found:', payload);
          response.addTextResult(JSON.stringify(payload, null, 2));
          return;
        }

        try {
          await expect(locator2).toBeAttached({ timeout: ELEMENT_ATTACHED_TIMEOUT });
        } catch (error) {
          // Element2 not found, generate payload and return early
          const payload = await generateElementNotFoundPayload(element2, ref2, locator2, element1, ref1, locator1);
          console.log('Validate element position - UI element not found:', payload);
          response.addTextResult(JSON.stringify(payload, null, 2));
          return;
        }

        // Generate locator strings after both elements are confirmed to be attached
        locatorString1 = await generateLocatorString(ref1, locator1);
        locatorString2 = await generateLocatorString(ref2, locator2);

        // Get bounding boxes for both elements
        const box1 = await locator1.boundingBox();
        const box2 = await locator2.boundingBox();

        if (!box1)
          throw new Error(`Could not get bounding box for element1: "${element1}"`);

        if (!box2)
          throw new Error(`Could not get bounding box for element2: "${element2}"`);


        // Calculate center points for more accurate comparison
        center1 = {
          x: box1.x + box1.width / 2,
          y: box1.y + box1.height / 2,
        };
        center2 = {
          x: box2.x + box2.width / 2,
          y: box2.y + box2.height / 2,
        };

        // Determine actual relationship
        horizontalDiff = center1.x - center2.x;
        verticalDiff = center1.y - center2.y;

        // Determine relationships
        const isLeft = horizontalDiff < 0;
        const isRight = horizontalDiff > 0;
        const isUp = verticalDiff < 0;
        const isDown = verticalDiff > 0;

        // Build actual relationship description
        const relationships: string[] = [];
        if (isLeft)
          relationships.push('left');
        if (isRight)
          relationships.push('right');
        if (isUp)
          relationships.push('up');
        if (isDown)
          relationships.push('down');

        actualRelationship = relationships.length > 0 ? relationships.join(', ') : 'overlapping';

        // Validate based on expected relationship
        switch (relationship) {
          case 'left':
            passed = isLeft && !isRight;
            break;
          case 'right':
            passed = isRight && !isLeft;
            break;
          case 'up':
            passed = isUp && !isDown;
            break;
          case 'down':
            passed = isDown && !isUp;
            break;
        }

        // Generate evidence message
        if (passed) {
          evidence = `Element "${element1}" is ${relationship} relative to element "${element2}" as expected. ` +
            `Actual relationship: ${actualRelationship}. ` +
            `Horizontal difference: ${Math.round(horizontalDiff)}px, Vertical difference: ${Math.round(verticalDiff)}px.`;
        } else {
          evidence = `Element "${element1}" is NOT ${relationship} relative to element "${element2}". ` +
            `Expected: ${relationship}, Actual: ${actualRelationship}. ` +
            `Horizontal difference: ${Math.round(horizontalDiff)}px, Vertical difference: ${Math.round(verticalDiff)}px. ` +
            `Element1 center: (${Math.round(center1.x)}, ${Math.round(center1.y)}), ` +
            `Element2 center: (${Math.round(center2.x)}, ${Math.round(center2.y)}).`;
        }

      } catch (error) {
        passed = false;
        const errorMessage = error instanceof Error ? error.message : String(error);
        evidence = `Failed to validate element position: ${errorMessage}`;

        console.error(`Failed to validate element position for "${element1}" and "${element2}". Error: ${errorMessage}`);

        // Generate locator strings for error case (try to generate even if execution failed)
        try {
          const { locator: locator1 } = await tab.refLocator({ ref: ref1, element: element1 });
          locatorString1 = await generateLocatorString(ref1, locator1);
        } catch {
          locatorString1 = 'The UI Element not found';
        }

        try {
          const { locator: locator2 } = await tab.refLocator({ ref: ref2, element: element2 });
          locatorString2 = await generateLocatorString(ref2, locator2);
        } catch {
          locatorString2 = 'The UI Element not found';
        }
      }

      // Generate evidence as array of objects with command and message
      const evidenceArray = [{
        command: JSON.stringify({
          toolName: 'validate_element_position',
          locators: [
            {
              element: element1,
              locatorString: locatorString1
            },
            {
              element: element2,
              locatorString: locatorString2
            }
          ],
          arguments: {
            relationship: relationship
          }
        }),
        message: evidence
      }];

      // Generate final payload matching the structure of other validation tools
      const payload = {
        element1,
        ref1,
        element2,
        ref2,
        relationship,
        summary: {
          total: 1,
          passed: passed ? 1 : 0,
          failed: passed ? 0 : 1,
          status: passed ? 'pass' : 'fail',
          evidence: evidenceArray,
        },
        checks: [{
          property: 'position-relationship',
          operator: 'equals',
          expected: relationship,
          actual: actualRelationship || 'unknown',
          result: passed ? 'pass' : 'fail',
          horizontalDifference: Math.round(horizontalDiff),
          verticalDifference: Math.round(verticalDiff),
          element1Center: { x: Math.round(center1.x), y: Math.round(center1.y) },
          element2Center: { x: Math.round(center2.x), y: Math.round(center2.y) },
        }],
        scope: 'two-elements',
        comparisonMethod: 'bounding-box-centers',
      };

      console.log('Validate element position:', payload);
      response.addTextResult(JSON.stringify(payload, null, 2));
    });
  },
});
