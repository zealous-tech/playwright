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
import { generateLocatorString, getAssertionEvidence } from '../helpers/helpers';
import { ELEMENT_ATTACHED_TIMEOUT, getElementErrorMessage, getAssertionMessage, convertStringToRegExp, normalizeValue } from '../helpers/utils';
import { validateDomAssertionsSchema } from '../helpers/schemas';

export const validate_dom_assertions = defineTabTool({
  capability: 'core',
  schema: {
    name: 'validate_dom_assertions',
    title: 'Validate DOM properties using Playwright assertions',
    description: 'Validate DOM properties using Playwright expect assertions (toBeEnabled, toBeDisabled, toBeVisible, etc.).',
    inputSchema: validateDomAssertionsSchema,
    type: 'readOnly',
  },
  handle: async (tab, rawParams, response) => {
    const { ref, element, checks } = validateDomAssertionsSchema.parse(rawParams);

    await tab.waitForCompletion(async () => {
      const locator = await tab.refLocator({ ref, element });
      const results = [];

      for (const check of checks) {
        const { negate, assertion: args } = check;
        if (!args || !args.assertionType)
          throw new Error('Each check must have assertion with assertionType');

        // Convert string RegExp patterns to actual RegExp objects
        const convertedArgs = convertStringToRegExp(args);
        // console.log('convertedArgs', convertedArgs);
        const { assertionType: name } = convertedArgs;
        // Get message for current assertion with element description
        const message: string = getAssertionMessage(name, element, negate);
        // Prepare final args - separate main arguments from options
        const { options, ...mainArgs } = convertedArgs;
        const finalOptions = { ...options, timeout: ELEMENT_ATTACHED_TIMEOUT };

        const result = {
          assertion: name,
          negate,
          result: 'fail' as 'pass' | 'fail',
          evidence: { message: '', command: '' },
          error: '',
          actual: '',
          arguments: args,
        };

        let locatorString: string = '';
        const createEvidenceCommand = (locatorStr: string) => JSON.stringify({
          description: 'Evidence showing how validation was performed',
          assertion: name,
          locator: locatorStr,
          arguments: Object.keys(mainArgs).length > 1 ? mainArgs : {},
          options: Object.keys(finalOptions).length > 0 ? finalOptions : {}
        });
        try {
          // Create the assertion with message
          const assertion = message
            ? (negate ? expect(locator, message).not : expect(locator, message))
            : (negate ? expect(locator).not : expect(locator));

          // Helper function to create evidence command


          // Execute the specific assertion by calling the method dynamically
          let assertionResult;
          switch (name) {
            case 'toBeEnabled':
              if (!convertedArgs || convertedArgs.assertionType !== 'toBeEnabled')
                throw new Error('toBeEnabled requires proper arguments structure');

              assertionResult = await assertion.toBeEnabled(finalOptions);
              result.actual = 'enabled';

              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs, options);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toBeDisabled':
              if (!args || args.assertionType !== 'toBeDisabled')
                throw new Error('toBeDisabled requires proper arguments structure');

              assertionResult = await assertion.toBeDisabled(finalOptions);
              result.actual = 'disabled';
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toBeVisible':
              if (!args || args.assertionType !== 'toBeVisible')
                throw new Error('toBeVisible requires proper arguments structure');

              assertionResult = await assertion.toBeVisible(finalOptions);
              result.actual = 'visible';
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs, options);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toBeHidden':
              if (!args || args.assertionType !== 'toBeHidden')
                throw new Error('toBeHidden requires proper arguments structure');

              assertionResult = await assertion.toBeHidden(finalOptions);
              result.actual = 'hidden';
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toBeInViewport':
              if (!args || args.assertionType !== 'toBeInViewport')
                throw new Error('toBeInViewport requires proper arguments structure');

              assertionResult = await assertion.toBeInViewport(finalOptions);
              result.actual = 'in viewport';
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toBeChecked':
              if (!args || args.assertionType !== 'toBeChecked')
                throw new Error('toBeChecked requires proper arguments structure');

              assertionResult = await assertion.toBeChecked(finalOptions);
              result.actual = 'checked';
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs, options);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;


            case 'toBeFocused':
              if (!args || args.assertionType !== 'toBeFocused')
                throw new Error('toBeFocused requires proper arguments structure');

              assertionResult = await assertion.toBeFocused(finalOptions);
              result.actual = 'focused';
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toBeEditable':
              if (!args || args.assertionType !== 'toBeEditable')
                throw new Error('toBeEditable requires proper arguments structure');

              assertionResult = await assertion.toBeEditable(finalOptions);
              result.actual = 'editable';
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs, options);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toBeEmpty':
              if (!args || args.assertionType !== 'toBeEmpty')
                throw new Error('toBeEmpty requires proper arguments structure');

              assertionResult = await assertion.toBeEmpty(finalOptions);
              result.actual = 'empty';
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toBeAttached':
              if (!args || args.assertionType !== 'toBeAttached')
                throw new Error('toBeAttached requires proper arguments structure');

              assertionResult = await assertion.toBeAttached(finalOptions);
              result.actual = 'attached';
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs, options);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toHaveAttribute':
              if (!args || args.assertionType !== 'toHaveAttribute')
                throw new Error('toHaveAttribute requires proper arguments structure');

              const { name: attrName, value: attrValue } = mainArgs;
              if (!attrName)
                throw new Error('toHaveAttribute requires "name" argument (string)');

              // If value is provided, check attribute with value; otherwise, just check existence
              // ignoreCase option is only applicable when checking value, so exclude it when value is not provided
              let attributeOptions = finalOptions;
              if (attrValue === undefined && finalOptions.ignoreCase !== undefined) {
                const { ignoreCase, ...optionsWithoutIgnoreCase } = finalOptions;
                attributeOptions = optionsWithoutIgnoreCase;
              }
              if (attrValue !== undefined) {
                assertionResult = await assertion.toHaveAttribute(attrName, attrValue, attributeOptions);
                result.actual = `attribute "${attrName}"="${attrValue}"`;
              } else {
                assertionResult = await assertion.toHaveAttribute(attrName, attributeOptions);
                result.actual = `attribute "${attrName}" exists`;
              }
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              // Use attributeOptions (which excludes ignoreCase when value is not provided) for evidence
              result.evidence.command = JSON.stringify({
                description: 'Evidence showing how validation was performed',
                assertion: name,
                locator: locatorString,
                arguments: Object.keys(mainArgs).length > 1 ? mainArgs : {},
                options: Object.keys(attributeOptions).length > 0 ? attributeOptions : {}
              });
              break;

            case 'toHaveText':
              if (!args || args.assertionType !== 'toHaveText')
                throw new Error('toHaveText requires proper arguments structure');

              const { expected: textExpected } = mainArgs;
              if (!textExpected)
                throw new Error('toHaveText requires "expected" argument (string, RegExp, or Array<string | RegExp>)');

              assertionResult = await assertion.toHaveText(textExpected, finalOptions);
              result.actual = `text "${Array.isArray(textExpected) ? textExpected.join(', ') : textExpected}"`;
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toContainText':
              if (!args || args.assertionType !== 'toContainText')
                throw new Error('toContainText requires proper arguments structure');

              const { expected: containExpected } = mainArgs;
              if (!containExpected)
                throw new Error('toContainText requires "expected" argument (string, RegExp, or Array<string | RegExp>)');

              assertionResult = await assertion.toContainText(containExpected, finalOptions);
              result.actual = `contains text "${Array.isArray(containExpected) ? containExpected.join(', ') : containExpected}"`;
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toHaveValue':
              if (!args || args.assertionType !== 'toHaveValue')
                throw new Error('toHaveValue requires proper arguments structure');

              const { value: valueExpected } = mainArgs;
              if (valueExpected === undefined)
                throw new Error('toHaveValue requires "value" argument (string or RegExp)');

              assertionResult = await assertion.toHaveValue(valueExpected, finalOptions);
              result.actual = `value "${valueExpected}"`;
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toHaveValues':
              if (!args || args.assertionType !== 'toHaveValues')
                throw new Error('toHaveValues requires proper arguments structure');

              const { values: valuesExpected } = mainArgs;
              if (!valuesExpected || !Array.isArray(valuesExpected))
                throw new Error('toHaveValues requires "values" argument (Array<string | RegExp>)');

              assertionResult = await assertion.toHaveValues(valuesExpected, finalOptions);
              result.actual = `values [${valuesExpected.join(', ')}]`;
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'selectHasValue':
              if (!args || args.assertionType !== 'selectHasValue')
                throw new Error('selectHasValue requires proper arguments structure');

              const { value: selectValueExpected } = mainArgs;
              if (selectValueExpected === undefined)
                throw new Error('selectHasValue requires "value" argument (string)');

              const normalizedExpected = normalizeValue(selectValueExpected);

              // Use expect.poll to retry the assertion with timeout
              const pollFn = async () => {
                const actualValue = await locator.inputValue();
                const normalizedActual = normalizeValue(actualValue);
                return { actualValue, normalizedActual };
              };

              const pollFnDeep = async () => {
                return await locator.evaluate((el: Element) => {
                  // <select> element
                  if (el instanceof HTMLSelectElement) {
                    const selected = el.selectedOptions[0];
                    return {
                      rawValue: el.value,
                      displayText: selected?.textContent ?? '',
                    };
                  }
                  // <input> (MUI / headless UI combobox)
                  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
                    return {
                      rawValue: el.value,
                      displayText: el.value,
                    };
                  }
                  // Fallback: try text content
                  return {
                    rawValue: (el as HTMLElement).innerText || (el as HTMLElement).textContent || '',
                    displayText: (el as HTMLElement).innerText || (el as HTMLElement).textContent || '',
                  };
                });
              };

              const selectTimeout = finalOptions?.timeout || ELEMENT_ATTACHED_TIMEOUT;
              const startTime = Date.now();
              let lastError: Error | null = null;
              let lastActualValue = '';
              let lastNormalizedActual = '';
              let found = false;
              while (Date.now() - startTime < selectTimeout) {
                try {
                  const { actualValue, normalizedActual } = await pollFn();
                  lastActualValue = actualValue;
                  lastNormalizedActual = normalizedActual;

                  if (negate) {
                    // For negated assertions, values should NOT match
                    if (normalizedExpected === normalizedActual)
                      throw new Error(`Expected select value to not be "${selectValueExpected}" (normalized: "${normalizedExpected}"), but got "${actualValue}" (normalized: "${normalizedActual}")`);

                    // Values don't match, assertion passes
                    break;
                  } else {
                    // For normal assertions, values should match
                    if (normalizedExpected === normalizedActual) {
                      // Values match, assertion passes
                      found = true;
                      break;
                    }
                    // Values don't match yet, will retry
                    throw new Error(`Expected select value to be "${selectValueExpected}" (normalized: "${normalizedExpected}"), but got "${actualValue}" (normalized: "${normalizedActual}")`);
                  }
                } catch (error) {
                  lastError = error instanceof Error ? error : new Error(String(error));
                  try {
                    // workground for hot fix to check select value in deep
                    const { rawValue, displayText } = await pollFnDeep();
                    const normalizedRawValue = normalizeValue(rawValue);
                    const normalizedDisplayText = normalizeValue(displayText);
                    if (normalizedExpected === normalizedRawValue || normalizedExpected === normalizedDisplayText) {
                      found = true;
                      break;
                    }
                  } catch (error) {
                    // not sure how log here, but just ignore
                  }

                  // If timeout hasn't expired, wait a bit and retry
                  if (Date.now() - startTime < selectTimeout) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    continue;
                  }
                  // Timeout expired, throw the last error
                  throw lastError;
                }
              }

              if (!found)
                throw lastError;


              // If we get here and it's a negated assertion that didn't throw, it means values matched when they shouldn't
              if (negate && normalizedExpected === lastNormalizedActual)
                throw new Error(`Expected select value to not be "${selectValueExpected}" (normalized: "${normalizedExpected}"), but got "${lastActualValue}" (normalized: "${lastNormalizedActual}")`);


              // Use a simple assertion that always passes when values match (or don't match for negated)
              assertionResult = await assertion.toBeAttached(finalOptions);
              result.actual = `value "${lastActualValue}" (normalized: "${lastNormalizedActual}")`;
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toMatchAriaSnapshot':
              if (!args || args.assertionType !== 'toMatchAriaSnapshot')
                throw new Error('toMatchAriaSnapshot requires proper arguments structure');

              const { expected: ariaSnapshotExpected } = mainArgs;
              if (!ariaSnapshotExpected)
                throw new Error('toMatchAriaSnapshot requires "expected" argument (string)');

              assertionResult = await assertion.toMatchAriaSnapshot(ariaSnapshotExpected, finalOptions);
              result.actual = `aria snapshot "${ariaSnapshotExpected}"`;
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toMatchAriaSnapshotOptions':
              if (!args || args.assertionType !== 'toMatchAriaSnapshotOptions')
                throw new Error('toMatchAriaSnapshotOptions requires proper arguments structure');

              assertionResult = await assertion.toMatchAriaSnapshot(finalOptions);
              result.actual = 'aria snapshot (with options)';
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toContainClass':
              if (!args || args.assertionType !== 'toContainClass')
                throw new Error('toContainClass requires proper arguments structure');

              const { expected: containClassExpected } = mainArgs;
              if (!containClassExpected)
                throw new Error('toContainClass requires "expected" argument (string or Array<string>)');

              assertionResult = await assertion.toContainClass(containClassExpected, finalOptions);
              result.actual = `contains class "${Array.isArray(containClassExpected) ? containClassExpected.join(' ') : containClassExpected}"`;
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toHaveClass':
              if (!args || args.assertionType !== 'toHaveClass')
                throw new Error('toHaveClass requires proper arguments structure');

              const { expected: classExpected } = mainArgs;
              if (!classExpected)
                throw new Error('toHaveClass requires "expected" argument (string, RegExp, or Array<string | RegExp>)');

              assertionResult = await assertion.toHaveClass(classExpected, finalOptions);
              result.actual = `class "${Array.isArray(classExpected) ? classExpected.join(' ') : classExpected}"`;
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toHaveCount':
              if (!args || args.assertionType !== 'toHaveCount')
                throw new Error('toHaveCount requires proper arguments structure');

              const { count } = mainArgs;
              if (count === undefined)
                throw new Error('toHaveCount requires "count" argument (number)');

              assertionResult = await assertion.toHaveCount(count, finalOptions);
              result.actual = `count ${count}`;
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toHaveCSS':
              if (!args || args.assertionType !== 'toHaveCSS')
                throw new Error('toHaveCSS requires proper arguments structure');

              const { name: cssName, value: cssValue } = mainArgs;
              if (!cssName || !cssValue)
                throw new Error('toHaveCSS requires "name" and "value" arguments');

              assertionResult = await assertion.toHaveCSS(cssName, cssValue, finalOptions);
              result.actual = `CSS ${cssName}="${cssValue}"`;
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toHaveId':
              if (!args || args.assertionType !== 'toHaveId')
                throw new Error('toHaveId requires proper arguments structure');

              const { id } = mainArgs;
              if (!id)
                throw new Error('toHaveId requires "id" argument (string or RegExp)');

              assertionResult = await assertion.toHaveId(id, finalOptions);
              result.actual = `id "${id}"`;
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toHaveJSProperty':
              if (!args || args.assertionType !== 'toHaveJSProperty')
                throw new Error('toHaveJSProperty requires proper arguments structure');

              const { name: jsPropertyName, value: jsPropertyValue } = mainArgs;
              if (!jsPropertyName || jsPropertyValue === undefined)
                throw new Error('toHaveJSProperty requires "name" and "value" arguments');

              assertionResult = await assertion.toHaveJSProperty(jsPropertyName, jsPropertyValue, finalOptions);
              result.actual = `JS property ${jsPropertyName}="${JSON.stringify(jsPropertyValue)}"`;
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toHaveRole':
              if (!args || args.assertionType !== 'toHaveRole')
                throw new Error('toHaveRole requires proper arguments structure');

              const { role } = mainArgs;
              if (!role)
                throw new Error('toHaveRole requires "role" argument (ARIA role)');

              assertionResult = await assertion.toHaveRole(role, finalOptions);
              result.actual = `role "${role}"`;
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toHaveScreenshot':
              if (!args || args.assertionType !== 'toHaveScreenshot')
                throw new Error('toHaveScreenshot requires proper arguments structure');

              const { name: screenshotName } = mainArgs;
              // If name is provided, check screenshot with name; otherwise, check with options only
              if (screenshotName !== undefined) {
                assertionResult = await assertion.toHaveScreenshot(screenshotName, finalOptions);
                result.actual = `screenshot "${Array.isArray(screenshotName) ? screenshotName.join(', ') : screenshotName}"`;
              } else {
                assertionResult = await assertion.toHaveScreenshot(finalOptions);
                result.actual = 'screenshot (with options)';
              }
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;


            case 'toHaveAccessibleDescription':
              if (!args || args.assertionType !== 'toHaveAccessibleDescription')
                throw new Error('toHaveAccessibleDescription requires proper arguments structure');

              const { description } = mainArgs;
              if (!description)
                throw new Error('toHaveAccessibleDescription requires "description" argument');

              assertionResult = await assertion.toHaveAccessibleDescription(description, finalOptions);
              result.actual = `accessible description "${description}"`;
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toHaveAccessibleErrorMessage':
              if (!args || args.assertionType !== 'toHaveAccessibleErrorMessage')
                throw new Error('toHaveAccessibleErrorMessage requires proper arguments structure');

              const { errorMessage } = mainArgs;
              if (!errorMessage)
                throw new Error('toHaveAccessibleErrorMessage requires "errorMessage" argument (string or RegExp)');

              assertionResult = await assertion.toHaveAccessibleErrorMessage(errorMessage, finalOptions);
              result.actual = `accessible error message "${errorMessage}"`;
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toHaveAccessibleName':
              if (!args || args.assertionType !== 'toHaveAccessibleName')
                throw new Error('toHaveAccessibleName requires proper arguments structure');

              const { name: accessibleName } = mainArgs;
              if (!accessibleName)
                throw new Error('toHaveAccessibleName requires "name" argument (string or RegExp)');

              assertionResult = await assertion.toHaveAccessibleName(accessibleName, finalOptions);
              result.actual = `accessible name "${accessibleName}"`;
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            default:
              throw new Error(`Unsupported assertion: ${name}`);
          }

          result.result = 'pass';
          console.log(`validate_dom_assertions: ${name}${negate ? ' (negated)' : ''} passed for element "${element}"`);

        } catch (error) {
          console.error('error in validate_dom_assertions', error);

          // Handle assertion errors - set result and evidence
          result.result = 'fail';
          result.error = error instanceof Error ? error.message : String(error);

          // Check if error indicates specific element issues (not found, multiple elements, etc.)
          const elementErrorMessage = getElementErrorMessage(error, element);
          const evidenceMessage = elementErrorMessage || getAssertionMessage(name, element, negate);
          locatorString = await generateLocatorString(ref, locator);
          result.evidence = { message: evidenceMessage, command: createEvidenceCommand(locatorString) };

        }

        results.push(result);
      }

      // Calculate summary
      const passedCount = results.filter(r => r.result === 'pass').length;
      const failedCount = results.length - passedCount;

      // Collect evidence from all results
      const evidence: {message: string, command: string}[] = [];
      for (const result of results) {
        if (result.evidence)
          evidence.push(result.evidence);

      }

      // Generate payload
      const payload = {
        ref,
        element,
        summary: {
          total: results.length,
          passed: passedCount,
          failed: failedCount,
          status: passedCount === results.length ? 'pass' : 'fail',
          evidence,
        },
        checks: results,
      };

      console.log('Validate DOM Assertions:');
      console.log(payload);
      response.addResult(JSON.stringify(payload, null, 2));
    });
  },
});
