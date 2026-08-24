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
/**
 * Shared reader for the in-page transient-notification buffer maintained by the pw-bridge observer
 * (`window.__ottoReadNotifications`).
 *
 * The observer records each toast/snackbar the instant it appears, together with an icon
 * fingerprint and its full computed-style map. That lets icon/style validations run against a
 * notification that has already been removed from the DOM. Icon and style payloads are large, so
 * they are requested explicitly via `includeIcon` / `includeStyles`, and `matchText` narrows the
 * read to the notification of interest instead of transferring the whole buffer.
 */

export type CapturedNotificationIcon = {
  iconType: 'svg' | 'img' | 'background' | 'font' | 'datauri' | 'unknown';
  iconData: string;
  colors?: string[];
};

export type CapturedNotification = {
  text: string;
  role: string;
  ts: number;
  locator?: string;
  iconLocator?: string;
  hasIcon?: boolean;
  hasStyles?: boolean;
  icon?: CapturedNotificationIcon;
  styles?: Record<string, string>;
};

export type ReadNotificationsOptions = {
  /** Include the appear-time icon fingerprint on returned entries. */
  includeIcon?: boolean;
  /** Include the appear-time computed-style map on returned entries. */
  includeStyles?: boolean;
  /** Only return notifications whose text contains this value (case/whitespace-insensitive). */
  matchText?: string;
};

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function stripLocatorPrefix(raw: unknown): string | undefined {
  if (typeof raw !== 'string')
    return undefined;
  const trimmed = String(raw).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function toLocatorExpression(rawSelector: string): string {
  const trimmed = rawSelector.trim();
  if (!trimmed)
    return '';
  if (trimmed.startsWith('getBy') || trimmed.startsWith('locator('))
    return trimmed;
  return `locator(${JSON.stringify(trimmed)})`;
}

export function normalizeLocatorForCompare(raw: string): string {
  let s = String(raw).trim();
  const m = s.match(/^locator\(\s*(['"])([\s\S]*)\1\s*\)$/);
  if (m)
    return m[2].trim();
  return s;
}

export function isSemanticLocator(raw: string): boolean {
  return String(raw).trim().startsWith('getBy');
}

function capturedSelectors(n: CapturedNotification): string[] {
  return [n.locator, n.iconLocator].filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
}

function pickRichest(hits: CapturedNotification[]): CapturedNotification | undefined {
  if (hits.length === 0)
    return undefined;
  return (
    hits.find(n => n.icon && typeof n.icon.iconData === 'string') ||
    hits.find(n => n.styles && Object.keys(n.styles).length > 0) ||
    hits[0]
  );
}

/**
 * Read notifications captured within the lookback window.
 *
 * `observerInstalled` is false when the in-page reader is missing (observer script not injected),
 * which callers report differently from "no notification appeared".
 */
export async function readNotifications(
  page: any,
  withinMs: number,
  options: ReadNotificationsOptions = {}
): Promise<{ notifications: CapturedNotification[]; observerInstalled: boolean }> {
  let captured: CapturedNotification[] | null = null;
  try {
    captured = await page.evaluate(
        (args: { ms: number; opts: ReadNotificationsOptions }) => {
          const w = window as unknown as {
            __ottoReadNotifications?: (
              sinceMs: number,
              opts?: ReadNotificationsOptions
            ) => CapturedNotification[];
          };
          return typeof w.__ottoReadNotifications === 'function'
            ? w.__ottoReadNotifications(args.ms, args.opts)
            : null;
        },
        {
          // Targeted icon/style lookup by text must survive the extraction follow-up (often 15-25s
          // after the toast appeared). Snapshot / text-only reads keep the caller's window.
          ms: options.matchText && (options.includeIcon || options.includeStyles)
            ? Math.max(withinMs, 120000)
            : withinMs,
          opts: options,
        }
    );
  } catch {
    captured = null;
  }
  if (!Array.isArray(captured))
    return { notifications: [], observerInstalled: false };

  const byKey = new Map<string, CapturedNotification>();
  const order: string[] = [];
  const richness = (n: CapturedNotification) => (n.icon ? 2 : 0) + (n.styles ? 1 : 0);
  for (const n of captured) {
    if (!n || typeof n.text !== 'string')
      continue;
    const textKey = normalize(n.text);
    if (!textKey)
      continue;
    const key = `${textKey}|${n.locator ? normalizeLocatorForCompare(n.locator) : ''}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, n);
      order.push(key);
    } else if (richness(n) >= richness(existing)) {
      byKey.set(key, n);
    }
  }
  return {
    notifications: order.map(key => byKey.get(key)!),
    observerInstalled: true,
  };
}

export type NotificationLookup = {
  hit?: CapturedNotification;
  locatorMismatch: boolean;
};

/** Match by text; a concrete locator("…") must also match the captured toast/icon locator. */
export function lookupNotification(
  notifications: CapturedNotification[],
  notificationText: string,
  locator?: string
): NotificationLookup {
  const needle = normalize(notificationText);
  if (!needle)
    return { locatorMismatch: false };

  const textHits = notifications.filter(n => normalize(n.text).includes(needle));
  const textHit = pickRichest(textHits);
  if (!textHit)
    return { locatorMismatch: false };

  const provided = stripLocatorPrefix(locator);
  if (!provided || isSemanticLocator(provided))
    return { hit: textHit, locatorMismatch: false };

  const locatorHits = textHits.filter(n =>
    capturedSelectors(n).some(sel => normalizeLocatorForCompare(sel) === normalizeLocatorForCompare(provided))
  );
  if (locatorHits.length > 0)
    return { hit: pickRichest(locatorHits), locatorMismatch: false };
  if (!textHits.some(n => capturedSelectors(n).length > 0))
    return { hit: textHit, locatorMismatch: false };
  return { hit: textHit, locatorMismatch: true };
}

export function notificationLocatorExpressions(hit?: CapturedNotification): { toast?: string; icon?: string } {
  if (!hit)
    return {};
  return {
    toast: hit.locator?.trim() ? toLocatorExpression(hit.locator) : undefined,
    icon: hit.iconLocator?.trim() ? toLocatorExpression(hit.iconLocator) : undefined,
  };
}
