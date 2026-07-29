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
import { checkTextExistenceInAllFrames } from '../helpers/helpers';
import { getTimeout } from '../helpers/utils';
import { validateNotificationSchema } from '../helpers/schemas';

type CapturedNotification = { text: string; role: string; ts: number };

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
    const { element, expectedText: rawExpectedText, matchType, withinMs } =
      validateNotificationSchema.parse(params);

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

      // 2. Live-DOM fallback: catches notifications still on screen at validation time.
      // A transient notification is either on screen *now* or already gone, so never block on the
      // full locator timeout (that made failing validations hang ~30s). Skip the live check entirely
      // for positive matches once the buffer already confirms the notification.
      const LIVE_DOM_TIMEOUT_MS = 2000;
      let liveCount = 0;
      let liveFrames: string[] = [];
      const skipLiveCheck = bufferPresent && matchType !== 'not-contains';
      if (!skipLiveCheck) {
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

      let passed = false;
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
        passed = bufferPresent || liveCount > 0;
        if (passed) {
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
        } else {
          const note = observerInstalled
            ? ''
            : ' (notification observer was not installed on this page, so only the live DOM was checked)';
          evidenceMessage = `No notification containing "${displayText}" was captured within ${withinMs}ms or found on the page using ${matchType} matching${note}.`;
        }
      }

      const evidence = [
        {
          command: JSON.stringify({
            description: 'Evidence showing how validation was performed',
            toolName: 'validate_notification',
            source: 'window.__ottoReadNotifications + live DOM fallback',
            args: { expectedText, matchType, withinMs },
          }),
          message: evidenceMessage,
        },
      ];

      const payload = {
        element,
        expectedText,
        matchType,
        withinMs,
        observerInstalled,
        summary: {
          total: 1,
          passed: passed ? 1 : 0,
          failed: passed ? 0 : 1,
          status: passed ? 'pass' : 'fail',
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
