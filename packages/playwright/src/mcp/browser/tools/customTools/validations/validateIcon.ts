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

import { z } from 'playwright-core/lib/mcpBundle';
import { expect } from '@zealous-tech/playwright/test';
import { defineTabTool } from '../../tool';
import { generateLocatorString } from '../helpers/helpers';
import {
  lookupNotification,
  notificationLocatorExpressions,
  readNotifications,
} from '../helpers/notificationBuffer';
import { getTimeout } from '../helpers/utils';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

type IconType = 'svg' | 'img' | 'background' | 'font' | 'datauri' | 'unknown';

interface ExtractedIcon {
    iconType: IconType;
    iconData: string;
    colors: string[];
    imageLoaded: boolean;
}

interface ExpectedIcon {
    iconType: IconType;
    iconData?: string;
    colors?: string[];
}

const DATAURI_ICON_DATA_PLACEHOLDER =
    'Base64-encoded image data (omitted). Verify the icon via iconType and other properties, not iconData.';

function isBase64IconData(iconType: IconType, iconData: string): boolean {
    return /;base64,/i.test(iconData)
        || (iconType === 'datauri' && iconData.startsWith('data:') && iconData.includes('base64'));
}

function summarizeIconDataForResponse(iconType: IconType, iconData: string): string {
    if (isBase64IconData(iconType, iconData)) {
        return DATAURI_ICON_DATA_PLACEHOLDER;
    }
    return iconData;
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
    let imageLoaded = false;

    if (element.tagName.toLowerCase() === 'svg') {
        iconType = 'svg';
        iconData = normalizeSVG(element.outerHTML);
        if (options.includeColors) {
            colors = extractColors(element);
        }
        imageLoaded = true;
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

    }
    else {
        const computedStyle = window.getComputedStyle(element);
        const backgroundImage = computedStyle.backgroundImage;

        const firstUrl = (v: string): string => {
            if (!v || v === 'none') return '';
            const m = v.match(/url\(['"]?([^'"]*?)['"]?\)/);
            return (m && m[1]) ? m[1] : '';
        };
        const maskOrBgUrl =
            firstUrl(computedStyle.getPropertyValue('mask-image')) ||
            firstUrl(computedStyle.getPropertyValue('-webkit-mask-image')) ||
            firstUrl(computedStyle.getPropertyValue('mask')) ||
            firstUrl(computedStyle.getPropertyValue('--t-icon')) ||
            firstUrl(computedStyle.getPropertyValue('--tui-icon')) ||
            firstUrl(backgroundImage);

        if (maskOrBgUrl) {
            if (maskOrBgUrl.startsWith('data:')) {
                iconType = 'datauri';
                iconData = maskOrBgUrl;
            } else {
                iconType = 'background';
                iconData = maskOrBgUrl;
            }
            imageLoaded = true;
            if (options.includeColors) {
                colors = extractColors(element);
            }
        }
        else {
            const classList = Array.from(element.classList);
            const iconFontPatterns = [
                /^fa-/, /^fas-/, /^far-/, /^fal-/, /^fab-/,
                /^material-icons/, /^mi-/,
                /^icon-/, /^glyphicon-/, /^t-icon/, /^tui-icon/,
            ];

            const tag = element.tagName.toLowerCase();
            const hasIconFont = classList.some(cls =>
                iconFontPatterns.some(pattern => pattern.test(cls))
            ) || tag === 'tui-icon' || tag === 'mat-icon' || tag === 'ion-icon';

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

    // Compare icon data based on type (skipped if expectedIcon.iconData is not provided)
    if (isBase64IconData(actualIcon.iconType, actualIcon.iconData)) {
        // Base64 data URIs are not compared — verify via iconType and other properties
    } else if (expectedIcon.iconData !== undefined) {
        if (actualIcon.iconType === 'img' || actualIcon.iconType === 'background') {
            if (actualIcon.iconData !== expectedIcon.iconData) {
                passed = false;
                comparisonDetails.push(`Image URL mismatch: expected "${expectedIcon.iconData}", got "${actualIcon.iconData}"`);
            }
        } else if (actualIcon.iconType === 'svg') {
            if (actualIcon.iconData !== expectedIcon.iconData) {
                passed = false;
                comparisonDetails.push(`SVG content mismatch`);
            }
        } else {
            if (actualIcon.iconData !== expectedIcon.iconData) {
                passed = false;
                comparisonDetails.push(`Icon data mismatch`);
            }
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
 * Generate instruction message for LLM follow-up.
 * Extracted data is already in the `extractedIcon` field — do not repeat it here.
 */
function generateExtractionMessage(actualIcon: ExtractedIcon): string {
    if (isBase64IconData(actualIcon.iconType, actualIcon.iconData)) {
        return `The icon is embedded as base64 image data. Do not analyze iconData — verify the icon via iconType and colors. If it matches, call validate_icon again with extractedIcon as expectedIcon to cache it.`;
    }
    if (actualIcon.iconType === 'svg') {
        return `Analyze the SVG markup in extractedIcon.iconData to determine if it matches the validation requirement. If it matches, call validate_icon again with extractedIcon as expectedIcon to cache it.`;
    }
    if (actualIcon.iconType === 'img') {
        return `Analyze the image URL in extractedIcon.iconData (filename/path) to determine if it matches the validation requirement. If it matches, call validate_icon again with extractedIcon as expectedIcon to cache it.`;
    }
    return `Analyze the extracted data in extractedIcon to determine if it matches the validation requirement. If it matches, call validate_icon again with extractedIcon as expectedIcon to cache it.`;
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
}): Array<{ command: string; message: string }> {
    return [{
        command: JSON.stringify({
            toolName: params.toolName,
            ...(params.mode && { mode: params.mode }),
            ...(params.locator && { locator: params.locator }),
            ...(params.arguments && { arguments: params.arguments }),
        }),
        message: params.message,
    }];
}

/**
 * Create error payload structure
 */
function createErrorPayload(params: {
    ref: string;
    element: string;
    expectedIcon?: ExpectedIcon;
    actualIcon?: any;
    evidence: Array<{ command: string; message: string }>;
    error?: string;
    resolvedLocator?: string;
}) {
    return {
        ref: params.ref,
        element: params.element,
        ...(params.expectedIcon && { expectedIcon: params.expectedIcon }),
        ...(params.resolvedLocator ? { resolvedLocator: params.resolvedLocator } : {}),
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
 * Create payload structure for extraction mode
 */
function createExtractionPayload(params: {
    ref: string;
    element: string;
    extractedIcon: { iconType: IconType; iconData: string; colors: string[] };
    message: string;
    resolvedLocator?: string;
}) {
    return {
        ref: params.ref,
        element: params.element,
        extractedIcon: params.extractedIcon,
        message: params.message,
        ...(params.resolvedLocator ? { resolvedLocator: params.resolvedLocator } : {}),
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
    resolvedLocator?: string;
}) {
    return {
        ref: params.ref,
        element: params.element,
        expectedIcon: params.expectedIcon,
        ...(params.resolvedLocator ? { resolvedLocator: params.resolvedLocator } : {}),
        actualIcon: {
            iconType: params.actualIcon.iconType,
            iconData: summarizeIconDataForResponse(
                params.actualIcon.iconType,
                params.actualIcon.iconData.length > 200 && !isBase64IconData(params.actualIcon.iconType, params.actualIcon.iconData)
                    ? params.actualIcon.iconData.substring(0, 200) + '...'
                    : params.actualIcon.iconData,
            ),
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
  ref: z.string().optional().describe('Snapshot ref (e.g. e12) or Playwright locator. For a toast icon (with notificationText): Playwright locator, never a snapshot e-ref. A concrete locator must match the observer-captured notification locator.'),
  notificationText: z.string().optional().describe('Toast/snackbar/notification message. Pass with ref as a Playwright locator. Uses the appear-time captured icon. Keep both on the follow-up call with expectedIcon.'),
  withinMs: z.number().int().positive().optional().describe('Lookback window in milliseconds for notificationText (default 15000). Ignored for live elements.'),
  expectedIcon: z.object({
    iconType: z.enum(['svg', 'img', 'background', 'font', 'datauri', 'unknown']).describe('Type of icon'),
    iconData: z.string().optional().describe('Icon data: SVG markup, image URL, font character, or non-base64 data URI. Omit for base64 data URIs — they are not compared.'),
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
  if (!expectedIcon) {
    // Extraction mode — simple error
    response.addTextResult(JSON.stringify({
      ref,
      element,
      error: `UI element "${element}" not found`,
    }, null, 2));
    return;
  }

  // Validation mode — full error payload with evidence
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

  response.addTextResult(JSON.stringify(errorPayload, null, 2));
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
  response: any,
  notificationText?: string,
  resolvedLocator?: string
): void {
  // Check if image loaded successfully
  if (!actualIcon.imageLoaded) {
    response.addTextResult(JSON.stringify({
      ref,
      element,
      error: `Failed to extract icon from element "${element}": Image not loaded or broken image detected.`,
    }, null, 2));
    return;
  }

  // Prepare extracted icon data for LLM
  const extractedIconData = {
    iconType: actualIcon.iconType,
    iconData: summarizeIconDataForResponse(actualIcon.iconType, actualIcon.iconData),
    colors: actualIcon.colors,
  };

  // Generate extraction message with context for LLM
  let extractionMessage = generateExtractionMessage(actualIcon);
  if (notificationText) {
    const followUpRef = resolvedLocator ? resolvedLocator : ref;
    extractionMessage += `\n\nThis icon was captured from the transient notification "${notificationText}". On the follow-up call keep notificationText: ${JSON.stringify(notificationText)} and ref: ${JSON.stringify(followUpRef)}. Call validate_icon ONLY with expectedIcon — do NOT call validate_notification again.`;
  }


  const payload = createExtractionPayload({
    ref,
    element,
    extractedIcon: extractedIconData,
    message: extractionMessage,
    resolvedLocator,
  });

  response.addTextResult(JSON.stringify(payload, null, 2));
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
  response: any,
  resolvedLocator?: string
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

    response.addTextResult(JSON.stringify(failurePayload, null, 2));
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
    resolvedLocator,
  });

  response.addTextResult(JSON.stringify(payload, null, 2));
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
  const errorMessage = error instanceof Error ? error.message : String(error);

  if (!expectedIcon) {
    // Extraction mode — simple error
    response.addTextResult(JSON.stringify({
      ref,
      element,
      error: `Failed to extract icon for element "${element}". Error: ${errorMessage}`,
    }, null, 2));
    return;
  }

  // Validation mode — full error payload with evidence
  let locatorString = '';
  try {
    const { locator } = await tab.refLocator({ ref, element });
    locatorString = await generateLocatorString(ref, locator);
  } catch {
    locatorString = '';
  }

  const evidence = createEvidence({
    toolName: 'validate_icon',
    locator: locatorString,
    arguments: { expectedIcon },
    message: `Failed to validate icon for element "${element}". Error: ${errorMessage}`,
  });

  const errorPayload = createErrorPayload({
    ref,
    element,
    expectedIcon,
    evidence,
    error: errorMessage,
  });

  response.addTextResult(JSON.stringify(errorPayload, null, 2));
}

const NOTIFICATION_BUFFER_REF = 'notification-buffer';
const DEFAULT_NOTIFICATION_LOOKBACK_MS = 15000;

async function handleNotificationMode(
  tab: any,
  element: string,
  notificationText: string,
  withinMs: number,
  expectedIcon: ExpectedIcon | undefined,
  ignoreColors: boolean,
  response: any,
  ref?: string
): Promise<void> {
  const { notifications, observerInstalled } = await readNotifications(tab.page, withinMs, {
    includeIcon: true,
    matchText: notificationText,
  });
  const { hit, locatorMismatch } = lookupNotification(notifications, notificationText, ref);
  const { toast, icon } = notificationLocatorExpressions(hit);
  const resolvedLocator = toast || ref;
  const locatorString = icon || toast || `notificationBuffer(${JSON.stringify(notificationText)})`;
  const payloadRef = ref || NOTIFICATION_BUFFER_REF;

  if (locatorMismatch || !hit || !hit.icon || typeof hit.icon.iconData !== 'string') {
    let message: string;
    if (locatorMismatch)
      message = `A notification containing "${notificationText}" DID appear, but it was not found via the provided locator (${ref}). The notification's real locator is ${toast || 'unknown'}.`;
    else if (!observerInstalled)
      message = `Cannot validate the icon of notification "${notificationText}": the notification observer was not installed on this page.`;
    else if (!hit)
      message = `No notification containing "${notificationText}" was captured within ${withinMs}ms, so its icon could not be validated.`;
    else
      message = `Notification "${hit.text}" was captured, but it had no icon at the moment it appeared.`;

    response.addTextResult(JSON.stringify(createErrorPayload({
      ref: payloadRef,
      element,
      expectedIcon,
      evidence: createEvidence({
        toolName: 'validate_icon',
        locator: locatorString,
        arguments: { notificationText, withinMs, expectedIcon, ...(ref ? { ref } : {}) },
        message,
      }),
      resolvedLocator,
    }), null, 2));
    return;
  }

  const actualIcon: ExtractedIcon = {
    iconType: hit.icon.iconType,
    iconData: hit.icon.iconData,
    colors: ignoreColors ? [] : (hit.icon.colors || []),
    imageLoaded: true,

  };

  if (!expectedIcon)
    handleExtractionMode(payloadRef, element, actualIcon, locatorString, response, notificationText, resolvedLocator);
  else
    handleValidationMode(payloadRef, element, actualIcon, expectedIcon, ignoreColors, locatorString, response, resolvedLocator);
}

export const validate_icon = defineTabTool({
  capability: 'core',
  schema: {
    name: 'validate_icon',
    title: 'Validate Icon',
    description: 'Extract and/or validate icon data. Without expectedIcon, extracts current icon data. With expectedIcon, compares type, data, and colors. For a toast/notification icon, pass notificationText and ref as a Playwright locator (not a snapshot e-ref).',
    inputSchema: validateIconSchema,
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    const { ref, element, expectedIcon, ignoreColors, notificationText, withinMs } = validateIconSchema.parse(params);

    await tab.waitForCompletion(async () => {
      try {
        if (notificationText) {
          await handleNotificationMode(tab, element, notificationText, withinMs ?? DEFAULT_NOTIFICATION_LOOKBACK_MS, expectedIcon, ignoreColors, response, ref);
          return;
        }

        if (!ref) {
          const evidence = createEvidence({
            toolName: 'validate_icon',
            arguments: { element, expectedIcon },
            message: `Cannot validate icon for "${element}": provide "ref" for a page element, or "notificationText" with a Playwright locator in "ref" for a toast/notification icon.`,
          });
          response.addTextResult(JSON.stringify(createErrorPayload({
            ref: '',
            element,
            expectedIcon,
            evidence,
          }), null, 2));
          return;
        }

        // Step 1: Locate the element
        const { locator } = await tab.refLocator({ ref, element });

        // Step 2: Verify element is attached to DOM
        try {
          await expect(locator).toBeAttached({ timeout: getTimeout(tab.context) });
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
        await handleValidationError(ref ?? NOTIFICATION_BUFFER_REF, element, expectedIcon, error, tab, response);
      }
    });
  },
});

