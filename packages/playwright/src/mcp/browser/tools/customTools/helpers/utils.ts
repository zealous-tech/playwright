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
/* eslint-disable eqeqeq */
import { CurlResponse } from '../common/common';

const camelToKebab = (prop: string) =>
  prop.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`);

function pickActualValue(
  all: Record<string, string>,
  name: string
): string | undefined {
  if (name in all)
    return all[name];
  const kebab = camelToKebab(name);
  if (kebab in all)
    return all[kebab];
  const trimmed = name.trim();
  if (trimmed in all)
    return all[trimmed];
  const trimmedKebab = camelToKebab(trimmed);
  if (trimmedKebab in all)
    return all[trimmedKebab];
  return undefined;
}

// Function to parse RGB color values from various CSS color formats
function parseRGBColor(colorValue: string): { r: number; g: number; b: number } | null {
  if (!colorValue)
    return null;

  // Handle rgb(r, g, b) format
  const rgbMatch = colorValue.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1]),
      g: parseInt(rgbMatch[2]),
      b: parseInt(rgbMatch[3])
    };
  }

  // Handle rgba(r, g, b, a) format (ignore alpha)
  const rgbaMatch = colorValue.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*[\d.]+\)/);
  if (rgbaMatch) {
    return {
      r: parseInt(rgbaMatch[1]),
      g: parseInt(rgbaMatch[2]),
      b: parseInt(rgbaMatch[3])
    };
  }

  // Handle hex colors (#RRGGBB or #RGB)
  const hexMatch = colorValue.match(/#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})/);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3) {
      // #RGB format
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16)
      };
    } else {
      // #RRGGBB format
      return {
        r: parseInt(hex.substring(0, 2), 16),
        g: parseInt(hex.substring(2, 4), 16),
        b: parseInt(hex.substring(4, 6), 16)
      };
    }
  }

  // Handle named colors (basic support)
  const namedColors: Record<string, { r: number; g: number; b: number }> = {
    'red': { r: 255, g: 0, b: 0 },
    'green': { r: 0, g: 128, b: 0 },
    'blue': { r: 0, g: 0, b: 255 },
    'black': { r: 0, g: 0, b: 0 },
    'white': { r: 255, g: 255, b: 255 },
    'gray': { r: 128, g: 128, b: 128 },
    'grey': { r: 128, g: 128, b: 128 },
    'yellow': { r: 255, g: 255, b: 0 },
    'cyan': { r: 0, g: 255, b: 255 },
    'magenta': { r: 255, g: 0, b: 255 },
    'orange': { r: 255, g: 165, b: 0 },
    'purple': { r: 128, g: 0, b: 128 },
    'pink': { r: 255, g: 192, b: 203 },
    'brown': { r: 165, g: 42, b: 42 },
    'darkred': { r: 139, g: 0, b: 0 },
    'lightblue': { r: 173, g: 216, b: 230 },
    'darkblue': { r: 0, g: 0, b: 139 },
    'lightgreen': { r: 144, g: 238, b: 144 },
    'darkgreen': { r: 0, g: 100, b: 0 }
  };

  const lowerColor = colorValue.toLowerCase().trim();
  if (namedColors[lowerColor])
    return namedColors[lowerColor];


  return null;
}

// Function to check if RGB color is within specified range
function isColorInRange(actualColor: string, range: { minR: number; maxR: number; minG: number; maxG: number; minB: number; maxB: number }): boolean {
  const rgb = parseRGBColor(actualColor);
  if (!rgb)
    return false;

  return rgb.r >= range.minR && rgb.r <= range.maxR &&
           rgb.g >= range.minG && rgb.g <= range.maxG &&
           rgb.b >= range.minB && rgb.b <= range.maxB;
}

function compareValues(actual: any, expected: any, operator: string) {
  switch (operator) {
    case 'equals':
      // Convert both to same type for comparison
      if (typeof actual === 'number' && typeof expected === 'string')
        return { passed: actual === Number(expected), actual };
      else if (typeof actual === 'string' && typeof expected === 'number')
        return { passed: Number(actual) === expected, actual };
      else
        return { passed: actual === expected, actual };

    case 'not_equals':
      if (typeof actual === 'number' && typeof expected === 'string')
        return { passed: actual !== Number(expected), actual };
      else if (typeof actual === 'string' && typeof expected === 'number')
        return { passed: Number(actual) !== expected, actual };
      else
        return { passed: actual !== expected, actual };

    case 'contains':
      return { passed: String(actual).includes(String(expected)), actual };
    case 'not_contains':
      return { passed: !String(actual).includes(String(expected)), actual };
    case 'greater_than':
      return { passed: Number(actual) > Number(expected), actual };
    case 'less_than':
      return { passed: Number(actual) < Number(expected), actual };
    case 'hasValue':
      // Check if value exists (not null, undefined, or empty string)
      const hasValue = actual !== null && actual !== undefined && actual !== '';
      return { passed: hasValue === expected, actual: hasValue };
    default:
      return { passed: false, actual: `Unknown operator: ${operator}` };
  }
}

function convertToValidJson(str: string): string {
  // Simple approach: replace single quotes with double quotes
  // This works for most cases but may not handle all edge cases
  let result = str;

  // Replace single quotes with double quotes, but be careful about escaped quotes
  result = result.replace(/'/g, '"');
  return result;
}

function parseCurlStderr(stderr: string): Partial<CurlResponse> {
  const result: Partial<CurlResponse> = {};

  const statusMatch = stderr.match(/< HTTP\/\d+(?:\.\d+)?\s+(\d+)/);
  if (statusMatch)
    result.statusCode = parseInt(statusMatch[1], 10);


  const contentTypeMatch = stderr.match(/< Content-Type: ([^\r\n]+)/);
  if (contentTypeMatch)
    result.contentType = contentTypeMatch[1].trim();


  const contentLengthMatch = stderr.match(/< Content-Length: (\d+)/);
  if (contentLengthMatch)
    result.contentLength = parseInt(contentLengthMatch[1], 10);

  const serverMatch = stderr.match(/< Server: ([^\r\n]+)/);
  if (serverMatch)
    result.server = serverMatch[1].trim();

  const connectionMatch = stderr.match(/< Connection: ([^\r\n]+)/);
  if (connectionMatch)
    result.connection = connectionMatch[1].trim();

  const dateMatch = stderr.match(/< Date: ([^\r\n]+)/);
  if (dateMatch)
    result.date = dateMatch[1].trim();

  const etagMatch = stderr.match(/< ETag: ([^\r\n]+)/);
  if (etagMatch)
    result.etag = etagMatch[1].trim();

  const xPoweredByMatch = stderr.match(/< X-Powered-By: ([^\r\n]+)/);
  if (xPoweredByMatch)
    result.xPoweredBy = xPoweredByMatch[1].trim();

  const timeMatch = stderr.match(/(\d+\.\d+) secs/);
  if (timeMatch)
    result.responseTime = parseFloat(timeMatch[1]);


  if (stderr.includes('curl:') || stderr.includes('error:')) {
    const errorMatch = stderr.match(/curl: \(\d+\) ([^\r\n]+)/);
    if (errorMatch)
      result.error = errorMatch[1].trim();

  }

  return result;
}

function applyArrayFilter(arr: any[], filter: string): any {
  if (!Array.isArray(arr))
    return undefined;


  // Parse filter like "?(@.isbn=='9781449325862')"
  const match = filter.match(/\?\(@\.([^=!<>]+)([=!<>]+)(.+)\)/);
  if (!match)
    return undefined;


  const [, field, operator, value] = match;
  let cleanValue: any = value.replace(/^['"]|['"]$/g, ''); // Remove quotes

  // Handle boolean values
  if (cleanValue === 'true')
    cleanValue = true;
  else if (cleanValue === 'false')
    cleanValue = false;
  else if (cleanValue === 'null')
    cleanValue = null;


  // Find matching items
  const results = arr.filter(item => {
    if (typeof item !== 'object' || item === null)
      return false;


    const itemValue = item[field];

    switch (operator) {
      case '==':
        return itemValue == cleanValue;
      case '!=':
        return itemValue != cleanValue;
      case '===':
        return itemValue === cleanValue;
      case '!==':
        return itemValue !== cleanValue;
      case '>':
        return Number(itemValue) > Number(cleanValue);
      case '<':
        return Number(itemValue) < Number(cleanValue);
      case '>=':
        return Number(itemValue) >= Number(cleanValue);
      case '<=':
        return Number(itemValue) <= Number(cleanValue);
      default:
        return false;
    }
  });

  // Return first match, or all matches if multiple
  return results.length === 1 ? results[0] : results;
}

function getElementErrorMessage(err: any, elementDescription: string): string | null {
  if (!err)
    return null;

  // Get error message from multiple possible locations
  let errorMessage = '';
  if (err.message)
    errorMessage = err.message;
  else if (err.matcherResult && err.matcherResult.message)
    errorMessage = err.matcherResult.message;
  else
    errorMessage = String(err);

  const errorMessageLower = errorMessage.toLowerCase();

  // Check for "element not found" patterns
  const notFoundPatterns = [
    'element(s) not found',
    'element not found',
    'locator not found',
    'resolved to 0 elements',
    'resolved to no elements',
    'no elements found',
    'ui element not found',
    'target closed',
    'page closed',
    'navigation failed'
  ];

  if (notFoundPatterns.some(pattern => errorMessageLower.includes(pattern)))
    return `The UI Element "${elementDescription}" not found`;

  // Check for "strict mode violation" - multiple elements found
  if (errorMessageLower.includes('strict mode violation') &&
      /resolved to \d+ elements?/i.test(errorMessage))
    return `Multiple UI elements were found for this locator`;

  return null;
}

// Function to generate assertion messages with element description
function getAssertionMessage(assertionType: string, elementDescription: string, negate: boolean = false): string {
  const positiveMessages: Record<string, string> = {
    toBeEnabled: `'${elementDescription}' is disabled (should be enabled).`,
    toBeDisabled: `'${elementDescription}' is enabled (should be disabled).`,
    toBeVisible: `'${elementDescription}' is hidden (should be visible).`,
    toBeHidden: `'${elementDescription}' is visible (should be hidden).`,
    toBeInViewport: `'${elementDescription}' is outside viewport (should be in viewport).`,
    toBeChecked: `'${elementDescription}' is unchecked (should be checked).`,
    toBeFocused: `'${elementDescription}' is not focused (should be focused).`,
    toBeEditable: `'${elementDescription}' is read-only (should be editable).`,
    toBeEmpty: `'${elementDescription}' contains content (should be empty).`,
    toBeAttached: `'${elementDescription}' is detached from DOM (should be attached).`,
    toHaveAttribute: `'${elementDescription}' is missing attribute or has different attribute value (attribute required).`,
    toHaveText: `'${elementDescription}' has different text (exact text match required).`,
    toContainText: `'${elementDescription}' does not contain expected text (text should be present).`,
    toHaveValue: `'${elementDescription}' has different value (specific value required).`,
    toHaveValues: `'${elementDescription}' has different values (specific values required).`,
    selectHasValue: `'${elementDescription}' has different selection (specific value should be selected).`,
    toMatchAriaSnapshot: `'${elementDescription}' has different ARIA structure (should match snapshot).`,
    toMatchAriaSnapshotOptions: `'${elementDescription}' has different ARIA structure (should match snapshot with options).`,
    toContainClass: `'${elementDescription}' is missing class (class should be present).`,
    toHaveClass: `'${elementDescription}' has different classes (exact class match required).`,
    toHaveCount: `The number of '${elementDescription}' does not equal the expected value.`,
    toHaveCSS: `'${elementDescription}' has different CSS property value (specific value required).`,
    toHaveId: `'${elementDescription}' has different id (specific id required).`,
    toHaveJSProperty: `'${elementDescription}' has different JS property value (specific value required).`,
    toHaveRole: `'${elementDescription}' has different role (specific role required).`,
    toHaveScreenshot: `'${elementDescription}' has visual differences (should match screenshot).`,
    toHaveAccessibleDescription: `'${elementDescription}' is missing accessible description or differs (description required).`,
    toHaveAccessibleErrorMessage: `'${elementDescription}' is missing accessible error message or differs (message required).`,
    toHaveAccessibleName: `'${elementDescription}' is missing accessible name or differs (name required).`,
  };

  const negativeMessages: Record<string, string> = {
    toBeEnabled: `'${elementDescription}' is enabled (should be disabled).`,
    toBeDisabled: `'${elementDescription}' is disabled (should be enabled).`,
    toBeVisible: `'${elementDescription}' is visible (should be hidden).`,
    toBeHidden: `'${elementDescription}' is hidden (should be visible).`,
    toBeInViewport: `'${elementDescription}' is in viewport (should be outside viewport).`,
    toBeChecked: `'${elementDescription}' is checked (should be unchecked).`,
    toBeFocused: `'${elementDescription}' has focus (should not be focused).`,
    toBeEditable: `'${elementDescription}' is editable (should be read-only).`,
    toBeEmpty: `'${elementDescription}' is empty (should have content).`,
    toBeAttached: `'${elementDescription}' is attached to DOM (should be detached)`,
    toHaveAttribute: `'${elementDescription}' has the attribute or matching attribute value (should not have it or should have different value).`,
    toHaveText: `'${elementDescription}' has matching text (should have different text).`,
    toContainText: `'${elementDescription}' contains the text (should not contain it).`,
    toHaveValue: `'${elementDescription}' has matching value (should have different value).`,
    toHaveValues: `'${elementDescription}' has matching values (should have different values).`,
    selectHasValue: `'${elementDescription}' has matching selection (should have different selection).`,
    toMatchAriaSnapshot: `'${elementDescription}' matches ARIA structure (should have different structure).`,
    toMatchAriaSnapshotOptions: `'${elementDescription}' matches ARIA structure with options (should have different structure).`,
    toContainClass: `'${elementDescription}' has the class (should not have it).`,
    toHaveClass: `'${elementDescription}' has matching classes (should have different classes).`,
    toHaveCount: `The number of '${elementDescription}' equals the expected value, but it should be different.`,
    toHaveCSS: `'${elementDescription}' has matching CSS property value (should have different value).`,
    toHaveId: `'${elementDescription}' has matching id (should have different id).`,
    toHaveJSProperty: `'${elementDescription}' has matching JS property value (should have different value).`,
    toHaveRole: `'${elementDescription}' has matching role (should have different role).`,
    toHaveScreenshot: `'${elementDescription}' matches screenshot (should look different).`,
    toHaveAccessibleDescription: `'${elementDescription}' has accessible description (should not have it).`,
    toHaveAccessibleErrorMessage: `'${elementDescription}' has accessible error message (should not have it).`,
    toHaveAccessibleName: `'${elementDescription}' has accessible name (should not have it).`,
  };

  const messages = negate ? negativeMessages : positiveMessages;
  return messages[assertionType] || `${elementDescription} assertion ${negate ? 'should not' : 'should'} failed`;
}

/**
 * Get XPath code as string for use in evaluate()
 * Returns a string that can be evaluated in browser context
 */
function getXPathCode(): string {
  return `
    function getXPath(element) {
      if (element.id !== '') {
        return '//*[@id="' + element.id + '"]';
      }
      if (element === document.body) {
        return '/html/body';
      }
      let ix = 0;
      const siblings = element.parentNode ? Array.from(element.parentNode.children) : [];
      for (let i = 0; i < siblings.length; i++) {
        const sibling = siblings[i];
        if (sibling === element) {
          return getXPath(element.parentNode) + '/' + element.tagName.toLowerCase() + '[' + (ix + 1) + ']';
        }
        if (sibling.nodeType === 1 && sibling.tagName === element.tagName) {
          ix++;
        }
      }
      return '';
    }
    return getXPath(element);
  `.trim();
}

/**
 * Parse data input - handles string JSON or raw data
 */
function parseDataInput(data: any): any {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      return data; // Keep as-is if not valid JSON
    }
  }
  return data;
}

/**
 * Execute JavaScript validation code on data (for data mode)
 */
function executeDataValidation(code: string, inputData: any): any {
  try {
    const func = new Function('data', `
      'use strict';
      ${code}
    `);
    return func(inputData);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      type: 'execution_error'
    };
  }
}

export {
  pickActualValue,
  parseRGBColor,
  isColorInRange,
  compareValues,
  convertToValidJson,
  applyArrayFilter,
  parseCurlStderr,
  getElementErrorMessage,
  getAssertionMessage,
  getXPathCode,
  parseDataInput,
  executeDataValidation,
};
