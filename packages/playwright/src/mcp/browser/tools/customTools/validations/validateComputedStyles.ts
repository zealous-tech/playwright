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
import { getAllComputedStylesDirect, generateLocatorString } from '../helpers/helpers';
import {
  lookupNotification,
  notificationLocatorExpressions,
  readNotifications,
} from '../helpers/notificationBuffer';
import { getTimeout, pickActualValue, parseRGBColor, isColorInRange } from '../helpers/utils';
import { validateStylesSchema } from '../helpers/schemas';

type StyleCheck = { name: string; operator: string; expected: any };

type StyleCheckResult = {
  style: string;
  operator: string;
  expected: any;
  actual: string | undefined;
  result: 'pass' | 'fail';
};

const NOTIFICATION_BUFFER_REF = 'notification-buffer';
const DEFAULT_NOTIFICATION_LOOKBACK_MS = 15000;

/**
 * Evaluate style checks against a computed-style map. The map is keyed exactly as the CSSOM
 * reports it, whether it was read from a live element or captured when a notification appeared.
 */
function evaluateStyleChecks(
  allStyles: Record<string, string>,
  checks: StyleCheck[]
): StyleCheckResult[] {
  return checks.map(c => {
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
      result: (passed ? 'pass' : 'fail') as 'pass' | 'fail',
    };
  });
}

/**
 * Human-readable evidence message for a single evaluated check.
 */
function styleEvidenceMessage(result: StyleCheckResult, source: string = ''): string {
  const expectedValue = typeof result.expected === 'object' ? JSON.stringify(result.expected) : result.expected;
  return result.result === 'pass'
    ? `CSS Property "${result.style}" validation passed: actual value "${result.actual}" ${result.operator === 'isEqual' ? 'equals' : result.operator === 'notEqual' ? 'does not equal' : 'is in range'} expected "${expectedValue}"${source}`
    : `CSS Property "${result.style}" validation failed: actual value "${result.actual}" ${result.operator === 'isEqual' ? 'does not equal' : result.operator === 'notEqual' ? 'equals' : 'is not in range'} expected "${expectedValue}"${source}`;
}

/**
 * Build the failure payload used when no styles could be read at all (element/notification missing).
 */
function buildUnavailablePayload(params: {
  ref: string;
  element: string;
  notificationText?: string;
  resolvedLocator?: string;
  checks: StyleCheck[];
  evidence: Array<{ command: string; message: string }>;
}) {
  return {
    ref: params.ref,
    element: params.element,
    ...(params.notificationText ? { notificationText: params.notificationText } : {}),
    ...(params.resolvedLocator ? { resolvedLocator: params.resolvedLocator } : {}),
    summary: {
      total: params.checks.length,
      passed: 0,
      failed: params.checks.length,
      status: 'fail' as const,
      evidence: params.evidence,
    },
    checks: params.checks.map(c => ({
      style: c.name,
      operator: c.operator,
      expected: c.expected,
      actual: undefined,
      result: 'fail' as const,
    })),
  };
}

export const validate_computed_styles = defineTabTool({
  capability: 'core',
  schema: {
    name: 'validate_computed_styles',
    title: 'Validate computed styles of element',
    description:
      "Validate element's CSS computed styles against expected values using isEqual / notEqual / inRange operators. Supports RGB color range validation. For a toast/notification, pass notificationText and ref as a Playwright locator (not a snapshot e-ref).",
    inputSchema: validateStylesSchema,
    type: 'readOnly',
  },
  handle: async (tab, rawParams, response) => {
    const { ref, element, checks, notificationText, withinMs: requestedWithinMs } = validateStylesSchema.parse(rawParams);
    const withinMs = requestedWithinMs ?? DEFAULT_NOTIFICATION_LOOKBACK_MS;

    await tab.waitForCompletion(async () => {
      // Helper function to create evidence command
      const createEvidenceCommand = (locatorString: string, property: string, operator: string, expected?: any) => JSON.stringify({
        description: 'Evidence showing how validation was performed',
        toolName: 'validate_computed_styles',
        locator: locatorString,
        arguments: {
          property,
          operator,
          expected: expected !== undefined ? expected : null,
          ...(notificationText ? { notificationText, withinMs, ...(ref ? { ref } : {}) } : {}),
        }
      });

      // Notification styles come from the appear-time buffer, not from a live snapshot ref: a
      // transient toast is usually already removed from the DOM by the time validation runs.
      if (notificationText) {
        const { notifications, observerInstalled } = await readNotifications(tab.page, withinMs, {
          includeStyles: true,
          matchText: notificationText,
        });
        const { hit, locatorMismatch } = lookupNotification(notifications, notificationText, ref);
        const { toast: capturedLocator } = notificationLocatorExpressions(hit);
        const resolvedLocator = capturedLocator || ref;
        const bufferLocator = resolvedLocator || `notificationBuffer(${JSON.stringify(notificationText)})`;
        const capturedStyles = hit?.styles;

        let unavailableReason: string | undefined;
        if (locatorMismatch)
          unavailableReason = `a notification containing "${notificationText}" DID appear, but it was not found via the provided locator (${ref}). The notification's real locator is ${capturedLocator || 'unknown'}`;
        else if (!capturedStyles || Object.keys(capturedStyles).length === 0) {
          if (!observerInstalled)
            unavailableReason = 'the notification observer was not installed on this page';
          else if (!hit)
            unavailableReason = `no notification containing "${notificationText}" was captured within ${withinMs}ms`;
          else
            unavailableReason = `notification "${hit.text}" was captured, but no styles were recorded when it appeared`;
        }

        if (unavailableReason) {
          const evidence = checks.map(check => ({
            command: createEvidenceCommand(bufferLocator, check.name, check.operator, check.expected),
            message: `CSS Property "${check.name}" validation failed: ${unavailableReason}`,
          }));
          const payload = buildUnavailablePayload({
            ref: ref || NOTIFICATION_BUFFER_REF,
            element,
            notificationText,
            resolvedLocator,
            checks,
            evidence,
          });
          console.log('Validate Computed Styles (notification styles unavailable):', payload);
          response.addTextResult(JSON.stringify(payload, null, 2));
          return;
        }

        const results = evaluateStyleChecks(capturedStyles!, checks);
        const passedCount = results.filter(r => r.result === 'pass').length;
        const evidence = results.map(result => ({
          command: createEvidenceCommand(bufferLocator, result.style, result.operator, result.expected),
          message: styleEvidenceMessage(result, ' (captured when the notification appeared)'),
        }));

        const payload = {
          ref: ref || NOTIFICATION_BUFFER_REF,
          element,
          notificationText,
          ...(resolvedLocator ? { resolvedLocator } : {}),
          summary: {
            total: results.length,
            passed: passedCount,
            failed: results.length - passedCount,
            status: passedCount === results.length ? 'pass' : 'fail',
            evidence,
          },
          checks: results,
          source: 'transient-notification-buffer',
        };

        console.log('Validate Computed Styles (notification buffer):', payload);
        response.addTextResult(JSON.stringify(payload, null, 2));
        return;
      }

      if (!ref) {
        const evidence = checks.map(check => ({
          command: createEvidenceCommand('', check.name, check.operator, check.expected),
          message: `CSS Property "${check.name}" validation failed: provide "ref" for a page element, or "notificationText" with a Playwright locator in "ref" for a toast/notification`,
        }));
        const payload = buildUnavailablePayload({ ref: '', element, checks, evidence });
        console.log('Validate Computed Styles (no target):', payload);
        response.addTextResult(JSON.stringify(payload, null, 2));
        return;
      }

      // Get locator
      const { locator } = await tab.refLocator({ ref, element });

      // Check if element is attached to DOM with timeout
      try {
        await expect(locator).toBeAttached({ timeout: getTimeout(tab.context) });
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
      const results = evaluateStyleChecks(allStyles, checks);

      const passedCount = results.filter(r => r.result === 'pass').length;

      // Generate evidence as array of objects
      const evidence = results.map(result => ({
        command: createEvidenceCommand(locatorString, result.style, result.operator, result.expected),
        message: styleEvidenceMessage(result),
      }));

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
