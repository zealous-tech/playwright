/**
 * ICON VALIDATION TOOL
 *
 * This tool provides two modes of operation:
 *
 * 1. EXTRACTION MODE (no expectedIcon provided):
 *    - Extracts current icon data from the page element
 *    - Returns icon metadata for LLM analysis
 *    - LLM decides if icon matches requirements and calls again in validation mode
 *
 * 2. VALIDATION MODE (expectedIcon provided):
 *    - Compares current icon data with expected/cached icon data
 *    - Returns pass/fail result with comparison details
 *    - Validates: icon type, icon data (URL/SVG/font), and optionally colors
 *
 * ARCHITECTURE:
 * - extractIconFunction: Browser-side function that extracts icon data from DOM
 * - compareIcons: Compares extracted icon with expected icon
 * - handleExtractionMode: Processes extraction mode flow
 * - handleValidationMode: Processes validation mode flow
 * - createEvidence/Payload helpers: Standardize response format
 */

import { z } from 'zod';
import { expect } from '@zealous-tech/playwright/test';
import { defineTabTool } from '../../tool';
import { generateLocatorString } from '../helpers/helpers';
import { ELEMENT_ATTACHED_TIMEOUT } from '../helpers/utils';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

type IconType = 'svg' | 'img' | 'background' | 'font' | 'datauri' | 'unknown';

interface ExtractedIcon {
    iconType: IconType;
    iconData: string;
    colors: string[];
    imageLoaded: boolean;
    visualData: string | null;
}

interface ExpectedIcon {
    iconType: IconType;
    iconData: string;
    colors?: string[];
}

// ============================================================================
// BROWSER-SIDE ICON EXTRACTION
// ============================================================================

/**
 * Extract icon data from an element
 * Note: This function is self-contained and includes all helper functions inline
 * because it will be serialized and executed in the browser context via locator.evaluate()
 */
function extractIconFunction(element: Element, options: { includeColors: boolean }): ExtractedIcon {
    // Helper: Verify if an image element is fully loaded and accessible
    const verifyImageLoaded = (imgElement: HTMLImageElement): boolean => {
        // Check if image is fully loaded and has valid dimensions
        // This works for both same-origin and cross-origin images (no CORS issue)
        return imgElement.complete && imgElement.naturalWidth > 0 && imgElement.naturalHeight > 0;
    };

    // Helper: Extract colors from an element's computed styles
    const extractColors = (el: Element): string[] => {
        const colors = new Set<string>();
        const computedStyle = window.getComputedStyle(el);

        ['color', 'fill', 'stroke', 'background-color'].forEach(prop => {
            const value = computedStyle.getPropertyValue(prop);
            if (value && value !== 'none' && value !== 'transparent' && !value.includes('rgba(0, 0, 0, 0)')) {
                colors.add(value);
            }
        });

        if (el.tagName.toLowerCase() === 'svg') {
            el.querySelectorAll('*').forEach(child => {
                const childStyle = window.getComputedStyle(child);
                ['fill', 'stroke'].forEach(prop => {
                    const value = childStyle.getPropertyValue(prop);
                    if (value && value !== 'none' && value !== 'transparent') {
                        colors.add(value);
                    }
                });
            });
        }

        return Array.from(colors);
    };

    // Helper: Normalize SVG string by removing size attributes and extra whitespace
    const normalizeSVG = (svgString: string): string => {
        const normalized = svgString
            .replace(/\s+/g, ' ')
            .replace(/width="[^"]*"/gi, '')
            .replace(/height="[^"]*"/gi, '')
            .trim();
        return normalized;
    };
    
    let iconType: IconType = 'unknown';
    let iconData = '';
    let colors: string[] = [];
    let imageLoaded = false;  // Track if image exists and is loaded
    let visualData: string | null = null;  // Only for SVG icons (send SVG markup to LLM)

    if (element.tagName.toLowerCase() === 'svg') {
        iconType = 'svg';
        iconData = normalizeSVG(element.outerHTML);
        if (options.includeColors) {
            colors = extractColors(element);
        }
        imageLoaded = true;
        visualData = iconData;  // Send SVG markup to LLM for analysis
    }
    else if (element.querySelector('svg')) {
        const svgElement = element.querySelector('svg');
        if (svgElement) {
            iconType = 'svg';
            iconData = normalizeSVG(svgElement.outerHTML);
            if (options.includeColors) {
                colors = extractColors(svgElement);
            }
            imageLoaded = true;
            visualData = iconData;  // Send SVG markup to LLM for analysis
        }
    }
    else if (element.tagName.toLowerCase() === 'img') {
        const imgElement = element as HTMLImageElement;
        const src = imgElement.src;

        // Verify image is loaded
        imageLoaded = verifyImageLoaded(imgElement);

        if (src.startsWith('data:')) {
            iconType = 'datauri';
            iconData = src;
        } else {
            iconType = 'img';
            iconData = src;  // Just the URL
        }

        // For images: DO NOT send visual data, only URL
        // LLM will analyze based on URL/filename only
        visualData = null;
    }
    else {
        const computedStyle = window.getComputedStyle(element);
        const backgroundImage = computedStyle.backgroundImage;

        if (backgroundImage && backgroundImage !== 'none') {
            const urlMatch = backgroundImage.match(/url\(['"]?([^'"]*?)['"]?\)/);
            if (urlMatch && urlMatch[1]) {
                const bgUrl = urlMatch[1];
                if (bgUrl.startsWith('data:')) {
                    iconType = 'datauri';
                    iconData = bgUrl;
                } else {
                    iconType = 'background';
                    iconData = bgUrl;
                }
                imageLoaded = true;  // Assume background images are loaded
                if (options.includeColors) {
                    colors = extractColors(element);
                }
            }
        }
        else {
            const classList = Array.from(element.classList);
            const iconFontPatterns = [
                /^fa-/, /^fas-/, /^far-/, /^fal-/, /^fab-/,
                /^material-icons/, /^mi-/,
                /^icon-/, /^glyphicon-/,
            ];

            const hasIconFont = classList.some(cls =>
                iconFontPatterns.some(pattern => pattern.test(cls))
            );

            if (hasIconFont) {
                iconType = 'font';
                const content = window.getComputedStyle(element, '::before').content ||
                    window.getComputedStyle(element).content ||
                    element.textContent || '';
                iconData = `${classList.join(' ')}:${content}`;
                imageLoaded = true;  // Font icons are considered "loaded"
                if (options.includeColors) {
                    colors = extractColors(element);
                }
            }
            else if (element.textContent && element.textContent.trim()) {
                const text = element.textContent.trim();
                if (text.length <= 2 || /[\u{1F300}-\u{1F9FF}]/u.test(text)) {
                    iconType = 'font';
                    iconData = text;
                    imageLoaded = true;
                    if (options.includeColors) {
                        colors = extractColors(element);
                    }
                }
            }
        }
    }

    return {
        iconType,
        iconData,
        colors: options.includeColors ? colors : [],
        imageLoaded,
        visualData,
    };
}

// ============================================================================
// ICON COMPARISON LOGIC
// ============================================================================

/**
 * Compare two icons and return comparison results
 */
function compareIcons(
    actualIcon: ExtractedIcon,
    expectedIcon: ExpectedIcon,
    ignoreColors: boolean
): { passed: boolean; comparisonDetails: string[] } {
    let passed = true;
    const comparisonDetails: string[] = [];

    // Compare icon type
    if (actualIcon.iconType !== expectedIcon.iconType) {
        passed = false;
        comparisonDetails.push(`Icon type mismatch: expected "${expectedIcon.iconType}", got "${actualIcon.iconType}"`);
    }

    // Compare icon data based on type
    if (actualIcon.iconType === 'img' || actualIcon.iconType === 'background') {
        // For images: EXACT URL comparison only
        if (actualIcon.iconData !== expectedIcon.iconData) {
            passed = false;
            comparisonDetails.push(`Image URL mismatch: expected "${expectedIcon.iconData}", got "${actualIcon.iconData}"`);
        }
    } else if (actualIcon.iconType === 'svg') {
        // For SVG: Direct comparison
        if (actualIcon.iconData !== expectedIcon.iconData) {
            passed = false;
            comparisonDetails.push(`SVG content mismatch`);
        }
    } else {
        // For other types (font, datauri): Direct comparison
        if (actualIcon.iconData !== expectedIcon.iconData) {
            passed = false;
            comparisonDetails.push(`Icon data mismatch`);
        }
    }

    // Compare colors if not ignoring them
    if (!ignoreColors && expectedIcon.colors && expectedIcon.colors.length > 0) {
        const expectedColors = new Set(expectedIcon.colors);
        const actualColors = new Set(actualIcon.colors);

        const missingColors = Array.from(expectedColors).filter(c => !actualColors.has(c));
        const extraColors = Array.from(actualColors).filter(c => !expectedColors.has(c));

        if (missingColors.length > 0 || extraColors.length > 0) {
            passed = false;
            if (missingColors.length > 0) {
                comparisonDetails.push(`Missing colors: ${missingColors.join(', ')}`);
            }
            if (extraColors.length > 0) {
                comparisonDetails.push(`Extra colors: ${extraColors.join(', ')}`);
            }
        }
    }

    return { passed, comparisonDetails };
}

// ============================================================================
// MESSAGE GENERATION
// ============================================================================

/**
 * Generate evidence message based on icon comparison result
 */
function generateEvidenceMessage(
    passed: boolean,
    actualIcon: ExtractedIcon,
    expectedIcon: ExpectedIcon,
    ignoreColors: boolean,
    comparisonDetails: string[]
): string {
    if (passed) {
        let message = '';
        if (actualIcon.iconType === 'img') {
            message = `Icon validation passed: Image exists at URL and matches cached URL`;
        } else if (actualIcon.iconType === 'svg') {
            message = `Icon validation passed: SVG icon matches cached content`;
        } else {
            message = `Icon validation passed: ${actualIcon.iconType} icon matches expected icon`;
        }

        if (!ignoreColors && expectedIcon.colors && expectedIcon.colors.length > 0) {
            message += ` with matching colors`;
        }
        return message;
    } else {
        return `Icon validation failed: ${comparisonDetails.join('; ')}`;
    }
}

/**
 * Generate extraction message for LLM follow-up
 */
function generateExtractionMessage(actualIcon: ExtractedIcon, element: string): string {
    const expectedIconForLLM = {
        iconType: actualIcon.iconType,
        iconData: actualIcon.iconData,
        colors: actualIcon.colors,
    };

    let extractionMessage = '';

    if (actualIcon.iconType === 'svg') {
        // For SVG: Send SVG markup to LLM for visual analysis
        extractionMessage = `Successfully extracted SVG icon from element "${element}".\n\n`;
        extractionMessage += `**Icon Type:** SVG\n`;
        extractionMessage += `**SVG Markup:** ${actualIcon.iconData.substring(0, 500)}${actualIcon.iconData.length > 500 ? '...' : ''}\n\n`;
        extractionMessage += `**Extracted Metadata:** ${JSON.stringify(expectedIconForLLM)}\n\n`;
        extractionMessage += `Please analyze the SVG markup to determine if it matches the validation requirement. If it matches, call validate_icon again with this data as expectedIcon to cache it.`;
    } else if (actualIcon.iconType === 'img') {
        // For images: Send only URL for LLM to analyze filename/path
        extractionMessage = `Successfully extracted image icon from element "${element}".\n\n`;
        extractionMessage += `**Icon Type:** Image\n`;
        extractionMessage += `**Image URL:** ${actualIcon.iconData}\n`;
        extractionMessage += `**Image Status:** ✓ Loaded and accessible\n\n`;
        extractionMessage += `**Extracted Metadata:** ${JSON.stringify(expectedIconForLLM)}\n\n`;
        extractionMessage += `Please analyze the URL/filename to determine if it matches the validation requirement. If it matches, call validate_icon again with this data as expectedIcon to cache it.`;
    } else {
        // For other types (font, background, datauri)
        extractionMessage = `Successfully extracted ${actualIcon.iconType} icon from element "${element}".\n\n`;
        extractionMessage += `**Icon Type:** ${actualIcon.iconType}\n`;
        extractionMessage += `**Icon Data:** ${JSON.stringify(expectedIconForLLM)}\n\n`;
        extractionMessage += `Please analyze the extracted data to determine if it matches the validation requirement. If it matches, call validate_icon again with this data as expectedIcon to cache it.`;
    }

    return extractionMessage;
}

// ============================================================================
// PAYLOAD CREATION HELPERS
// ============================================================================

/**
 * Create evidence object with command and message
 */
function createEvidence(params: {
    toolName: string;
    locator?: string;
    mode?: string;
    arguments?: any;
    message: string;
    visualData?: string | null;
}): Array<{ command: string; message: string; visualData?: string | null }> {
    const evidence: any = {
        command: JSON.stringify({
            toolName: params.toolName,
            ...(params.mode && { mode: params.mode }),
            ...(params.locator && { locator: params.locator }),
            ...(params.arguments && { arguments: params.arguments }),
        }),
        message: params.message,
    };
    
    if (params.visualData !== undefined) {
        evidence.visualData = params.visualData;
    }
    
    return [evidence];
}

/**
 * Create error payload structure
 */
function createErrorPayload(params: {
    ref: string;
    element: string;
    expectedIcon?: ExpectedIcon;
    actualIcon?: any;
    evidence: Array<{ command: string; message: string; visualData?: string | null }>;
    error?: string;
}) {
    return {
        ref: params.ref,
        element: params.element,
        ...(params.expectedIcon && { expectedIcon: params.expectedIcon }),
        actualIcon: params.actualIcon || null,
        summary: {
            total: 1,
            passed: 0,
            failed: 1,
            status: 'fail' as const,
            evidence: params.evidence,
        },
        checks: [{
            property: 'icon-validation',
            operator: 'equals',
            expected: params.expectedIcon || null,
            actual: params.actualIcon || null,
            result: 'fail' as const,
        }],
        ...(params.error && { error: params.error }),
    };
}

/**
 * Create success payload structure for extraction mode
 */
function createExtractionPayload(params: {
    ref: string;
    element: string;
    extractedIcon: { iconType: IconType; iconData: string; colors: string[] };
    evidence: Array<{ command: string; message: string; visualData?: string | null }>;
}) {
    return {
        ref: params.ref,
        element: params.element,
        extractedIcon: params.extractedIcon,
        summary: {
            total: 1,
            passed: 1,
            failed: 0,
            status: 'pass' as const,
            evidence: params.evidence,
            extractionMode: true,
            requiresFollowUp: true,
        },
    };
}

/**
 * Create success payload structure for validation mode
 */
function createValidationPayload(params: {
    ref: string;
    element: string;
    expectedIcon: ExpectedIcon;
    actualIcon: ExtractedIcon;
    passed: boolean;
    comparisonDetails: string[];
    evidence: Array<{ command: string; message: string }>;
}) {
    return {
        ref: params.ref,
        element: params.element,
        expectedIcon: params.expectedIcon,
        actualIcon: {
            iconType: params.actualIcon.iconType,
            iconData: params.actualIcon.iconData.length > 200 
                ? params.actualIcon.iconData.substring(0, 200) + '...' 
                : params.actualIcon.iconData,
            colors: params.actualIcon.colors,
            imageLoaded: params.actualIcon.imageLoaded,
        },
        summary: {
            total: 1,
            passed: params.passed ? 1 : 0,
            failed: params.passed ? 0 : 1,
            status: params.passed ? 'pass' as const : 'fail' as const,
            evidence: params.evidence,
        },
        checks: [{
            property: 'icon-validation',
            operator: 'equals',
            expected: params.expectedIcon,
            actual: params.actualIcon,
            result: params.passed ? 'pass' as const : 'fail' as const,
            comparisonDetails: params.comparisonDetails,
        }],
    };
}

// ============================================================================
// TOOL SCHEMA AND DEFINITION
// ============================================================================

const validateIconSchema = z.object({
  element: z.string().describe('Human-readable element description used to obtain permission to interact with the element'),
  ref: z.string().describe('Exact target element reference from the page snapshot'),
  expectedIcon: z.object({
    iconType: z.enum(['svg', 'img', 'background', 'font', 'datauri', 'unknown']).describe('Type of icon'),
    iconData: z.string().describe('Icon data: SVG markup, image URL, font character, or data URI'),
    colors: z.array(z.string()).optional().describe('Array of colors used in the icon (hex, rgb, or named colors)'),
  }).optional().describe('Expected icon data to validate against. If not provided, tool will extract and return current icon data for analysis. If provided, tool will validate current icon matches expected icon.'),
  ignoreColors: z.boolean().optional().default(false).describe('Whether to ignore color differences in validation'),
});

// ============================================================================
// MODE HANDLERS (Extraction, Validation, Error)
// ============================================================================

/**
 * Handle element not found scenario
 * Returns error payload when element cannot be located or is not attached to DOM
 */
async function handleElementNotFound(
  ref: string,
  element: string,
  locatorString: string,
  expectedIcon: ExpectedIcon | undefined,
  response: any
): Promise<void> {
  const evidence = createEvidence({
    toolName: 'validate_icon',
    locator: locatorString,
    arguments: { expectedIcon },
    message: `UI element "${element}" not found`,
  });

  const errorPayload = createErrorPayload({
    ref,
    element,
    expectedIcon,
    evidence,
  });

  response.addResult(JSON.stringify(errorPayload, null, 2));
}

/**
 * Handle extraction mode (no expectedIcon provided)
 * Extracts current icon data and returns it for LLM analysis
 */
function handleExtractionMode(
  ref: string,
  element: string,
  actualIcon: ExtractedIcon,
  locatorString: string,
  response: any
): void {
  // Check if image loaded successfully
  if (!actualIcon.imageLoaded) {
    const failureEvidence = createEvidence({
      toolName: 'validate_icon',
      mode: 'extraction',
      locator: locatorString,
      arguments: { ref, element },
      message: `Failed to extract icon from element "${element}": Image not loaded or broken image detected.`,
    });

    const failurePayload = createErrorPayload({
      ref,
      element,
      evidence: failureEvidence,
    });

    response.addResult(JSON.stringify(failurePayload, null, 2));
    return;
  }

  // Prepare extracted icon data for LLM
  const extractedIconData = {
    iconType: actualIcon.iconType,
    iconData: actualIcon.iconData,
    colors: actualIcon.colors,
  };

  // Generate extraction message with context for LLM
  const extractionMessage = generateExtractionMessage(actualIcon, element);

  const evidence = createEvidence({
    toolName: 'validate_icon',
    mode: 'extraction',
    locator: locatorString,
    arguments: { ref, element },
    message: extractionMessage,
    visualData: actualIcon.visualData,
  });

  const payload = createExtractionPayload({
    ref,
    element,
    extractedIcon: extractedIconData,
    evidence,
  });

  response.addResult(JSON.stringify(payload, null, 2));
}

/**
 * Handle validation mode (expectedIcon provided)
 * Compares current icon with expected icon and returns validation result
 */
function handleValidationMode(
  ref: string,
  element: string,
  actualIcon: ExtractedIcon,
  expectedIcon: ExpectedIcon,
  ignoreColors: boolean,
  locatorString: string,
  response: any
): void {
  // Check if image is loaded (critical for img types)
  if (actualIcon.iconType === 'img' && !actualIcon.imageLoaded) {
    const failureEvidence = createEvidence({
      toolName: 'validate_icon',
      locator: locatorString,
      arguments: { expectedIcon, ignoreColors },
      message: `Icon validation failed: Image not loaded or broken image at URL "${actualIcon.iconData}"`,
    });

    const failurePayload = createErrorPayload({
      ref,
      element,
      expectedIcon,
      actualIcon: {
        iconType: actualIcon.iconType,
        iconData: actualIcon.iconData,
        imageLoaded: actualIcon.imageLoaded,
      },
      evidence: failureEvidence,
    });

    response.addResult(JSON.stringify(failurePayload, null, 2));
    return;
  }

  // Perform icon comparison
  const { passed, comparisonDetails } = compareIcons(actualIcon, expectedIcon, ignoreColors);

  // Generate human-readable evidence message
  const evidenceMessage = generateEvidenceMessage(passed, actualIcon, expectedIcon, ignoreColors, comparisonDetails);

  const evidence = createEvidence({
    toolName: 'validate_icon',
    locator: locatorString,
    arguments: { expectedIcon, ignoreColors },
    message: evidenceMessage,
  });

  const payload = createValidationPayload({
    ref,
    element,
    expectedIcon,
    actualIcon,
    passed,
    comparisonDetails,
    evidence,
  });

  response.addResult(JSON.stringify(payload, null, 2));
}

/**
 * Handle unexpected errors during icon validation
 * Returns error payload with diagnostic information
 */
async function handleValidationError(
  ref: string,
  element: string,
  expectedIcon: ExpectedIcon | undefined,
  error: unknown,
  tab: any,
  response: any
): Promise<void> {
  const errorMessage = `Failed to validate icon for element "${element}". Error: ${error instanceof Error ? error.message : String(error)}`;

  // Try to get locator string for better error reporting
  let locatorString = '';
  try {
    const locator = await tab.refLocator({ ref, element });
    locatorString = await generateLocatorString(ref, locator);
  } catch {
    locatorString = '';
  }

  const evidence = createEvidence({
    toolName: 'validate_icon',
    locator: locatorString,
    arguments: { expectedIcon },
    message: errorMessage,
  });

  const errorPayload = createErrorPayload({
    ref,
    element,
    expectedIcon,
    evidence,
    error: error instanceof Error ? error.message : String(error),
  });

  response.addResult(JSON.stringify(errorPayload, null, 2));
}

export const validateIcon = defineTabTool({
  capability: 'core',
  schema: {
    name: 'validate_icon',
    title: 'Validate Icon',
    description: 'Extract and/or validate icon data. If expectedIcon is not provided, extracts current icon data for LLM analysis. If expectedIcon is provided, validates current icon matches expected icon (compares type, data, and colors; size differences are ignored).',
    inputSchema: validateIconSchema,
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    const { ref, element, expectedIcon, ignoreColors } = validateIconSchema.parse(params);
    
    await tab.waitForCompletion(async () => {
      try {
        // Step 1: Locate the element
        const locator = await tab.refLocator({ ref, element });

        // Step 2: Verify element is attached to DOM
        try {
          await expect(locator).toBeAttached({ timeout: ELEMENT_ATTACHED_TIMEOUT });
        } catch (error) {
          const locatorString = await generateLocatorString(ref, locator);
          await handleElementNotFound(ref, element, locatorString, expectedIcon, response);
          return;
        }

        // Step 3: Generate locator string for evidence
        const locatorString = await generateLocatorString(ref, locator);

        // Step 4: Extract current icon data from the page
        const actualIcon = await locator.evaluate(extractIconFunction, { includeColors: !ignoreColors });

        // Step 5: Process based on mode (extraction vs validation)
        if (!expectedIcon) {
          // EXTRACTION MODE: Extract icon data for LLM analysis
          handleExtractionMode(ref, element, actualIcon, locatorString, response);
        } else {
          // VALIDATION MODE: Compare current icon with expected icon
          handleValidationMode(ref, element, actualIcon, expectedIcon, ignoreColors, locatorString, response);
        }

      } catch (error) {
        // Handle any unexpected errors
        await handleValidationError(ref, element, expectedIcon, error, tab, response);
      }
    });
  },
});

