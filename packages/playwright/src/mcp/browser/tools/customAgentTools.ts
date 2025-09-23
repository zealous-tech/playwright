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
import { z } from 'zod';
import { defineTabTool } from './tool.js';
import { getAllComputedStylesDirect, pickActualValue, parseRGBColor, isColorInRange, getAllDomPropsDirect, performRegexCheck, searchInAllFrames, searchElementsByRoleInAllFrames, getElementTextWithFallbacks,  runCommand } from './helperFunctions.js';
import { generateLocator } from './utils.js';
import type * as playwright from 'playwright';

const elementStyleSchema = z.object({
  element: z.string().describe('Human-readable element description used to obtain permission to interact with the element'),
  ref: z.string().describe('Exact target element reference from the page snapshot'),
  propertyNames: z.array(z.string()).optional().describe('Specific CSS property names to retrieve. If not provided, all computed styles will be returned'),
});

const elementImageSchema = z.object({
  element: z.string().describe('Human-readable element description used to obtain permission to interact with the element'),
  ref: z.string().describe('Exact target element reference from the page snapshot'),
  includeBackgroundImages: z.boolean().optional().default(true).describe('Whether to include CSS background images'),
  includeDataUrls: z.boolean().optional().default(false).describe('Whether to include data URLs (base64 images)'),
  searchDepth: z.enum(['current', 'children', 'all']).optional().default('current').describe('Search scope: current element only, direct children, or all descendants'),
});

const elementSvgSchema = z.object({
  element: z.string().describe('Human-readable element description used to obtain permission to interact with the element'),
  ref: z.string().describe('Exact target element reference from the page snapshot'),
  extractMethod: z.enum(['outerHTML', 'innerHTML', 'serializer']).optional().default('outerHTML').describe('Method to extract SVG: outerHTML (full element), innerHTML (content only), or serializer (XMLSerializer)'),
  includeStyles: z.boolean().optional().default(false).describe('Whether to include computed styles in the extracted SVG'),
  minifyOutput: z.boolean().optional().default(false).describe('Whether to minify the SVG output by removing unnecessary whitespace'),
});

const get_computed_styles = defineTabTool({
  capability: 'core',
  schema: {
    name: 'get_computed_styles',
    title: 'Get computed styles of element',
    description: 'Get computed styles of element',
    inputSchema: elementStyleSchema,
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    // response.setIncludeSnapshot();

    const { ref, element } = elementStyleSchema.parse(params);
    const result = { ref, element };

    const locator = await tab.refLocator(result);

    await tab.waitForCompletion(async () => {
      const getStylesFunction = (element: Element, props?: string[]) => {
        const computedStyle = window.getComputedStyle(element);
        const result: { [key: string]: string } = {};
        if (props) {
          props.forEach(propName => {
            result[propName] = computedStyle[propName as any] || computedStyle.getPropertyValue(propName);
          });
        }
        return result;
      };

      // response.addCode(`// Get computed styles for ${params.element}`);
      const computedStyles = await locator.evaluate(getStylesFunction, params.propertyNames);
      console.log('Requested Computed Styles : ', computedStyles);
      response.addResult(JSON.stringify(computedStyles, null, 2) || 'Couldn\'t get requested styles');
    });
  },
});

const extract_svg_from_element = defineTabTool({
  capability: 'core',
  schema: {
    name: 'extract_svg_from_element',
    title: 'Extract SVG from Element',
    description: 'Extracts SVG content from a specified element on the page',
    inputSchema: elementSvgSchema,
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    // response.setIncludeSnapshot();

    const { ref, element, extractMethod, includeStyles, minifyOutput } = elementSvgSchema.parse(params);
    const result = { ref, element };

    const locator = await tab.refLocator(result);

    await tab.waitForCompletion(async () => {
      try {
        const extractSvgFunction = (element: Element, options: {
          extractMethod: string;
          includeStyles: boolean;
          minifyOutput: boolean;
        }) => {
          // Check if element is SVG or contains SVG
          let svgElement: SVGElement | null = null;

          if (element.tagName.toLowerCase() === 'svg') {
            svgElement = element as SVGElement;
          } else {
            // Look for SVG child elements
            svgElement = element.querySelector('svg');
          }

          if (!svgElement)
            throw new Error('No SVG element found in the specified element');


          let extractedContent = '';

          // Extract based on method
          switch (options.extractMethod) {
            case 'innerHTML':
              extractedContent = `<svg${Array.from(svgElement.attributes).map(attr => ` ${attr.name}="${attr.value}"`).join('')}>${svgElement.innerHTML}</svg>`;
              break;
            case 'serializer':
              const serializer = new XMLSerializer();
              extractedContent = serializer.serializeToString(svgElement);
              break;
            case 'outerHTML':
            default:
              extractedContent = svgElement.outerHTML;
              break;
          }

          // Include computed styles if requested
          if (options.includeStyles) {
            const computedStyle = window.getComputedStyle(svgElement);
            const styleString = Array.from(computedStyle).map(prop =>
              `${prop}: ${computedStyle.getPropertyValue(prop)}`
            ).join('; ');

            // Add style attribute to the SVG
            extractedContent = extractedContent.replace('<svg', `<svg style="${styleString}"`);
          }

          // Minify if requested
          if (options.minifyOutput)
            extractedContent = extractedContent.replace(/\s+/g, ' ').trim();


          return {
            svgContent: extractedContent,
            elementInfo: {
              tagName: svgElement.tagName,
              width: svgElement.getAttribute('width') || svgElement.getBoundingClientRect().width,
              height: svgElement.getAttribute('height') || svgElement.getBoundingClientRect().height,
              viewBox: svgElement.getAttribute('viewBox'),
              classList: Array.from(svgElement.classList),
              id: svgElement.id,
            }
          };
        };

        // response.addCode(`// Extract SVG content from ${params.element}`);
        const svgContent = await locator.evaluate(extractSvgFunction, { extractMethod, includeStyles, minifyOutput });
        response.addResult(svgContent.svgContent);

      } catch (error) {
        // response.addCode(`// Failed to extract SVG from ${params.element}`);
        const errorMessage = `Failed to extract SVG from ${element}. Error: ${error instanceof Error ? error.message : String(error)}`;
        response.addResult(errorMessage);
      }
    });
  },
});


const extract_image_urls = defineTabTool({
  capability: 'core',
  schema: {
    name: 'extract_image_urls',
    title: 'Extract Image URLs from Element',
    description: 'Extracts all image URLs from a specified element including img src, background images, and other image sources',
    inputSchema: elementImageSchema,
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    // response.setIncludeSnapshot();

    const { ref, element, includeBackgroundImages, includeDataUrls, searchDepth } = elementImageSchema.parse(params);
    const result = { ref, element };

    let locator: playwright.Locator | undefined;
    locator = await tab.refLocator(result);

    await tab.waitForCompletion(async () => {
      try {
        const extractImageFunction = (element: Element, options: {
          includeBackgroundImages: boolean;
          includeDataUrls: boolean;
          searchDepth: string;
        }) => {
          const imageUrls: {
            url: string;
            type: 'img' | 'background' | 'srcset' | 'picture' | 'svg' | 'other';
            element: string;
            alt?: string;
            title?: string;
          }[] = [];

          // Helper function to check if URL should be included
          const shouldIncludeUrl = (url: string): boolean => {
            if (!url || url.trim() === '')
              return false;
            if (!options.includeDataUrls && url.startsWith('data:'))
              return false;
            return true;
          };

          // Helper function to get element selector
          const getElementSelector = (el: Element): string => {
            if (el.id)
              return `#${el.id}`;
            if (el.className)
              return `.${Array.from(el.classList).join('.')}`;
            return el.tagName.toLowerCase();
          };

          // Helper function to extract images from a single element
          const extractFromElement = (el: Element) => {
            // 1. IMG elements
            if (el.tagName === 'IMG') {
              const imgEl = el as HTMLImageElement;
              if (shouldIncludeUrl(imgEl.src)) {
                imageUrls.push({
                  url: imgEl.src,
                  type: 'img',
                  element: getElementSelector(el),
                  alt: imgEl.alt || undefined,
                  title: imgEl.title || undefined,
                });
              }

              // Handle srcset attribute
              if (imgEl.srcset) {
                const srcsetUrls = imgEl.srcset.split(',').map(src => src.trim().split(' ')[0]);
                srcsetUrls.forEach(url => {
                  if (shouldIncludeUrl(url)) {
                    imageUrls.push({
                      url: url,
                      type: 'srcset',
                      element: getElementSelector(el),
                      alt: imgEl.alt || undefined,
                    });
                  }
                });
              }
            }

            // 2. Background images from CSS
            if (options.includeBackgroundImages) {
              const computedStyle = window.getComputedStyle(el);
              const backgroundImage = computedStyle.backgroundImage;

              if (backgroundImage && backgroundImage !== 'none') {
                // Extract URLs from background-image (can have multiple)
                const urlMatches = backgroundImage.match(/url\(['"]?([^'"]*?)['"]?\)/g);
                if (urlMatches) {
                  urlMatches.forEach(match => {
                    const url = match.replace(/url\(['"]?([^'"]*?)['"]?\)/, '$1');
                    if (shouldIncludeUrl(url)) {
                      imageUrls.push({
                        url: url,
                        type: 'background',
                        element: getElementSelector(el),
                      });
                    }
                  });
                }
              }
            }

            // 3. Picture elements
            if (el.tagName === 'PICTURE') {
              const sources = el.querySelectorAll('source');
              sources.forEach(source => {
                if (source.srcset) {
                  const srcsetUrls = source.srcset.split(',').map(src => src.trim().split(' ')[0]);
                  srcsetUrls.forEach(url => {
                    if (shouldIncludeUrl(url)) {
                      imageUrls.push({
                        url: url,
                        type: 'picture',
                        element: getElementSelector(el),
                      });
                    }
                  });
                }
              });
            }

            // 4. SVG elements with image elements inside
            if (el.tagName === 'SVG') {
              const imageElements = el.querySelectorAll('image');
              imageElements.forEach(img => {
                const href = img.getAttribute('href') || img.getAttribute('xlink:href');
                if (href && shouldIncludeUrl(href)) {
                  imageUrls.push({
                    url: href,
                    type: 'svg',
                    element: getElementSelector(el),
                  });
                }
              });
            }

            // 5. Other elements with image-related attributes
            ['data-src', 'data-original', 'data-lazy-src', 'poster'].forEach(attr => {
              const value = el.getAttribute(attr);
              if (value && shouldIncludeUrl(value)) {
                imageUrls.push({
                  url: value,
                  type: 'other',
                  element: getElementSelector(el),
                });
              }
            });
          };

          // Extract based on search depth
          switch (options.searchDepth) {
            case 'current':
              extractFromElement(element);
              break;
            case 'children':
              extractFromElement(element);
              Array.from(element.children).forEach(extractFromElement);
              break;
            case 'all':
              extractFromElement(element);
              const allElements = element.querySelectorAll('*');
              Array.from(allElements).forEach(extractFromElement);
              break;
          }

          // Remove duplicates
          const uniqueImages = imageUrls.filter((img, index, self) =>
            index === self.findIndex(i => i.url === img.url && i.type === img.type)
          );

          return {
            totalFound: uniqueImages.length,
            images: uniqueImages,
            searchDepth: options.searchDepth,
            includeBackgroundImages: options.includeBackgroundImages,
            includeDataUrls: options.includeDataUrls,
          };
        };

        // response.addCode(`// Extract image URLs from ${params.element}`);
        const imageData = await locator.evaluate(extractImageFunction, { includeBackgroundImages, includeDataUrls, searchDepth });
        console.log('Extracted Image URLs: ', imageData);

        const summary = `Found ${imageData.totalFound} image(s) in ${element}:\n\n` +
            imageData.images.map((img, index) =>
              `${index + 1}. [${img.type.toUpperCase()}] ${img.url}\n` +
                `   Element: ${img.element}` +
                (img.alt ? `\n   Alt: ${img.alt}` : '') +
                (img.title ? `\n   Title: ${img.title}` : '')
            ).join('\n\n');

        response.addResult(JSON.stringify(imageData));

      } catch (error) {
        // response.addCode(`// Failed to extract image URLs from ${params.element}`);
        const errorMessage = `Failed to extract image URLs from ${element}. Error: ${error instanceof Error ? error.message : String(error)}`;
        response.addResult(errorMessage);
      }
    });
  },
});


const styleCheckSchema = z.object({
  name: z.string().describe(
      "CSS property name to validate (supports kebab-case or camelCase, e.g. 'color' or 'backgroundColor')"
  ),
  operator: z
      .enum(['isEqual', 'notEqual', 'inRange'])
      .describe(
          "Validation operator: 'isEqual' checks strict equality, 'notEqual' checks strict inequality, 'inRange' checks if value is in list or RGB color is within specified range"
      ),
  expected: z.union([
    z.string(),
    z.array(z.string()),
    z.object({
      minR: z.number().min(0).max(255).describe('Minimum red value (0-255)'),
      maxR: z.number().min(0).max(255).describe('Maximum red value (0-255)'),
      minG: z.number().min(0).max(255).describe('Minimum green value (0-255)'),
      maxG: z.number().min(0).max(255).describe('Maximum green value (0-255)'),
      minB: z.number().min(0).max(255).describe('Minimum blue value (0-255)'),
      maxB: z.number().min(0).max(255).describe('Maximum blue value (0-255)'),
    })
  ]).describe(
      "Expected value(s) for the CSS property. Can be a single string, array of strings for 'inRange' operator, or RGB range object for RGB color validation."
  ),
});

export const validateStylesSchema = z.object({
  element: z
      .string()
      .describe(
          'Human-readable element description used to obtain permission to interact with the element'
      ),
  ref: z
      .string()
      .describe('Exact target element reference from the page snapshot'),
  checks: z
      .array(styleCheckSchema)
      .min(1)
      .describe(
          'List of style validation checks to perform on the target element'
      ),
});


const validate_computed_styles = defineTabTool({
  capability: 'core',
  schema: {
    name: 'validate_computed_styles',
    title: 'Validate computed styles of element',
    description:
      "Validate element's computed styles against expected values using isEqual / notEqual / inRange operators. Supports RGB color range validation for color properties.",
    inputSchema: validateStylesSchema,
    type: 'readOnly',
  },
  handle: async (tab, rawParams, response) => {
    const { ref, element, checks } = validateStylesSchema.parse(rawParams);

    await tab.waitForCompletion(async () => {
      // 1) Get all computed styles directly
      const allStyles = await getAllComputedStylesDirect(tab, ref, element);
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

      // Generate evidence message
      let evidence = '';
      if (passedCount === results.length) {
        evidence = `Found element "${element}" with all ${results.length} style properties matching expected values`;
      } else {
        const failedChecks = results.filter(r => r.result === 'fail');
        const failedStyles = failedChecks.map(c => `${c.style}: expected "${c.expected}", got "${c.actual}"`).join(', ');
        evidence = `Found element "${element}" but ${failedChecks.length} style properties failed validation: ${failedStyles}`;
      }

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
      response.addResult(JSON.stringify(payload, null, 2));
    });
  },
});


const textValidationSchema = z.object({
  element: z.string().describe(
      'Human-readable element description used to obtain permission to interact with the element'
  ),
  ref: z.string().optional().describe(
      "Exact target element reference from the page snapshot. If you don't have a specific element reference, omit this parameter entirely (don't pass 'null' or empty string) to search across the whole page snapshot"
  ),
  expectedText: z.string().describe(
      'Expected text value to validate in the element or whole page'
  ),
  matchType: z.enum(['exact', 'contains', 'not-contains']).default('exact').describe(
      "Type of match: 'exact' checks exact match, 'contains' checks substring presence, 'not-contains' checks that text is NOT present. Works for both specific elements (when ref provided) and page snapshot (when ref is null)"
  ),
  caseSensitive: z.boolean().optional().describe(
      'Enable case-sensitive comparison (default false)'
  ),
});

const validate_element_text = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_verify_text_visible',
    title: 'Verify text visible',
    description:
        "Verify that text is visible on the page with exact/contains/not-contains matching. When ref is provided, first checks specific element's text content (including input values, placeholders, etc.). If no text found in element or ref is not provided, searches for visible text across all frames and iframes. It is recommended to always provide ref when possible for more precise validation.",
    inputSchema: textValidationSchema,
    type: 'readOnly',
  },
  handle: async (tab, rawParams, response) => {
    const { ref, element, expectedText, matchType, caseSensitive } =
      textValidationSchema.parse(rawParams);

    await tab.waitForCompletion(async () => {
      let actualText = '';
      let useVisibilitySearch = false;

      if (ref) {
        try {
          const locator = await tab.refLocator({ ref, element });
          console.log('generateLocator', await generateLocator(locator));
          actualText = await getElementTextWithFallbacks(locator, tab, element);

          // If still no text found, use visibility search
          if (!actualText) {
            console.log(`No text found in element ${element}, falling back to visibility search`);
            useVisibilitySearch = true;
          }
        } catch (error) {
          console.log(`Failed to find element with ref "${ref}" for ${element}, falling back to visibility search. Error: ${error instanceof Error ? error.message : String(error)}`);
          useVisibilitySearch = true;
        }
      } else {
        // No ref provided, use visibility search directly
        useVisibilitySearch = true;
      }

      // Use visibility search if needed
      if (useVisibilitySearch) {
        try {
          // Start recursive search from main page using helper function
          console.log(`validate_element_text: Starting recursive search for text "${expectedText}"`);
          const allElements = await searchInAllFrames(tab.page, expectedText, matchType);
          const totalElementCount = allElements.length;

          console.log(`validate_element_text: Total found ${totalElementCount} visible elements with text "${expectedText}" (recursive search)`);

          // Determine if test passes based on matchType
          // Playwright's getByText already handles the matching logic correctly
          let passed: boolean;
          if (matchType === 'contains') {
            passed = totalElementCount > 0; // Text must be visible (substring match)
          } else if (matchType === 'not-contains') {
            passed = totalElementCount === 0; // Text should NOT be visible
          } else { // exact
            passed = totalElementCount > 0; // Text must be visible (exact match)
          }

          // Generate evidence message
          let evidence = '';
          if (matchType === 'contains') {
            if (passed)
              evidence = `Found visible text "${expectedText}" on page as expected`;
            else
              evidence = `Text "${expectedText}" not found or not visible on page`;

          } else if (matchType === 'not-contains') {
            if (passed)
              evidence = `Text "${expectedText}" is not visible on page as expected`;
            else
              evidence = `Text "${expectedText}" is unexpectedly visible on page`;

          } else { // exact
            if (passed)
              evidence = `Found visible text "${expectedText}" with exact match on page`;
            else
              evidence = `Text "${expectedText}" not found with exact match or not visible on page`;

          }

          const payload = {
            ref,
            element,
            summary: {
              total: 1,
              passed: passed ? 1 : 0,
              failed: passed ? 0 : 1,
              status: passed ? 'pass' : 'fail',
              evidence,
            },
            checks: [{
              property: 'text_visibility',
              operator: matchType,
              expected: expectedText,
              actual: totalElementCount > 0 ? 'found' : 'not-found',
              result: passed ? 'pass' : 'fail',
            }],
            scope: 'visibility_search',
            matchType,
            caseSensitive: !!caseSensitive,
            totalFound: totalElementCount,
          };

          console.log('Validate element text (visibility search):', payload);
          response.addResult(JSON.stringify(payload, null, 2));
          return; // Exit early since we used visibility search

        } catch (error) {
          const errorMessage = `Failed to search for visible text. Error: ${error instanceof Error ? error.message : String(error)}`;
          const errorPayload = {
            ref,
            element,
            summary: {
              total: 1,
              passed: 0,
              failed: 1,
              status: 'fail',
              evidence: errorMessage,
            },
            checks: [{
              property: 'text_visibility',
              operator: matchType,
              expected: expectedText,
              actual: 'error',
              result: 'fail',
            }],
            error: error instanceof Error ? error.message : String(error),
          };

          console.error('Validate element text (visibility search) error:', errorPayload);
          response.addResult(JSON.stringify(errorPayload, null, 2));
          return; // Exit early on error
        }
      }

      // This code runs only when ref is provided and text was found in the element
      if (ref && !useVisibilitySearch) {
        const norm = (s: string) => (caseSensitive ? s : s.toLowerCase());
        const expected = expectedText;
        let passed;
        // Apply match type logic for specific element
        if (matchType === 'exact')
          passed = norm(actualText) === norm(expected);
        else if (matchType === 'contains')
          passed = norm(actualText).includes(norm(expected));
        else if (matchType === 'not-contains')
          passed = !norm(actualText).includes(norm(expected));


        // Generate evidence message
        let evidence = '';
        if (passed) {
          if (matchType === 'exact')
            evidence = `Found element "${element}" with exact text match: "${actualText}"`;
          else if (matchType === 'contains')
            evidence = `Found element "${element}" containing expected text "${expectedText}" in: "${actualText}"`;
          else if (matchType === 'not-contains')
            evidence = `Found element "${element}" that correctly does not contain text "${expectedText}"`;

        } else {
          if (matchType === 'exact')
            evidence = `Element "${element}" text "${actualText}" does not exactly match expected "${expectedText}"`;
          else if (matchType === 'contains')
            evidence = `Element "${element}" text "${actualText}" does not contain expected text "${expectedText}"`;
          else if (matchType === 'not-contains')
            evidence = `Element "${element}" unexpectedly contains text "${expectedText}" in: "${actualText}"`;

        }

        const payload = {
          ref,
          element,
          summary: {
            total: 1,
            passed: passed ? 1 : 0,
            failed: passed ? 0 : 1,
            status: passed ? 'pass' : 'fail',
            evidence,
          },
          checks: [{
            property: 'text',
            operator: matchType,
            expected: expectedText,
            actual: actualText.length > 300 ? actualText.slice(0, 300) + '…' : actualText,
            result: passed ? 'pass' : 'fail',
          }],
          scope: 'element',
          matchType,
          caseSensitive: !!caseSensitive,
        };

        console.log('Validate element text (element search):', payload);
        response.addResult(JSON.stringify(payload, null, 2));
      }
    });
  },
});


const domPropCheckSchema = z.object({
  name: z.string(), // any DOM property
  operator: z.enum(['isEqual', 'notEqual']).default('isEqual'),
  expected: z.any(), // can be string, number, boolean
});
const domChecksSchema = z.array(domPropCheckSchema).min(1);

const baseDomInputSchema = z.object({
  ref: z.string().min(1),
  element: z.string().min(1),
});

const validateDomPropsSchema = baseDomInputSchema.extend({
  checks: domChecksSchema,
});


const validate_dom_properties = defineTabTool({
  capability: 'core',
  schema: {
    name: 'validate_dom_properties',
    title: 'Validate DOM properties of element',
    description:
      'Validate arbitrary DOM properties (like checked, disabled, value, innerText, etc.) against expected values.',
    inputSchema: validateDomPropsSchema,
    type: 'readOnly',
  },
  handle: async (tab, rawParams, response) => {
    const { ref, element, checks } = validateDomPropsSchema.parse(rawParams);

    await tab.waitForCompletion(async () => {
      const allProps = await getAllDomPropsDirect(tab, ref, element);
      console.log('All DOM Props:', allProps);

      const results = checks.map(c => {
        const actual = allProps[c.name];
        let passed: boolean;
        if (c.operator === 'isEqual')
          passed = actual === c.expected;
        else
          passed = actual !== c.expected;

        return {
          property: c.name,
          operator: c.operator,
          expected: c.expected,
          actual,
          result: passed ? 'pass' : 'fail',
        };
      });

      const passedCount = results.filter(r => r.result === 'pass').length;

      // Generate evidence message
      let evidence = '';
      if (passedCount === results.length) {
        evidence = `Found element "${element}" with all ${results.length} DOM properties matching expected values`;
      } else {
        const failedChecks = results.filter(r => r.result === 'fail');
        const failedProps = failedChecks.map(c => `${c.property}: expected "${c.expected}", got "${c.actual}"`).join(', ');
        evidence = `Found element "${element}" but ${failedChecks.length} DOM properties failed validation: ${failedProps}`;
      }

      // 3) answer
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
        snapshot: allProps, // all properties for debugging
      };

      console.log('Validate DOM Properties:');
      console.dir(payload, { depth: null });
      response.addResult(JSON.stringify(payload, null, 2));
    });
  },
});


const checkAlertInSnapshotSchema = z.object({
  element: z.string().describe('Human-readable element description for logging purposes'),
  matchType: z.enum(['contains', 'not-contains']).default('contains').describe(
      "Type of match: 'contains' checks if alert dialog is present, 'not-contains' checks that alert dialog is NOT present"
  ),
  hasText: z.string().optional().describe(
      'Optional text to check if it exists in the alert dialog message. If provided and alert exists, will verify if this text is present in the alert message'
  ),
});

const validate_alert_in_snapshot = defineTabTool({
  capability: 'core',
  schema: {
    name: 'validate_alert_in_snapshot',
    title: 'Validate Alert in Snapshot',
    description: 'Validate if an alert dialog is present in the current page snapshot',
    inputSchema: checkAlertInSnapshotSchema,
    type: 'readOnly',
  },
  // clearsModalState: 'dialog',
  handle: async (tab, params, response) => {
    const { element, matchType, hasText } = checkAlertInSnapshotSchema.parse(params);

    try {
      // Get the current snapshot
      console.log('start capture snapshot');
      const tabSnapshot = await tab.captureSnapshot();

      // Check if alert dialog exists using modalStates
      const dialogState = tabSnapshot.modalStates.find(state => state.type === 'dialog');
      const alertExists = !!dialogState;
      console.log('alertExists', alertExists);
      console.log('matchType:', matchType);
      console.log('hasText:', hasText);

      // Get alert dialog text if it exists
      const alertText = dialogState ? dialogState.description : null;
      console.log('alertText:', alertText);

      // Check text if hasText is provided and alert exists
      let textCheckPassed = true;
      let textCheckMessage = '';
      if (hasText && alertExists && alertText) {
        textCheckPassed = alertText.includes(hasText);
        textCheckMessage = textCheckPassed
          ? `Alert text contains expected text: "${hasText}"`
          : `Alert text does not contain expected text: "${hasText}". Actual text: "${alertText}"`;
        console.log('textCheckPassed:', textCheckPassed);
        console.log('textCheckMessage:', textCheckMessage);
      }

      // Apply match type logic
      let passed;
      if (matchType === 'contains')
        passed = alertExists && (hasText ? textCheckPassed : true);
      else if (matchType === 'not-contains')
        passed = !alertExists;

      console.log('passed:', passed);

      // Generate evidence message
      let evidence = '';
      if (matchType === 'contains') {
        if (passed) {
          if (hasText)
            evidence = `Alert dialog found with text: "${alertText}" containing expected: "${hasText}"`;
          else
            evidence = `Alert dialog found with text: "${alertText}"`;

        } else {
          if (hasText)
            evidence = `Alert dialog found but text "${hasText}" not found in: "${alertText}"`;
          else
            evidence = `Alert dialog not found in snapshot`;

        }
      } else { // not-contains
        if (passed)
          evidence = `Alert dialog correctly not found in snapshot`;
        else
          evidence = `Alert dialog unexpectedly found with text: "${alertText}"`;

      }

      const payload = {
        element,
        matchType,
        hasText,
        alertExists,
        alertText,
        textCheckPassed,
        textCheckMessage,
        summary: {
          status: passed ? 'pass' : 'fail',
          evidence,
        },
        snapshot: {
          containsAlert: alertExists,
          snapshotLength: tabSnapshot.ariaSnapshot.length
        }
      };

      console.log('Check alert in snapshot:', payload);
      const resultString = JSON.stringify(payload, null, 2);
      console.log('Result string:', resultString);
      response.addResult(resultString);
    } catch (error) {
      const errorMessage = `Failed to check alert dialog in snapshot. Error: ${error instanceof Error ? error.message : String(error)}`;
      const errorPayload = {
        element,
        matchType,
        hasText,
        alertExists: false,
        alertText: null,
        textCheckPassed: false,
        textCheckMessage: '',
        summary: {
          status: 'error',
          evidence: errorMessage
        },
        error: error instanceof Error ? error.message : String(error)
      };

      console.error('Check alert in snapshot error:', errorPayload);
      const errorResultString = JSON.stringify(errorPayload, null, 2);
      console.log('Error result string:', errorResultString);
      response.addResult(errorResultString);
      console.log('Error result added to response');
      console.log('Function completed with error');
    }
  },
});

const default_validation = defineTabTool({
  capability: 'core',
  schema: {
    name: 'default_validation',
    title: 'Default Validation Tool',
    description: 'Default tool for when LLM cannot find a suitable tool. Accepts ref and JavaScript code to parse and execute.',
    inputSchema: z.object({
      refs: z.array(z.string()).describe('Array of element references from the page snapshot. Pass single ref as array with one element if needed.'),
      jsCode: z.string().describe('JavaScript code to execute on each element. Function receives single element as parameter. Should return "pass" or "fail" as string. All elements must return "pass" for overall success.'),
    }),
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    const { refs, jsCode } = params;

    await tab.waitForCompletion(async () => {
      try {
        // Get element locators for all refs
        const locators = await Promise.all(
            refs.map(ref => tab.refLocator({ ref, element: 'target element' }))
        );
        for (const locator of locators)
          console.log('generateLocator', await generateLocator(locator));

        // Execute the JavaScript code on each element and collect results
        const results = await Promise.all(
            locators.map(async (locator, index) => {
              return await locator.evaluate((element, code) => {
                try {
                // Safe evaluation function
                  const safeEval = (code: string, element: Element) => {
                    const func = new Function('element', 'document', `
                    'use strict';
                    ${code}
                  `);

                    // Create safe context with necessary objects
                    const safeContext = {
                      element,
                      document, // Keep document for element searching
                      // Disable potentially dangerous functions
                      console: { log: () => {}, warn: () => {}, error: () => {} },
                      setTimeout: undefined,
                      setInterval: undefined,
                      eval: undefined,
                      Function: undefined,
                      // Keep limited window functionality
                      window: {
                        innerWidth: window.innerWidth,
                        innerHeight: window.innerHeight,
                        localStorage: window.localStorage,
                        sessionStorage: window.sessionStorage
                      }
                    };

                    return func.call(safeContext, element, document);
                  };

                  return safeEval(code, element);
                } catch (error) {
                  return {
                    error: error instanceof Error ? error.message : String(error),
                    type: 'execution_error'
                  };
                }
              }, jsCode);
            })
        );

        // Check if all results are 'pass'
        const allPassed = results.every(result => result === 'pass');
        const result = allPassed ? 'pass' : 'fail';

        // Determine pass/fail based on result
        const isPass = result === 'pass' && !(result && typeof result === 'object' && 'error' in result);
        const status = isPass ? 'pass' : 'fail';
        const passed = isPass ? 1 : 0;
        const failed = isPass ? 0 : 1;

        // Generate evidence message
        const evidence = isPass
          ? `Successfully executed JavaScript code on ${refs.length} element(s) with refs: [${refs.join(', ')}]. Result: ${typeof result === 'object' ? JSON.stringify(result) : String(result)}`
          : `JavaScript code execution failed on ${refs.length} element(s) with refs: [${refs.join(', ')}]. Result: ${typeof result === 'object' ? JSON.stringify(result) : String(result)}`;

        const payload = {
          refs,
          element: 'target elements',
          summary: {
            total: 1,
            passed,
            failed,
            status,
            evidence,
          },
          checks: [{
            property: 'javascript_execution',
            operator: 'execute',
            expected: 'success',
            actual: typeof result === 'object' ? JSON.stringify(result) : String(result),
            result: isPass ? 'pass' : 'fail',
          }],
          result,
          jsCode,
        };

        console.log('Default validation executed:', payload);
        response.addResult(JSON.stringify(payload, null, 2));

      } catch (error) {
        const errorPayload = {
          refs,
          element: 'target elements',
          summary: {
            total: 1,
            passed: 0,
            failed: 1,
            status: 'fail',
            evidence: `Failed to execute JavaScript code on ${refs.length} element(s) with refs: [${refs.join(', ')}]. Error: ${error instanceof Error ? error.message : String(error)}`,
          },
          checks: [{
            property: 'javascript_execution',
            operator: 'execute',
            expected: 'success',
            actual: error instanceof Error ? error.message : String(error),
            result: 'fail',
          }],
          error: error instanceof Error ? error.message : String(error),
          jsCode,
        };

        console.error('Default validation error:', errorPayload);
        response.addResult(JSON.stringify(errorPayload, null, 2));
      }
    });
  },
});


const validate_response = defineTabTool({
  capability: 'core',
  schema: {
    name: 'validate_response',
    title: 'Validate Response using Regex Patterns',
    description: 'Validate response data using regex patterns. Types: regex_extract (extract value with pattern), regex_match (check pattern presence).',
    inputSchema: z.object({
      responseData: z.string().describe('Response data as string (can be JSON with stdout/stderr or raw response)'),
      checks: z.array(z.object({
        type: z.enum(['regex_extract', 'regex_match']).describe('Type of validation check'),
        name: z.string().describe('Name/description of the check for logging purposes'),
        pattern: z.string().describe('Regex pattern to extract or match against'),
        expected: z.any().optional().describe('Expected value for comparison (not needed for regex_match)'),
        operator: z.enum(['equals', 'not_equals', 'contains', 'not_contains', 'greater_than', 'less_than']).optional().default('equals').describe('Comparison operator (not needed for regex_match)'),
        extractGroup: z.number().optional().default(1).describe('Regex capture group to extract (default: 1, only for regex_extract)'),
      })).min(1).describe('Array of validation checks to perform'),
    }),
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    const { responseData, checks } = params;

    try {
      // Perform all checks
      const results = checks.map(check => {
        const result = performRegexCheck(responseData, check);
        return {
          type: check.type,
          name: check.name,
          pattern: check.pattern,
          expected: check.expected,
          operator: check.operator,
          extractGroup: check.extractGroup,
          actual: result.actual,
          result: result.passed ? 'pass' : 'fail',
        };
      });

      const passedCount = results.filter(r => r.result === 'pass').length;
      const status = passedCount === results.length ? 'pass' : 'fail';

      // Generate evidence message
      let evidence = '';
      if (status === 'pass') {
        evidence = `All ${results.length} regex validation checks passed successfully`;
      } else {
        const failedChecks = results.filter(r => r.result === 'fail');
        const failedDetails = failedChecks.map(c =>
          `${c.name} (pattern: ${c.pattern}, expected: ${c.expected}, got: ${c.actual})`
        ).join(', ');
        evidence = `${passedCount}/${results.length} checks passed. Failed: ${failedDetails}`;
      }

      const payload = {
        responseData: responseData.length > 500 ? responseData.slice(0, 500) + '...' : responseData,
        summary: {
          total: results.length,
          passed: passedCount,
          failed: results.length - passedCount,
          status,
          evidence,
        },
        checks: results,
      };

      console.log('Validate cURL response regex:', payload);
      response.addResult(JSON.stringify(payload, null, 2));

    } catch (error) {
      const errorPayload = {
        responseData: responseData.length > 500 ? responseData.slice(0, 500) + '...' : responseData,
        summary: {
          total: checks.length,
          passed: 0,
          failed: checks.length,
          status: 'fail',
          evidence: `Failed to validate cURL response with regex. Error: ${error instanceof Error ? error.message : String(error)}`,
        },
        checks: checks.map(check => ({
          type: check.type,
          name: check.name,
          pattern: check.pattern,
          expected: check.expected,
          operator: check.operator,
          extractGroup: check.extractGroup,
          actual: 'error',
          result: 'fail',
        })),
        error: error instanceof Error ? error.message : String(error),
      };

      console.error('Validate cURL response regex error:', errorPayload);
      response.addResult(JSON.stringify(errorPayload, null, 2));
    }
  },
});

const generate_locator = defineTabTool({
  capability: 'core',
  schema: {
    name: 'generate_locator',
    title: 'Generate Playwright Locator from Ref',
    description: 'Generate a stable Playwright locator string from element ref using Playwright\'s built-in generateLocator function. Returns a single optimized locator string.',
    inputSchema: z.object({
      ref: z.string().describe('Element reference from page snapshot'),
      element: z.string().describe('Human-readable element description for logging'),
    }),
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    const { ref, element } = params;

    try {
      await tab.waitForCompletion(async () => {
        // Get locator from ref
        const locator = await tab.refLocator({ ref, element });

        // Generate stable locator using Playwright's generateLocator function
        const generatedLocator = await generateLocator(locator);

        const payload = {
          ref,
          element,
          generatedLocator,
          summary: {
            status: 'success',
            message: `Successfully generated Playwright locator for element "${element}" with ref "${ref}"`,
            locatorType: 'playwright-generated',
            isStable: true,
            canBeReused: true,
          },
        };

        response.addResult(JSON.stringify(payload, null, 2));
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
      response.addResult(JSON.stringify(errorPayload, null, 2));
    }
  },
});

const validate_tab_exist = defineTabTool({
  capability: 'core',
  schema: {
    name: 'validate_tab_exist',
    title: 'Validate Tab Exists',
    description: 'Check if a browser tab with the specified URL exists or does not exist. Use matchType "exist" to verify tab exists, or "not-exist" to verify tab does not exist. exactMatch is ignored when matchType is "not-exist". Optionally validate if the found tab is the current active tab with isCurrent parameter.',
    inputSchema: z.object({
      url: z.string().describe('URL to check for in existing browser tabs'),
      matchType: z.enum(['exist', 'not-exist']).describe('Whether to check if tab exists or does not exist'),
      exactMatch: z.boolean().optional().describe('Whether to require exact URL match (true) or partial match (false). Ignored when matchType is "not-exist"'),
      isCurrent: z.boolean().optional().describe('If true, also validates that the found tab is the current active tab'),
    }),
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    const { url, matchType, exactMatch = false, isCurrent } = params;

    try {
      // Get all tabs information from context
      const context = tab.context;
      const allTabs = context.tabs();

      // Extract tab info using the correct page methods
      const tabsWithInfo = await Promise.all(allTabs.map(async (tabItem: any, index: number) => {
        try {
          // Get URL and title from page object
          const tabUrl = await tabItem.page.url() || 'unknown';
          const tabTitle = await tabItem.page.title() || 'Unknown';

          return {
            index,
            header: tabTitle,
            url: tabUrl
          };
        } catch (error) {
          // Fallback if we can't get tab info
          return {
            index,
            header: 'Unknown',
            url: 'unknown'
          };
        }
      }));

      console.log('All tabs info:', tabsWithInfo);

      // Find current tab URL
      let currentTabUrl = '';
      try {
        currentTabUrl = await tab.page.url();
      } catch (error) {
        console.log('Could not determine current tab URL:', error);
      }

      let foundTab: any = null;
      let searchType = '';

      // Search for tab with matching URL
      if (exactMatch) {
        // Exact URL match
        foundTab = tabsWithInfo.find((tab: any) => tab.url === url);
        searchType = 'exact';
      } else {
        // Partial URL match
        foundTab = tabsWithInfo.find((tab: any) => tab.url.includes(url) || url.includes(tab.url));
        searchType = 'partial';
      }

      const isFound = !!foundTab;

      // Check if found tab is current tab (if isCurrent is specified)
      let isCurrentTab = false;
      if (isFound && isCurrent !== undefined)
        isCurrentTab = (foundTab as any).url === currentTabUrl;


      // Determine final result based on matchType and isCurrent
      let status: string;
      if (matchType === 'exist') {
        const urlMatch = isFound;
        const currentMatch = isCurrent === undefined ? true : (isCurrent ? isCurrentTab : !isCurrentTab);
        status = (urlMatch && currentMatch) ? 'pass' : 'fail';
      } else { // matchType === 'not-exist'
        const urlMatch = !isFound;
        const currentMatch = isCurrent === undefined ? true : (isCurrent ? isCurrentTab : !isCurrentTab);
        status = (urlMatch && currentMatch) ? 'pass' : 'fail';
      }

      // Generate evidence message
      let evidence = '';
      let currentInfo = '';
      if (isCurrent !== undefined) {
        if (isFound)
          currentInfo = ` Found tab is ${isCurrentTab ? '' : 'not '}current tab. Expected: ${isCurrent ? 'current' : 'not current'}.`;
        else
          currentInfo = ` Current tab check: ${isCurrent ? 'expected current tab not found' : 'expected non-current tab not found'}.`;

      }

      if (matchType === 'exist') {
        if (isFound && foundTab) {
          evidence = `Found tab with ${searchType} URL match: "${(foundTab as any).url}" (index: ${(foundTab as any).index}, header: "${(foundTab as any).header}")${currentInfo}`;
        } else {
          const availableUrls = tabsWithInfo.map((t: any) => (t as any).url).join(', ');
          evidence = `Tab with URL "${url}" not found. Available tabs: ${availableUrls}${currentInfo}`;
        }
      } else { // matchType === 'not-exist'
        if (!isFound)
          evidence = `Tab with URL "${url}" does not exist (as expected). Available tabs: ${tabsWithInfo.map((t: any) => (t as any).url).join(', ')}${currentInfo}`;
        else
          evidence = `Tab with URL "${url}" exists (unexpected). Found: "${(foundTab as any).url}" (index: ${(foundTab as any).index}, header: "${(foundTab as any).header}")${currentInfo}`;

      }

      const payload = {
        url,
        matchType,
        exactMatch,
        isCurrent,
        currentTabUrl,
        isCurrentTab,
        foundTab: foundTab ? {
          index: (foundTab as any).index,
          header: (foundTab as any).header,
          url: (foundTab as any).url
        } : null,
        summary: {
          total: 1,
          passed: status === 'pass' ? 1 : 0,
          failed: status === 'pass' ? 0 : 1,
          status,
          evidence,
        },
        allTabs: tabsWithInfo.map((t: any) => ({
          index: (t as any).index,
          header: (t as any).header,
          url: (t as any).url
        })),
      };
      console.log('Validate tab exist:', payload);
      response.addResult(JSON.stringify(payload, null, 2));

    } catch (error) {
      const errorPayload = {
        url,
        exactMatch,
        summary: {
          total: 1,
          passed: 0,
          failed: 1,
          status: 'fail',
          evidence: `Failed to validate tab existence. Error: ${error instanceof Error ? error.message : String(error)}`,
        },
        error: error instanceof Error ? error.message : String(error),
      };
      console.error('Validate tab exist error:', errorPayload);
      response.addResult(JSON.stringify(errorPayload, null, 2));
    }
  },
});

const validateElementSchema = z.object({
  ref: z.string().optional().describe('Exact target element reference from the page snapshot. If provided, will search by ref first, then fallback to role/accessibleName if ref fails'),
  role: z.string().describe('ROLE of the element. Can be found in the snapshot like this: \`- {ROLE} "Accessible Name":\`'),
  accessibleName: z.string().describe('ACCESSIBLE_NAME of the element. Can be found in the snapshot like this: \`- role "{ACCESSIBLE_NAME}"\`'),
  matchType: z.enum(['contains', 'not-contains']).default('contains').describe(
      "Type of match: 'contains' checks if element is present and visible, 'not-contains' checks that element is NOT present or NOT visible"
  ),
});

const validate_element = defineTabTool({
  capability: 'core',
  schema: {
    name: 'validate_element',
    title: 'Validate Element',
    description: 'Validate element visibility with ref-first search strategy. First tries to find element by ref, then falls back to role/accessibleName search if ref fails or is not provided.',
    inputSchema: validateElementSchema,
    type: 'readOnly',
  },

  handle: async (tab, params, response) => {
    try {
      const { ref, role, accessibleName, matchType } = params;

      console.log(`validate_element: Starting validation with ref="${ref}", role="${role}", accessibleName="${accessibleName}"`);

      let isVisible = false;
      let existsInDOM = false;
      let searchMethod = '';
      let evidence = '';

      // Step 1: Try to find element by ref if provided
      if (ref) {
        try {
          console.log(`validate_element: Attempting to find element by ref="${ref}"`);
          const locator = await tab.refLocator({ ref, element: 'target element' });
          // Check if element exists and is visible
          const count = await locator.count();
          if (count > 0) {
            existsInDOM = true;
            isVisible = await locator.isVisible();
            searchMethod = 'ref';
            console.log(`validate_element: Found element by ref, count=${count}, isVisible=${isVisible}`);
          } else {
            console.log(`validate_element: Element not found by ref, falling back to role/accessibleName search`);
          }
        } catch (error) {
          console.log(`validate_element: Error finding element by ref, falling back to role/accessibleName search. Error: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // Step 2: Fallback to role/accessibleName search if ref search failed or ref not provided
      if (!ref || !existsInDOM) {
        console.log(`validate_element: Starting role/accessibleName search for role="${role}" with accessibleName="${accessibleName}"`);

        // Start recursive search from main page using helper function
        const allElements = await searchElementsByRoleInAllFrames(tab.page, role, accessibleName);
        const totalElementCount = allElements.length;

        console.log(`validate_element: Total found ${totalElementCount} elements with role="${role}" and name="${accessibleName}" (recursive search)`);

        if (totalElementCount > 0) {
          existsInDOM = true;
          searchMethod = 'role/accessibleName';

          // Check visibility of all found elements - if any is visible, set isVisible to true
          try {
            for (let i = 0; i < allElements.length; i++) {
              const elementVisible = await allElements[i].element.isVisible();
              if (elementVisible) {
                isVisible = true;
                console.log(`validate_element: Found visible element by role/accessibleName at index ${i}, isVisible=${isVisible}`);
                break; // Exit loop as soon as we find one visible element
              }
            }
            if (!isVisible)
              console.log(`validate_element: Found ${totalElementCount} elements by role/accessibleName but none are visible`);

          } catch (error) {
            console.log(`validate_element: Could not check visibility:`, error);
            isVisible = false;
          }
        }
      }

      // Step 3: Determine test result
      if (!existsInDOM) {
        // Element not found in DOM
        const passed = matchType === 'not-contains';
        evidence = `Element with role "${role}" and accessible name "${accessibleName}" not found in DOM. ${matchType === 'not-contains' ? 'Expected not present - passed.' : 'Expected present - failed.'}`;

        const payload = {
          ref,
          role,
          accessibleName,
          matchType,
          isVisible: false,
          existsInDOM: false,
          searchMethod: searchMethod || 'none',
          summary: {
            total: 1,
            passed: passed ? 1 : 0,
            failed: passed ? 0 : 1,
            status: passed ? 'pass' : 'fail',
            evidence,
          },
          checks: [{
            property: 'visibility',
            operator: matchType,
            expected: matchType === 'contains' ? 'present' : 'not-present',
            actual: 'not-found',
            result: passed ? 'pass' : 'fail',
          }],
        };

        console.log('Validate element:', payload);
        response.addResult(JSON.stringify(payload, null, 2));
        return;
      }

      // Step 4: Element found, determine if test passes based on matchType
      let passed: boolean;
      if (matchType === 'contains') {
        passed = isVisible; // Element must be present AND visible
      } else { // matchType === "not-contains"
        passed = !isVisible; // Element should NOT be visible (can exist in DOM but hidden)
      }

      // Generate evidence message
      if (matchType === 'contains') {
        if (passed)
          evidence = `Element with role "${role}" and accessible name "${accessibleName}" is visible to user as expected (found via ${searchMethod})`;
        else
          evidence = `Element with role "${role}" and accessible name "${accessibleName}" exists in DOM but is not visible to user (found via ${searchMethod})`;

      } else { // matchType === "not-contains"
        if (passed)
          evidence = `Element with role "${role}" and accessible name "${accessibleName}" is not visible to user as expected (found via ${searchMethod})`;
        else
          evidence = `Element with role "${role}" and accessible name "${accessibleName}" is unexpectedly visible to user (found via ${searchMethod})`;

      }

      const payload = {
        ref,
        role,
        accessibleName,
        matchType,
        isVisible,
        existsInDOM: true,
        searchMethod,
        summary: {
          total: 1,
          passed: passed ? 1 : 0,
          failed: passed ? 0 : 1,
          status: passed ? 'pass' : 'fail',
          evidence,
        },
        checks: [{
          property: 'visibility',
          operator: matchType,
          expected: matchType === 'contains' ? 'visible' : 'not-visible',
          actual: isVisible ? 'visible' : 'not-visible',
          result: passed ? 'pass' : 'fail',
        }],
      };

      console.log('Validate element:', payload);
      response.addResult(JSON.stringify(payload, null, 2));

    } catch (error) {
      const errorMessage = `Failed to validate element. Error: ${error instanceof Error ? error.message : String(error)}`;
      const errorPayload = {
        ref: params.ref,
        role: params.role,
        accessibleName: params.accessibleName,
        matchType: params.matchType,
        isVisible: false,
        existsInDOM: false,
        searchMethod: 'error',
        summary: {
          total: 1,
          passed: 0,
          failed: 1,
          status: 'fail',
          evidence: errorMessage,
        },
        checks: [{
          property: 'visibility',
          operator: 'visible',
          expected: 'visible',
          actual: 'error',
          result: 'fail',
        }],
        error: error instanceof Error ? error.message : String(error),
      };

      console.error('Validate element error:', errorPayload);
      response.addResult(JSON.stringify(errorPayload, null, 2));
    }
  },
});


const makeRequestSchema = z.object({
  command: z.string().describe('Actual finalized command'),
  evidence: z.string().describe('Command description'),
});

const make_request = defineTabTool({
  capability: 'core',
  schema: {
    name: 'make_request',
    title: 'Make HTTP request using curl command',
    description: 'Execute a curl command to make HTTP requests and return the response',
    inputSchema: makeRequestSchema,
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    const { command, evidence } = makeRequestSchema.parse(params);


    let toolResult = {
      success: false,
      apiResponse: {
        stdout: '',
        stderr: ''
      }
    };

    try {
      const result = await runCommand(command);
      toolResult = {
        success: true,
        apiResponse: result
      };
    } catch (error) {
      toolResult = {
        success: false,
        apiResponse: {
          stdout: '',
          stderr: error instanceof Error ? error.message : String(error)
        }
      };
    }

    response.addResult(JSON.stringify(toolResult, null, 2));
  },
});


export default [
  extract_svg_from_element,
  extract_image_urls,
  validate_computed_styles,
  validate_element_text,
  validate_dom_properties,
  validate_element,
  validate_alert_in_snapshot,
  default_validation,
  validate_response,
  validate_tab_exist,
  generate_locator,
  make_request,
  // data_extraction,
];
