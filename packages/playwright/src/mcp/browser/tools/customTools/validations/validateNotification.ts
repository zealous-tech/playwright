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
// @ZEALOUS UPDATE
import { defineTabTool } from '../../tool';
import { checkTextExistenceInAllFrames, collectAllFrames, resolveLocator } from '../helpers/helpers';
import {
  isSemanticLocator,
  normalizeLocatorForCompare,
  stripLocatorPrefix,
  toLocatorExpression,
} from '../helpers/notificationBuffer';
import { getTimeout } from '../helpers/utils';
import { validateNotificationSchema } from '../helpers/schemas';

type CapturedNotification = { text: string; role: string; ts: number; locator?: string };

/**
 * Best-effort live-DOM lookup for a notification via an explicit Playwright locator.
 *
 * Notifications usually render in a portal at the document root, so the main frame is checked first,
 * then any child frames. Uses `isVisible()` (no long autowait) because a transient toast is either
 * on screen now or already gone — the captured buffer covers the "already gone" case, so this must
 * stay fast and never block on the full locator timeout. Returns whether a matching element is
 * visible and its trimmed text (for text comparison by the caller).
 */
async function findNotificationByLocator(
  page: any,
  locator: string
): Promise<{ found: boolean; text: string }> {
  const frames: any[] = [page];
  try {
    for (const info of await collectAllFrames(page, 0)) frames.push(info.frame);
  } catch {
    /* fall back to main frame only */
  }
  for (const frame of frames) {
    try {
      const loc = resolveLocator(frame, locator).first();
      if (!(await loc.isVisible().catch(() => false))) continue;
      const text =
        (await loc.innerText().catch(() => '')) ||
        (await loc.textContent().catch(() => '')) ||
        '';
      return { found: true, text: text.trim() };
    } catch {
      /* invalid expression in this frame or detached — try the next */
    }
  }
  return { found: false, text: '' };
}

/**
 * Validate transient notifications (toasts / snackbars / aria-live messages).
 *
 * Unlike text/DOM validations that only inspect the *live* DOM, this tool reads the notification
 * buffer maintained by the persistent in-page observer (`window.__ottoReadNotifications`). That
 * buffer records notifications the instant they appear, so a toast that already auto-dismissed
 * (e.g. a 2-3s toast that is gone by the time validation runs) can still be asserted here.
 *
 * The check passes if the expected text is found in the captured buffer OR still present in the live
 * DOM (so it works whether the notification is gone or still visible). For 'not-contains' it passes
 * only when the text is absent from BOTH sources.
 */
export const validate_notification = defineTabTool({
  capability: 'core',
  schema: {
    name: 'validate_notification',
    title: 'Validate transient notification',
    description:
      'Validate that a transient notification (toast, snackbar, alert banner, aria-live message) with the given text appeared, even if it has already disappeared from the page. Reads a live-captured notification buffer, so short-lived notifications that vanish before other validations run can still be verified.',
    inputSchema: validateNotificationSchema,
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    const { element, expectedText: rawExpectedText, matchType, withinMs, locator: rawLocator } =
      validateNotificationSchema.parse(params);

    // `locator` is required, but stay defensive: the hub may rewrite a reusable locator to a
    // "###code<expr>" form, so strip that prefix to get the bare Playwright expression. A missing or
    // blank value is treated as absent (the buffer + text search still cover validation).
    const locator: string | undefined = stripLocatorPrefix(rawLocator);

    const expectedText: string | string[] = (() => {
      const trimmed = rawExpectedText.trim();
      if (trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) return parsed as string[];
        } catch {
          /* fall through to raw string */
        }
      }
      return rawExpectedText;
    })();

    const expectedTerms: string[] = (Array.isArray(expectedText) ? expectedText : [expectedText])
      .map(t => String(t).trim())
      .filter(t => t.length > 0);
    const displayText = expectedTerms.join(' | ');

    const normalize = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
    const matchesTerm = (haystack: string): boolean => {
      const h = normalize(haystack);
      return expectedTerms.some(term => {
        const t = normalize(term);
        if (!t) return false;
        return matchType === 'exact' ? h === t : h.includes(t);
      });
    };

    await tab.waitForCompletion(async () => {
      // 1. Read the live-captured notification buffer (may be null if observer not installed).
      let captured: CapturedNotification[] | null = null;
      let observerInstalled = true;
      try {
        captured = await tab.page.evaluate((ms: number) => {
          const w = window as unknown as {
            __ottoReadNotifications?: (sinceMs: number) => CapturedNotification[];
          };
          return typeof w.__ottoReadNotifications === 'function'
            ? w.__ottoReadNotifications(ms)
            : null;
        }, withinMs);
      } catch {
        captured = null;
      }
      if (captured === null) {
        observerInstalled = false;
        captured = [];
      }

      // De-duplicate captured notifications by normalized text (observer may record repeats).
      const seen = new Set<string>();
      const uniqueCaptured: CapturedNotification[] = [];
      for (const n of captured) {
        if (!n || typeof n.text !== 'string') continue;
        const key = normalize(n.text);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        uniqueCaptured.push(n);
      }

      const bufferHits = uniqueCaptured.filter(n => matchesTerm(n.text));
      const bufferPresent = bufferHits.length > 0;

      // Prefer the REAL, DOM-derived locator the observer captured the instant the notification
      // appeared (verified against the live DOM at capture time) over the model's best-effort guess.
      // Prefer a locator from a text-matching hit, else any captured notification with one.
      const capturedSelector =
        (bufferHits.find(n => typeof n.locator === 'string' && n.locator.trim())?.locator ||
          uniqueCaptured.find(n => typeof n.locator === 'string' && n.locator.trim())?.locator ||
          '').trim();
      const capturedLocatorExpr = capturedSelector ? toLocatorExpression(capturedSelector) : '';
      // The locator to actually use/record: the real captured one when available, else the caller's.
      const resolvedLocator: string | undefined = capturedLocatorExpr || locator;

      // Verify the caller's locator actually corresponds to the notification. The observer records the
      // notification's REAL, DOM-derived selector, so when a concrete locator is supplied we require it
      // to match that captured selector. This makes the locator meaningful: an edited/garbage locator
      // fails even though the text is present in the live-captured buffer. Semantic getBy* first-guesses
      // are exempt (they are replaced by the captured selector when cached), and this is only enforced
      // when we actually captured a selector to compare against.
      const providedLocatorMismatch =
        !!locator &&
        !isSemanticLocator(locator) &&
        !!capturedSelector &&
        normalizeLocatorForCompare(locator) !== normalizeLocatorForCompare(capturedSelector);

      // 2. Live-DOM fallback: catches notifications still on screen at validation time.
      // A transient notification is either on screen *now* or already gone, so never block on the
      // full locator timeout (that made failing validations hang ~30s). Skip the live check entirely
      // for positive matches once the buffer already confirms the notification.
      const LIVE_DOM_TIMEOUT_MS = 2000;
      let liveCount = 0;
      let liveFrames: string[] = [];
      // Whether an element was visible via the provided locator, regardless of its text. A visible
      // element whose text does NOT match still means "a notification appeared" (mismatch), not
      // "nothing appeared" (empty validation).
      let liveElementVisible = false;
      const skipLiveCheck = bufferPresent && matchType !== 'not-contains';
      if (!skipLiveCheck) {
        // Locator-scoped live check first: precise (only the pointed-at element) and used both to
        // confirm a still-visible notification and to record the locator in evidence.
        let handledByLocator = false;
        if (resolvedLocator) {
          try {
            const live = await findNotificationByLocator(tab.page, resolvedLocator);
            if (live.found) {
              liveElementVisible = true;
              handledByLocator = true;
              if (matchesTerm(live.text)) {
                liveCount = 1;
                liveFrames = [`locator (${resolvedLocator})`];
              }
            }
          } catch {
            handledByLocator = false;
          }
        }
        // Fall back to a cross-frame text search when there is no locator OR the locator matched
        // nothing (guards against an inaccurate/stale locator while a toast is still on screen).
        if (!handledByLocator) {
          try {
            const results = await checkTextExistenceInAllFrames(
              tab.page,
              expectedText,
              matchType,
              Math.min(LIVE_DOM_TIMEOUT_MS, getTimeout(tab.context))
            );
            const found = results.filter(r => r.found);
            liveCount = found.reduce((sum, r) => sum + (r.count || 0), 0);
            liveFrames = found.map(r => (r.count === 1 ? r.frame : `${r.frame} (${r.count})`));
          } catch {
            liveCount = 0;
            liveFrames = [];
          }
        }
      }

      // Was ANY notification observed at all (regardless of whether its text matched)? Used to tell
      // "nothing appeared" (empty validation — nothing to assert against) apart from "a notification
      // appeared but its text was different" (a genuine validation failure).
      const anyNotificationObserved =
        uniqueCaptured.length > 0 || liveCount > 0 || liveElementVisible;
      const observerNote = observerInstalled
        ? ''
        : ' (notification observer was not installed on this page, so only the live DOM was checked)';

      let passed = false;
      // True only when no notification of any kind appeared, so there was nothing to validate.
      let emptyValidation = false;
      let evidenceMessage = '';
      if (matchType === 'not-contains') {
        passed = !bufferPresent && liveCount === 0;
        evidenceMessage = passed
          ? `No notification containing "${displayText}" was captured within ${withinMs}ms or present on the page.`
          : `A notification containing "${displayText}" was ${
              bufferPresent ? `captured (${bufferHits.map(h => `"${h.text}"`).join(', ')})` : ''
            }${bufferPresent && liveCount > 0 ? ' and ' : ''}${
              liveCount > 0 ? `still present on the page in frame(s): ${liveFrames.join(', ')}` : ''
            }, but it should not have appeared.`;
      } else {
        const found = bufferPresent || liveCount > 0;
        if (found && providedLocatorMismatch) {
          // The notification appeared, but the caller's locator does not point to it — fail so a
          // wrong/edited locator cannot silently pass just because the text is in the buffer.
          passed = false;
          evidenceMessage = `A notification containing "${displayText}" DID appear, but it was not found via the provided locator (${locator}). The notification's real locator is ${capturedLocatorExpr}. The provided locator does not point to the notification, so the validation fails.`;
        } else if (found) {
          passed = true;
          const parts: string[] = [];
          if (bufferPresent) {
            parts.push(
              `captured live within ${withinMs}ms (${bufferHits
                .map(h => `"${h.text}"`)
                .join(', ')})`
            );
          }
          if (liveCount > 0)
            parts.push(`present on the page in frame(s): ${liveFrames.join(', ')}`);
          evidenceMessage = `Notification containing "${displayText}" was ${parts.join(' and ')}.`;
        } else if (!anyNotificationObserved) {
          // Nothing appeared — report as an empty validation so it is not cached as a real
          // notification assertion (there was nothing on the page to assert against).
          emptyValidation = true;
          evidenceMessage = `No notification appeared on the page within ${withinMs}ms, so there was nothing to validate against "${displayText}"${observerNote}.`;
        } else {
          // A notification DID appear, but its text did not match — a genuine mismatch failure.
          const actual = uniqueCaptured.map(n => `"${n.text}"`).join(', ');
          const expectation = matchType === 'exact' ? 'exact text' : 'text containing';
          evidenceMessage = `A notification appeared but its text did not match. Expected ${expectation} "${displayText}", but the notification(s) that actually appeared were: ${actual}.`;
        }
      }

      const evidence = [
        {
          command: JSON.stringify({
            description: 'Evidence showing how validation was performed',
            toolName: 'validate_notification',
            source: 'window.__ottoReadNotifications + live DOM fallback',
            ...(resolvedLocator ? { locator: resolvedLocator } : {}),
            // Distinguish the genuine observer-captured selector from the caller's best-effort guess.
            ...(capturedLocatorExpr ? { locatorSource: 'observer-captured' } : {}),
            args: { expectedText, matchType, withinMs, ...(resolvedLocator ? { locator: resolvedLocator } : {}) },
          }),
          message: evidenceMessage,
        },
      ];

      const payload = {
        element,
        expectedText,
        matchType,
        withinMs,
        ...(locator ? { locator } : {}),
        // The real locator to persist/reuse: the observer-captured selector when available (verified
        // against the live DOM at capture time), otherwise the caller's best-effort locator. The
        // bridge/hub reads this to write a genuine locator into the cached tool call.
        ...(resolvedLocator ? { resolvedLocator } : {}),
        locatorSource: capturedLocatorExpr ? 'observer-captured' : (locator ? 'model-provided' : 'none'),
        observerInstalled,
        summary: {
          total: 1,
          passed: passed ? 1 : 0,
          failed: passed ? 0 : 1,
          status: passed ? 'pass' : 'fail',
          // When true the check failed because NO notification appeared at all (nothing to assert
          // against), as opposed to a notification appearing with mismatched text. The bridge uses
          // this to record the validation as an empty (un-automated) one rather than a real failure.
          emptyValidation,
          // True when a notification appeared but the caller's concrete locator did not match the
          // observer-captured selector (a genuine failure, not an empty validation).
          locatorMismatch: providedLocatorMismatch,
          evidence,
        },
        checks: [
          {
            property: 'notification-presence',
            operator: matchType,
            expected: matchType === 'not-contains' ? 'not-present' : 'present',
            actual: bufferPresent || liveCount > 0 ? 'present' : 'not-present',
            capturedCount: bufferHits.length,
            liveCount,
            capturedNotifications: uniqueCaptured.map(n => n.text),
            emptyValidation,
            locatorMismatch: providedLocatorMismatch,
            result: passed ? 'pass' : 'fail',
          },
        ],
        scope: 'transient-notification-buffer+live-dom',
        searchMethod: 'ottoNotificationBuffer',
      };

      console.log('Validate notification:', payload);
      response.addTextResult(JSON.stringify(payload, null, 2));
    });
  },
});
