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
import { defineTabTool } from '../../tool';
import { checkAlertInSnapshotSchema } from '../helpers/schemas';

export const validate_alert_in_snapshot = defineTabTool({
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
      const tabSnapshot = await tab.captureSnapshot();

      // Check if alert dialog exists using modalStates
      const dialogState = tabSnapshot.modalStates.find(state => state.type === 'dialog');
      const alertExists = !!dialogState;
      // Get alert dialog text if it exists
      const alertText = dialogState ? dialogState.description : null;

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
      let evidenceMessage = '';
      if (matchType === 'contains') {
        if (passed) {
          if (hasText)
            evidenceMessage = `Alert dialog found with text: "${alertText}" containing expected: "${hasText}"`;
          else
            evidenceMessage = `Alert dialog found with text: "${alertText}"`;

        } else {
          if (hasText)
            evidenceMessage = `Alert dialog found but text "${hasText}" not found in: "${alertText}"`;
          else
            evidenceMessage = `Alert dialog not found in snapshot`;

        }
      } else { // not-contains
        if (passed)
          evidenceMessage = `Alert dialog was not found as expected`;
        else
          evidenceMessage = `Alert dialog was not expected, but it was ${hasText ? `found with text: "${alertText}"` : 'found'}.`;

      }

      // Generate evidence as array of objects
      const evidence = [{
        command: {
          toolName: 'validate_alert_in_snapshot',
          arguments: {
            expectedText: hasText || null,
            matchType: matchType
          }
        },
        message: evidenceMessage
      }];

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

      const resultString = JSON.stringify(payload, null, 2);
      // console.log('Result string:', resultString);
      response.addResult(resultString);
    } catch (error) {
      const errorMessage = `Failed to check alert dialog in snapshot.`;
      console.log(`Failed to check alert dialog in snapshot. Error: ${error instanceof Error ? error.message : String(error)}`);
      const errorEvidence = [{
        command: {
          toolName: 'validate_alert_in_snapshot',
          expectedText: hasText || null,
          matchType: matchType
        },
        message: errorMessage
      }];
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
          evidence: errorEvidence
        },
        error: error instanceof Error ? error.message : String(error)
      };

      console.error('Check alert in snapshot error:', errorPayload);
      const errorResultString = JSON.stringify(errorPayload, null, 2);
      // console.log('Error result string:', errorResultString);
      response.addResult(errorResultString);
      console.log('Error result added to response');
      console.log('Function completed with error');
    }
  },
});
