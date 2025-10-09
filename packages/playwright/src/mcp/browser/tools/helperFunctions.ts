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
import { execFile } from 'child_process';
import { promisify } from 'util';
import type * as playwright from 'playwright';
import { expect } from '@zealous-tech/playwright/test';
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

async function getAllComputedStylesDirect(
  tab: any,
  ref: string,
  element: string
): Promise<Record<string, string>> {
  const locator = await tab.refLocator({ ref, element });

  const allStyles: Record<string, string> = await locator.evaluate(
      (el: Element) => {
        const cs = window.getComputedStyle(el);
        const out: Record<string, string> = {};
        for (let i = 0; i < cs.length; i++) {
          const name = cs[i]; // kebab-case
          out[name] = cs.getPropertyValue(name);
        }
        return out;
      }
  );

  return allStyles;
}


async function getAllDomPropsDirect(tab: any, ref: string, element: string) {
  const locator = await tab.refLocator({ ref, element });
  const props = await locator.evaluate((el: Element) => {
    if (!el)
      return {};

    const out: Record<string, any> = {};

    // 1. Own element properties (primitives) - EXCLUDING textContent, value
    for (const key of Object.keys(el)) {
      try {
        const val = (el as any)[key];
        // Exclude properties that are collected by other tools
        if (['string', 'number', 'boolean'].includes(typeof val) || val === null) {
          // Exclude intersections with validate_element_text
          if (!['textContent', 'value'].includes(key))
            out[key] = val;

        }
      } catch (_) {
        // skip getters with errors
      }
    }

    // 2. HTML attributes - EXCLUDING text attributes
    if (el.getAttributeNames) {
      el.getAttributeNames().forEach((attr: string) => {
        // Exclude attributes that are collected by validate_element_text
        const textAttributes = ['placeholder', 'defaultValue', 'aria-label', 'title', 'alt'];
        if (!textAttributes.includes(attr)) {
          // Add attributes directly without attr: prefix
          out[attr] = el.getAttribute(attr);
        }
      });
    }

    // 3. Special cases
    if (el.hasAttribute('disabled'))
      out['disabled'] = true;
    else if ((el as any).disabled !== undefined)
      out['disabled'] = (el as any).disabled;

    if (el.hasAttribute('checked'))
      out['checked'] = true;
    else if ((el as any).checked !== undefined)
      out['checked'] = (el as any).checked;


    // 4. Size and positioning
    const rect = el.getBoundingClientRect();
    out['boundingRect'] = {
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      x: rect.x,
      y: rect.y
    };

    out['offsetTop'] = (el as any).offsetTop;
    out['offsetLeft'] = (el as any).offsetLeft;
    out['offsetWidth'] = (el as any).offsetWidth;
    out['offsetHeight'] = (el as any).offsetHeight;
    out['clientTop'] = (el as any).clientTop;
    out['clientLeft'] = (el as any).clientLeft;
    out['clientWidth'] = (el as any).clientWidth;
    out['clientHeight'] = (el as any).clientHeight;
    out['scrollTop'] = (el as any).scrollTop;
    out['scrollLeft'] = (el as any).scrollLeft;
    out['scrollWidth'] = (el as any).scrollWidth;
    out['scrollHeight'] = (el as any).scrollHeight;

    // 5. Visibility state (EXCLUDING CSS styles - this is validate_computed_styles)
    out['isVisible'] = (el as any).offsetWidth > 0 && (el as any).offsetHeight > 0;

    // 6. Form and element state (EXCLUDING value)
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) {
      out['form'] = (el as any).form?.id || (el as any).form?.name || null;
      out['name'] = (el as any).name;
      out['type'] = (el as any).type;
      out['required'] = (el as any).required;
      out['readOnly'] = (el as any).readOnly;
      out['validity'] = {
        valid: (el as any).validity?.valid,
        valueMissing: (el as any).validity?.valueMissing,
        typeMismatch: (el as any).validity?.typeMismatch,
        patternMismatch: (el as any).validity?.patternMismatch,
        tooLong: (el as any).validity?.tooLong,
        tooShort: (el as any).validity?.tooShort,
        rangeUnderflow: (el as any).validity?.rangeUnderflow,
        rangeOverflow: (el as any).validity?.rangeOverflow,
        stepMismatch: (el as any).validity?.stepMismatch,
        badInput: (el as any).validity?.badInput,
        customError: (el as any).validity?.customError
      };
    }

    // 7. Accessibility properties (EXCLUDING aria-label, title - this is validate_element_text)
    out['ariaDescribedBy'] = el.getAttribute('aria-describedby');
    out['ariaLabelledBy'] = el.getAttribute('aria-labelledby');
    out['ariaExpanded'] = el.getAttribute('aria-expanded');
    out['ariaHidden'] = el.getAttribute('aria-hidden');
    out['ariaSelected'] = el.getAttribute('aria-selected');
    out['ariaChecked'] = el.getAttribute('aria-checked');
    out['ariaDisabled'] = el.getAttribute('aria-disabled');
    out['ariaRequired'] = el.getAttribute('aria-required');
    out['ariaInvalid'] = el.getAttribute('aria-invalid');
    out['role'] = el.getAttribute('role');
    out['tabIndex'] = (el as any).tabIndex;

    // 8. Events and interaction
    out['contentEditable'] = (el as any).contentEditable;
    out['draggable'] = (el as any).draggable;
    out['spellcheck'] = (el as any).spellcheck;
    out['isContentEditable'] = (el as any).isContentEditable;
    out['accessKey'] = (el as any).accessKey;

    // 8.1. Clickability check
    out['isClickable'] = (() => {
      // Check if element is disabled
      if (el.hasAttribute('disabled') || (el as any).disabled === true) {
        return false;
      }

      // Check if element is hidden via CSS
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
      }

      // Check if element has zero dimensions
      if ((el as any).offsetWidth === 0 || (el as any).offsetHeight === 0) {
        return false;
      }

      // Check if element is covered by another element
      const rect = el.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const elementAtPoint = document.elementFromPoint(centerX, centerY);
      
      // If the element at the center point is not this element or its child, it's covered
      if (elementAtPoint && !el.contains(elementAtPoint) && elementAtPoint !== el) {
        return false;
      }

      // Check if element has pointer-events: none
      if (style.pointerEvents === 'none') {
        return false;
      }

      // Check if element is in a form that's disabled
      if ((el as any).form && (el as any).form.disabled) {
        return false;
      }

      // Check if element is a button, link, or has click handlers
      const isInteractiveElement = ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) ||
                                  el.getAttribute('role') === 'button' ||
                                  !!el.getAttribute('onclick') ||
                                  !!el.getAttribute('data-testid') ||
                                  !!el.getAttribute('data-cy') ||
                                  !!el.getAttribute('data-test') ||
                                  el.classList.contains('clickable') ||
                                  el.classList.contains('btn') ||
                                  el.classList.contains('button');

      // Check if element has event listeners (this is a best-effort check)
      const hasClickListeners = (el as any).onclick !== null ||
                               (el as any).addEventListener !== undefined;

      return isInteractiveElement || hasClickListeners || el.tagName === 'DIV' || el.tagName === 'SPAN';
    })();

    // 9. Element metadata
    out['tagName'] = el.tagName;
    out['nodeName'] = el.nodeName;
    out['nodeType'] = el.nodeType;
    out['namespaceURI'] = el.namespaceURI;
    out['localName'] = el.localName;
    out['prefix'] = el.prefix;
    out['baseURI'] = el.baseURI;
    out['ownerDocument'] = el.ownerDocument?.URL || null;

    // 10. Parent-child relationships
    out['parentElement'] = el.parentElement?.tagName || null;
    out['parentElementId'] = el.parentElement?.id || null;
    out['parentElementClass'] = el.parentElement?.className || null;
    out['childElementCount'] = el.childElementCount;
    out['firstElementChild'] = el.firstElementChild?.tagName || null;
    out['lastElementChild'] = el.lastElementChild?.tagName || null;
    out['nextElementSibling'] = el.nextElementSibling?.tagName || null;
    out['previousElementSibling'] = el.previousElementSibling?.tagName || null;

    // 11. Special properties for different element types
    if (el.tagName === 'IMG') {
      out['naturalWidth'] = (el as any).naturalWidth;
      out['naturalHeight'] = (el as any).naturalHeight;
      out['complete'] = (el as any).complete;
      // Exclude alt - this is validate_element_text
    }

    if (el.tagName === 'A') {
      out['href'] = (el as any).href;
      out['target'] = (el as any).target;
      out['rel'] = (el as any).rel;
      out['download'] = (el as any).download;
    }

    if (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') {
      out['duration'] = (el as any).duration;
      out['currentTime'] = (el as any).currentTime;
      out['paused'] = (el as any).paused;
      out['ended'] = (el as any).ended;
      out['muted'] = (el as any).muted;
      out['volume'] = (el as any).volume;
      out['playbackRate'] = (el as any).playbackRate;
    }

    // 12. CSS classes (EXCLUDING computed styles - this is validate_computed_styles)
    out['className'] = el.className;
    out['classList'] = Array.from(el.classList);
    // Exclude style - this is validate_computed_styles

    // 13. Data attributes
    const dataAttrs: Record<string, string> = {};
    el.getAttributeNames().forEach(attr => {
      if (attr.startsWith('data-'))
        dataAttrs[attr] = el.getAttribute(attr) || '';

    });
    if (Object.keys(dataAttrs).length > 0)
      out['dataAttributes'] = dataAttrs;


    return out;
  });

  return props ?? {};
}


// Function to check if alert dialog is present in snapshot
function hasAlertDialog(snapshotContent: string): boolean {
  // Check for dialog information in the snapshot
  const hasModalState = snapshotContent.includes('### Modal state');
  const hasDialogMessage = snapshotContent.includes('dialog with message');
  const hasNoModalState = snapshotContent.includes('There is no modal state present');

  console.log('hasModalState:', hasModalState);
  console.log('hasDialogMessage:', hasDialogMessage);
  console.log('hasNoModalState:', hasNoModalState);

  return hasModalState && hasDialogMessage && !hasNoModalState;
}

// Function to extract alert dialog text from snapshot
function getAlertDialogText(snapshotContent: string): string | null {
  if (!hasAlertDialog(snapshotContent))
    return null;


  // Look for dialog message pattern: "dialog with message "text""
  const dialogMatch = snapshotContent.match(/dialog with message "([^"]+)"/);
  if (dialogMatch)
    return dialogMatch[1];


  return null;
}

// Helper function to perform regex-based checks
function performRegexCheck(responseData: string, check: any) {
  try {
    switch (check.type) {
      case 'regex_extract':
        return performRegexExtract(responseData, check);

      case 'regex_match':
        return performRegexMatch(responseData, check);


      default:
        return { passed: false, actual: 'Unknown check type' };
    }
  } catch (error) {
    return { passed: false, actual: `Error: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function performRegexExtract(responseData: string, check: any) {
  const regex = new RegExp(check.pattern, 'i');
  const match = responseData.match(regex);

  if (!match)
    return { passed: false, actual: 'Pattern not found' };


  const extractedValue = match[check.extractGroup || 1];
  if (extractedValue === undefined)
    return { passed: false, actual: `Capture group ${check.extractGroup || 1} not found` };


  // If no expected value, just return success
  if (check.expected === undefined)
    return { passed: true, actual: extractedValue };


  // Compare extracted value with expected
  return compareValues(extractedValue, check.expected, check.operator);
}

function performRegexMatch(responseData: string, check: any) {
  const regex = new RegExp(check.pattern, 'i');
  const isMatch = regex.test(responseData);

  // For regex_match, just return the test result
  return { passed: isMatch, actual: isMatch ? 'Pattern matched' : 'Pattern not matched' };
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

// Recursive function to search for text in all frames (including nested iframes)
async function searchTextInAllFrames(
  page: any,
  text: string,
  matchType: 'exact' | 'contains' | 'not-contains' = 'contains',
  framePath: string = 'main'
): Promise<Array<{element: any, context: string}>> {
  const results: Array<{element: any, context: string}> = [];

  try {
    // Search in current frame with appropriate options based on matchType
    let locator;
    if (matchType === 'exact') {
      locator = page.getByText(text, { exact: true }).filter({ visible: true });
    } else {
      // For "contains" and "not-contains", use default substring matching
      locator = page.getByText(text).filter({ visible: true });
    }

    const count = await locator.count();
    console.log(`searchInAllFrames: Found ${count} visible elements with text "${text}" in ${framePath} (matchType: ${matchType})`);

    if (count > 0) {
      const elements = await locator.all();
      results.push(...elements.map((el: any) => ({ element: el, context: framePath })));
    }

    // Find all iframes in current frame
    const iframes = page.locator('iframe');
    const iframeCount = await iframes.count();

    // Search in each iframe recursively
    for (let i = 0; i < iframeCount; i++) {
      try {
        const iframePage = page.frameLocator(`iframe >> nth=${i}`);
        const nestedResults = await searchTextInAllFrames(iframePage, text, matchType, `${framePath} > iframe-${i + 1}`);
        results.push(...nestedResults);
      } catch (error) {
        console.log(`searchInAllFrames: Error searching in ${framePath} > iframe-${i + 1}:`, error);
      }
    }
  } catch (error) {
    console.log(`searchInAllFrames: Error searching in ${framePath}:`, error);
  }

  return results;
}

// Function to get text from element with comprehensive fallbacks
async function getElementTextWithFallbacks(
  locator: any,
  tab: any,
  elementDescription: string
): Promise<string> {
  let actualText = '';

  // First try: get text content
  actualText = (await locator.textContent() ?? '').trim();

  // If no text found, try fallback properties
  if (!actualText) {
    console.log(`Text content is empty for element ${elementDescription}, trying fallback properties...`);

    // Try input value first (works for input, textarea, select)
    try {
      actualText = await locator.inputValue();
    } catch (error) {
      // Not an input-like element, try other attributes
    }

    if (!actualText) {
      // Try placeholder
      const placeholder = await locator.getAttribute('placeholder');
      if (placeholder)
        actualText = placeholder;

    }

    if (!actualText) {
      // Try defaultValue
      const defaultValue = await locator.getAttribute('defaultValue');
      if (defaultValue)
        actualText = defaultValue;

    }

    if (!actualText) {
      // Try aria-label
      const ariaLabel = await locator.getAttribute('aria-label');
      if (ariaLabel)
        actualText = ariaLabel;

    }

    if (!actualText) {
      // Check for contenteditable
      const isContentEditable = await locator.getAttribute('contenteditable');
      if (isContentEditable === 'true')
        actualText = await locator.innerHTML();

    }

    if (!actualText) {
      // Try title attribute
      const title = await locator.getAttribute('title');
      if (title)
        actualText = title;

    }

    if (!actualText) {
      // Try alt attribute (for images)
      const alt = await locator.getAttribute('alt');
      if (alt)
        actualText = alt;

    }

    if (!actualText) {
      // Try value attribute (for elements with value)
      const value = await locator.getAttribute('value');
      if (value)
        actualText = value;

    }

    if (!actualText) {
      // Try data attributes (common patterns)
      const dataValue = await locator.getAttribute('data-value');
      if (dataValue)
        actualText = dataValue;

    }

    if (!actualText) {
      // Try aria-labelledby (references another element)
      const ariaLabelledBy = await locator.getAttribute('aria-labelledby');
      if (ariaLabelledBy) {
        try {
          // Try to find the referenced element
          const referencedElement = tab.page.locator(`#${ariaLabelledBy}`);
          if (await referencedElement.count() > 0)
            actualText = await referencedElement.textContent() ?? '';

        } catch (error) {
          // Ignore errors when trying to find referenced element
        }
      }
    }

    if (!actualText) {
      // Try aria-describedby (references another element)
      const ariaDescribedBy = await locator.getAttribute('aria-describedby');
      if (ariaDescribedBy) {
        try {
          // Try to find the referenced element
          const referencedElement = tab.page.locator(`#${ariaDescribedBy}`);
          if (await referencedElement.count() > 0)
            actualText = await referencedElement.textContent() ?? '';

        } catch (error) {
          // Ignore errors when trying to find referenced element
        }
      }
    }

    if (!actualText) {
      // Try option text for select elements
      try {
        const tagName = await locator.evaluate((el: Element) => el.tagName.toLowerCase());
        if (tagName === 'select') {
          const selectedOption = await locator.evaluate((el: HTMLSelectElement) => {
            const selectedIndex = el.selectedIndex;
            return selectedIndex >= 0 ? el.options[selectedIndex]?.textContent || '' : '';
          });
          if (selectedOption)
            actualText = selectedOption;

        }
      } catch (error) {
        // Not a select element or error occurred
      }
    }

    if (!actualText) {
      // Try innerText as fallback (includes visible text only)
      try {
        actualText = await locator.innerText();
      } catch (error) {
        // Element might not support innerText
      }
    }

    console.log(`Fallback result for ${elementDescription}: "${actualText}"`);
  }

  return actualText;
}

// Recursive function to search for elements by role in all frames (including nested iframes)
async function searchElementsByRoleInAllFrames(
  page: any,
  role: string,
  accessibleName: string,
  framePath: string = 'main'
): Promise<Array<{element: any, context: string}>> {
  const results: Array<{element: any, context: string}> = [];

  try {
    // Search in current frame
    const locator = page.getByRole(role as any, { name: accessibleName, exact: true });
    const count = await locator.count();
    console.log(`searchElementsByRoleInAllFrames: Found ${count} elements with role="${role}" and name="${accessibleName}" in ${framePath}`);

    if (count > 0) {
      const elements = await locator.all();
      results.push(...elements.map((el: any) => ({ element: el, context: framePath })));
    }

    // Find all iframes in current frame
    const iframes = page.locator('iframe');
    const iframeCount = await iframes.count();

    // Search in each iframe recursively
    for (let i = 0; i < iframeCount; i++) {
      try {
        const iframePage = page.frameLocator(`iframe >> nth=${i}`);
        const nestedResults = await searchElementsByRoleInAllFrames(iframePage, role, accessibleName, `${framePath} > iframe-${i + 1}`);
        results.push(...nestedResults);
      } catch (error) {
        console.log(`searchElementsByRoleInAllFrames: Error searching in ${framePath} > iframe-${i + 1}:`, error);
      }
    }
  } catch (error) {
    console.log(`searchElementsByRoleInAllFrames: Error searching in ${framePath}:`, error);
  }

  return results;
}

async function getFullXPath(tab: any, params: { element: string, ref: string }): Promise<Array<{selector: string; priority: number; type: string}>> {
  const locator = await tab.refLocator(params);

  // Generate full absolute XPath path like /html/body/div[2]/div/div/div/div[2]/div[2]/div[3]/button
  const fullXPath = await locator.evaluate((el: Element) => {
    const getXPath = (element: Element): string => {
      if (element.nodeType === Node.DOCUMENT_NODE)
        return '';


      if (element.nodeType === Node.ELEMENT_NODE) {
        const tagName = element.tagName.toLowerCase();

        // Count siblings with the same tag name
        let index = 1;
        let sibling = element.previousElementSibling;
        while (sibling) {
          if (sibling.tagName === element.tagName)
            index++;

          sibling = sibling.previousElementSibling;
        }

        // Build the path with index if there are multiple siblings with same tag
        const hasMultipleSiblings = element.nextElementSibling &&
          Array.from(element.parentElement?.children || [])
              .filter(child => child.tagName === element.tagName).length > 1;

        const indexPart = hasMultipleSiblings ? `[${index}]` : '';
        const currentPath = `/${tagName}${indexPart}`;

        // Recursively get parent path
        const parentPath = element.parentElement ? getXPath(element.parentElement) : '';

        return parentPath + currentPath;
      }

      return '';
    };

    return getXPath(el);
  });

  // Return in the same structure as getStableSelectors but with single element
  return [{
    selector: fullXPath,
    priority: 1,
    type: 'full-xpath'
  }];
}


function parseArguments(argsString: string): any[] {
  const args: any[] = [];
  let current = '';
  let depth = 0;
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < argsString.length; i++) {
    const char = argsString[i];
    const prevChar = i > 0 ? argsString[i - 1] : '';

    if (!inString) {
      if (char === '"' || char === "'") {
        inString = true;
        stringChar = char;
        current += char;
      } else if (char === '{' || char === '[') {
        depth++;
        current += char;
      } else if (char === '}' || char === ']') {
        depth--;
        current += char;
      } else if (char === ',' && depth === 0) {
        args.push(parseSingleArgument(current.trim()));
        current = '';
      } else {
        current += char;
      }
    } else {
      current += char;
      if (char === stringChar && prevChar !== '\\') {
        inString = false;
        stringChar = '';
      }
    }
  }

  if (current.trim())
    args.push(parseSingleArgument(current.trim()));


  return args;
}

function parseSingleArgument(arg: string): any {
  arg = arg.trim();
  //console.log(`Parsing single argument: "${arg}"`);

  // Handle string arguments first (both single and double quotes)
  if ((arg.startsWith("'") && arg.endsWith("'")) || (arg.startsWith('"') && arg.endsWith('"'))) {
    // String argument: 'Hello' or "Hello"
    const result = arg.slice(1, -1);
    //console.log(`Parsed as string: "${result}"`);
    return result;
  }

  // Handle boolean values
  if (arg === 'true')
    return true;
  else if (arg === 'false')
    return false;
  else if (arg === 'null')
    return null;


  // Handle numbers
  if (!isNaN(Number(arg)))
    return Number(arg);


  // Handle objects and arrays
  if (arg.startsWith('{') && arg.endsWith('}')) {
    // Object argument: { name: 'Submit' } - use eval for simple cases
    try {
      const result = eval(`(${arg})`);
      //console.log(`Parsed object with eval:`, result);
      return result;
    } catch (evalError) {
      // Fallback to JSON parsing
      const jsonString = convertToValidJson(arg);
      console.log(`Converted to JSON: "${jsonString}"`);
      return JSON.parse(jsonString);
    }
  } else if (arg.startsWith('[') && arg.endsWith(']')) {
    // Array argument: ['button', 'submit'] - use eval for simple cases
    try {
      const result = eval(`(${arg})`);
      //console.log(`Parsed array with eval:`, result);
      return result;
    } catch (evalError) {
      // Fallback to JSON parsing
      const jsonString = convertToValidJson(arg);
      console.log(`Converted to JSON: "${jsonString}"`);
      return JSON.parse(jsonString);
    }
  } else {
    // If all else fails, return as string
    console.log(`Parsed as fallback string: "${arg}"`);
    return arg;
  }
}

function convertToValidJson(str: string): string {
  // Simple approach: replace single quotes with double quotes
  // This works for most cases but may not handle all edge cases
  let result = str;

  // Replace single quotes with double quotes, but be careful about escaped quotes
  result = result.replace(/'/g, '"');

  console.log(`convertToValidJson: "${str}" -> "${result}"`);
  return result;
}

function parseMethodChain(methodChain: string): Array<{ method: string, args: any[] }> {
  const methods: Array<{ method: string, args: any[] }> = [];

  // Split by dots, but be careful about dots inside parentheses
  let current = '';
  let depth = 0;
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < methodChain.length; i++) {
    const char = methodChain[i];
    const prevChar = i > 0 ? methodChain[i - 1] : '';

    if (!inString) {
      if (char === '"' || char === "'") {
        inString = true;
        stringChar = char;
        current += char;
      } else if (char === '(') {
        depth++;
        current += char;
      } else if (char === ')') {
        depth--;
        current += char;
      } else if (char === '.' && depth === 0) {
        if (current.trim())
          methods.push(parseMethodCall(current.trim()));

        current = '';
      } else if (char === ')' && depth === 0 && current.trim().endsWith('(')) {
        // Handle methods without arguments like first()
        current += char;
        if (current.trim())
          methods.push(parseMethodCall(current.trim()));

        current = '';
      } else {
        current += char;
      }
    } else {
      current += char;
      if (char === stringChar && prevChar !== '\\') {
        inString = false;
        stringChar = '';
      }
    }
  }

  if (current.trim())
    methods.push(parseMethodCall(current.trim()));


  return methods;
}

function parseMethodCall(methodCall: string): { method: string, args: any[] } {
  // Match method name and arguments: methodName(args)
  const match = methodCall.match(/^(\w+)\((.+)\)$/);
  if (!match) {
    // Method without arguments - check if it ends with ()
    const noArgsMatch = methodCall.match(/^(\w+)\(\)$/);
    if (noArgsMatch) {
      const [, methodName] = noArgsMatch;
      return { method: methodName, args: [] };
    }
    // Method without parentheses (like 'first' instead of 'first()')
    return { method: methodCall, args: [] };
  }

  const [, methodName, argsString] = match;
  const args = parseArguments(argsString);

  return { method: methodName, args };
}

function applyLocatorMethod(locator: playwright.Locator, methodInfo: { method: string, args: any[] }): playwright.Locator {
  const { method, args } = methodInfo;

  // Check if method exists on locator
  if (typeof (locator as any)[method] !== 'function')
    throw new Error(`Unknown locator method: ${method}`);


  try {
    const methodFunc = (locator as any)[method] as Function;
    return methodFunc.apply(locator, args);
  } catch (error) {
    throw new Error(`Failed to apply locator method ${method}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

interface CurlResponse {
  stdout: string;
  stderr: string;
  statusCode?: number;
  responseTime?: number;
  contentLength?: number;
  contentType?: string;
  server?: string;
  error?: string;
}

interface ParsedCurlResponse {
  data: string | object;
  statusCode?: number;
  responseTime?: number;
  contentLength?: number;
  contentType?: string;
  server?: string;
  error?: string;
  rawStderr?: string;
}

function parseCurlStderr(stderr: string): Partial<CurlResponse> {
  const result: Partial<CurlResponse> = {};

  const statusMatch = stderr.match(/< HTTP\/\d\.\d (\d+)/);
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

export async function runCommand(command: string): Promise<{ stdout: string; stderr: string }> {
  const CURL_PATTERN = /curl```([\s\S]*?)```/i;
  const execFileAsync = promisify(execFile);

  const SHELL_META = /[|&;><`]/;

  const ALLOWED_FLAGS = new Set<string>([
    '-X', '--request',
    '-H', '--header',
    '-I', '--head',
    '-s', '--silent', '--no-progress-meter',
    '--compressed',
    '-L', '--location',
    '--max-time', '--connect-timeout',
    '--http1.1', '--http2',
    '-d', '--data', '--data-raw', '--data-binary', '--data-urlencode',
    '-v', '--verbose',
  ]);

  const FORBIDDEN_FLAGS = new Set<string>([
    '-K', '--config',
    '-o', '--output', '-O', '--remote-name',
    '--write-out', '--dump-header',
    '--trace', '--trace-ascii', '--trace-time',
    '-T', '--upload-file',
    '-u', '--user',
    '--proto', '--proto-redir', '--interface', '--proxy',
    '--help', '--manual'
  ]);

  function tokenize(input: string): string[] {
    const out: string[] = [];
    let cur = '';
    let inToken = false;                  // NEW: tracks whether an arg has started
    let quote: "'" | '"' | null = null;

    for (let i = 0; i < input.length; i++) {
      const c = input[i];

      if (quote) {
        if (c === quote) {                // closing quote — don't flush yet
          quote = null;
        } else if (c === '\\' && quote === '"' && i + 1 < input.length) {
          i++; cur += input[i];           // allow \" inside double quotes
          inToken = true;
        } else {
          cur += c;
          inToken = true;
        }
        continue;
      }

      if (c === "'" || c === '"') {       // opening quote starts a token, even if empty
        quote = c as "'" | '"';
        inToken = true;
        continue;
      }

      if (c === '\\' && i + 1 < input.length) {
        i++; cur += input[i];
        inToken = true;
        continue;
      }

      if (/\s/.test(c)) {                 // on whitespace, flush if a token was started
        if (inToken) { out.push(cur); cur = ''; inToken = false; }
        continue;
      }

      cur += c;
      inToken = true;
    }

    if (quote)
      throw new Error('Unclosed quote in command');
    if (inToken)
      out.push(cur);           // flush final token (even if it's "")
    return out;
  }

  function basicGuard(raw: string) {
    if (SHELL_META.test(raw))
      throw new Error('Shell metacharacters are not allowed.');
    if (raw.length > 20_000)
      throw new Error('Command too long.');
  }

  function validateUrl(raw: string) {
    let u: URL;
    try { u = new URL(raw); } catch { throw new Error(`Invalid URL: ${raw}`); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:')
      throw new Error('Only HTTP/HTTPS URLs are allowed.');

    if (u.username || u.password)
      throw new Error('Credentials in URL are not allowed.');
    if (u.href.length > 4096)
      throw new Error('URL too long.');
  }

  function parseAndValidateCurlArgs(rawCurl: string): string[] {
    basicGuard(rawCurl);
    const tokens = tokenize(rawCurl.trim());
    if (tokens.length === 0)
      throw new Error('Empty curl command');
    if (tokens[0] !== 'curl')
      throw new Error('Only curl is allowed.');

    const args: string[] = [];
    let urlCount = 0;

    for (let i = 1; i < tokens.length; i++) {
      const t = tokens[i];

      if (!t.startsWith('-')) {
        validateUrl(t);
        args.push(t);
        urlCount++;
        continue;
      }

      if (FORBIDDEN_FLAGS.has(t))
        throw new Error(`Flag not allowed: ${t}`);
      if (!ALLOWED_FLAGS.has(t))
        throw new Error(`Unsupported flag: ${t}`);
      args.push(t);

      const expectsValue = new Set([
        '-X', '--request',
        '-H', '--header',
        '--max-time', '--connect-timeout',
        '-d', '--data', '--data-raw', '--data-binary', '--data-urlencode'
      ]);

      if (expectsValue.has(t)) {
        const v = tokens[++i];
        if (v == null)
          throw new Error(`Flag ${t} requires a value`);

        if ((t === '-d' || t.startsWith('--data')) && v.startsWith('@'))
          throw new Error('Reading data from files is not allowed.');

        if ((t === '-H' || t === '--header') && v.length > 8_192)
          throw new Error('Header value too long.');

        args.push(v);
      }
    }

    if (urlCount === 0)
      throw new Error('URL is required.');
    if (urlCount > 1)
      throw new Error('Multiple URLs are not allowed.');
    return args;
  }

  const m = command.match(CURL_PATTERN);
  const rawCurl = m ? `curl ${m[1]}` : command;
  const args = parseAndValidateCurlArgs(rawCurl);

  const { stdout, stderr } = await execFileAsync('curl', args, {
    shell: false,
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 2 * 1024 * 1024,
    env: { PATH: process.env.PATH },
  });

  return { stdout, stderr };
}

export async function runCommandClean(command: string): Promise<ParsedCurlResponse> {
  const { stdout, stderr } = await runCommand(command);
  const parsed = parseCurlStderr(stderr);

  let data = stdout;
  try {
    const jsonData = JSON.parse(stdout);
    data = jsonData;
  } catch (error) {
    console.log('Failed to parse JSON from curl stdout:', error instanceof Error ? error.message : String(error));

  }

  return {
    data,
    statusCode: parsed.statusCode,
    responseTime: parsed.responseTime,
    contentLength: parsed.contentLength,
    contentType: parsed.contentType,
    server: parsed.server,
    error: parsed.error,
    // rawStderr: stderr
  };
}


/**
 * Extract value from object using JSONPath-like syntax
 * Supports:
 * - Simple properties: "data.token", "statusCode"
 * - Array indices: "data.books[0].title"
 * - Array filters: "data.books[?(@.isbn=='9781449325862')].title"
 * - Comparison operators: ==, !=, ===, !==, >, <, >=, <=
 * - Boolean values: "data.users[?(@.active==true)]"
 */
function getValueByJsonPath(obj: any, path: string): any {
  if (!path || path === '') return obj;
  if (path === null || path === undefined) return undefined;

  // More sophisticated parsing to handle brackets properly
  const parts: string[] = [];
  let current = '';
  let bracketDepth = 0;

  for (let i = 0; i < path.length; i++) {
    const char = path[i];

    if (char === '[') {
      if (bracketDepth === 0 && current) {
        parts.push(current);
        current = '';
      }
      bracketDepth++;
      current += char;
    } else if (char === ']') {
      bracketDepth--;
      current += char;
      if (bracketDepth === 0) {
        parts.push(current);
        current = '';
      }
    } else if (char === '.' && bracketDepth === 0) {
      if (current) {
        parts.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current)
    parts.push(current);


  let currentObj = obj;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (currentObj === null || currentObj === undefined)
      return undefined;


    // Handle array notation with filters or indices
    if (part.startsWith('[') && part.endsWith(']')) {
      const content = part.slice(1, -1);

      // Handle filter expressions like [?(@.isbn=='9781449325862')]
      if (content.startsWith('?(@')) {
        const filterResult = applyArrayFilter(currentObj, content);
        if (filterResult === undefined)
          return undefined;

        currentObj = filterResult;
      }
      // Handle array indices like [0], [1]
      else {
        const index = parseInt(content, 10);
        if (isNaN(index) || !Array.isArray(currentObj))
          return undefined;

        currentObj = currentObj[index];
      }
    }
    // Handle object properties
    else if (typeof currentObj === 'object' && !Array.isArray(currentObj)) {
      currentObj = currentObj[part];
    } else {
      return undefined;
    }
  }

  return currentObj;
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
  if (cleanValue === 'true') cleanValue = true;
  else if (cleanValue === 'false') cleanValue = false;
  else if (cleanValue === 'null') cleanValue = null;

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

/**
 * Check element visibility with parallel recursive search across all frames
 * Ensures exactly 1 element is found with the specified role and accessibleName
 */
async function checkElementVisibilityUnique(page: any, role: string, accessibleName: string) {
  const { expect } = await import('@zealous-tech/playwright/test');
  
  const searchPromises = [];
  
  // Add search in main frame
  searchPromises.push(
    expect(page.getByRole(role, { name: accessibleName })).toBeVisible()
      .then(() => ({ found: true, frame: 'main', level: 0 }))
      .catch(() => ({ found: false, frame: 'main', level: 0 }))
  );
  
  // Recursively collect all iframes at all levels
  const allFrames = await collectAllFrames(page, 0);
  
  // Create promises for all frames
  for (const frameInfo of allFrames) {
    searchPromises.push(
      expect(frameInfo.frame.getByRole(role, { name: accessibleName })).toBeVisible({timeout:2000})
        .then(() => ({ found: true, frame: frameInfo.name, level: frameInfo.level }))
        .catch(() => ({ found: false, frame: frameInfo.name, level: frameInfo.level }))
    );
  }
  
  // Wait for all search results in parallel
  const results = await Promise.all(searchPromises);
  
  // Count found elements
  const foundResults = results.filter(result => result.found);
  
  if (foundResults.length === 0) {
    throw new Error(`Element with role "${role}" and name "${accessibleName}" not found in any frame`);
  } else if (foundResults.length === 1) {
    return { 
      found: true, 
      unique: true, 
      count: 1, 
      frame: foundResults[0].frame,
      level: foundResults[0].level
    };
  } else {
    // Multiple elements found - this is an error
    const frames = foundResults.map(r => r.frame).join(', ');
    throw new Error(`Multiple elements found with role "${role}" and name "${accessibleName}" in frames: ${frames}. Expected exactly 1 element.`);
  }
}

/**
 * Recursively collect all frames (main + all iframes at all levels)
 */
async function collectAllFrames(page: any, level: number): Promise<Array<{frame: any, name: string, level: number}>> {
  const frames = [];
  const iframes = page.locator('iframe');
  const iframeCount = await iframes.count();
  
  for (let i = 0; i < iframeCount; i++) {
    const iframe = page.frameLocator(`iframe >> nth=${i}`);
    const frameName = `iframe-${level}-${i}`;
    
    frames.push({ frame: iframe, name: frameName, level });
    
    // Recursively collect nested iframes
    try {
      const nestedFrames = await collectAllFrames(iframe, level + 1);
      frames.push(...nestedFrames);
    } catch (error) {
      // Ignore errors when accessing nested frames
      continue;
    }
  }
  
  return frames;
}

export { pickActualValue, parseRGBColor, isColorInRange, getAllComputedStylesDirect, getAllDomPropsDirect, hasAlertDialog, getAlertDialogText, performRegexCheck, performRegexExtract, performRegexMatch, compareValues, searchTextInAllFrames, searchElementsByRoleInAllFrames, getElementTextWithFallbacks, getFullXPath, parseArguments, parseSingleArgument, convertToValidJson, parseMethodChain, parseMethodCall, applyLocatorMethod, getValueByJsonPath, checkElementVisibilityUnique };
