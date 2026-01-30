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
import * as jp from 'jsonpath';
import { defineTabTool } from '../../tool';
import { compareValues } from '../helpers/helpers';
import { validateResponseSchema } from '../helpers/schemas';

export const validate_response = defineTabTool({
  capability: 'core',
  schema: {
    name: 'validate_response',
    title: 'Validate Response using JSON Path',
    description: 'Validate response object using JSON path expressions to extract and compare values.',
    inputSchema: validateResponseSchema,
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    const { responseData, checks } = params;

    // Parse JSON string to object
    let parsedResponseData;
    try {
      parsedResponseData = JSON.parse(responseData);
    } catch (error) {
      const errorMessage = `Failed to parse responseData as JSON: ${error instanceof Error ? error.message : String(error)}`;

      const errorEvidence = [{
        command: JSON.stringify({
          toolName: 'validate_response',
          arguments: {
            checks: checks
          }
        }),
        message: errorMessage
      }];

      const errorPayload = {
        summary: {
          total: checks.length,
          passed: 0,
          failed: checks.length,
          status: 'fail',
          evidence: errorEvidence,
        },
        checks: checks.map(check => ({
          name: check.name,
          jsonPath: check.jsonPath,
          expected: check.expected,
          operator: check.operator,
          actual: 'error',
          result: 'fail',
        })),
        error: errorMessage,
      };

      console.error('Validate response JSON parse error:', errorPayload);
      response.addResult(JSON.stringify(errorPayload, null, 2));
      return;
    }

    // Perform all checks
    const results = checks.map(check => {
      try {
        // Extract value using JSON path
        const normalizedPath = check.jsonPath.startsWith('$') ? check.jsonPath : `$.${check.jsonPath}`;
        const queryResult = jp.query(parsedResponseData, normalizedPath);
        const actualValue = queryResult.length === 1 ? queryResult[0] : queryResult;

        // Compare values if expected is provided
        let passed = true;
        if (check.expected !== undefined) {
          const comparisonResult = compareValues(actualValue, check.expected, check.operator);
          passed = comparisonResult.passed;
        }

        return {
          name: check.name,
          jsonPath: check.jsonPath,
          expected: check.expected,
          operator: check.operator,
          actual: actualValue,
          result: passed ? 'pass' : 'fail',
        };
      } catch (error) {
        // Handle case when value is not found at JSON path
        return {
          name: check.name,
          jsonPath: check.jsonPath,
          expected: check.expected,
          operator: check.operator,
          actual: `ERROR: ${error.message}`,
          result: 'fail',
        };
      }
    });

    const passedCount = results.filter(r => r.result === 'pass').length;
    const status = passedCount === results.length ? 'pass' : 'fail';

    // Generate evidence message
    let evidenceMessage = '';
    if (status === 'pass') {
      evidenceMessage = `All ${results.length} JSON path validation checks passed successfully`;
    } else {
      const failedChecks = results.filter(r => r.result === 'fail');
      const failedDetails = failedChecks.map(c =>
        `${c.name} (path: ${c.jsonPath}, expected: ${c.expected}, got: ${c.actual})`
      ).join(', ');
      evidenceMessage = `${passedCount}/${results.length} checks passed. Failed: ${failedDetails}`;
    }

    // Generate evidence as array of objects with command and message
    const evidenceArray = [{
      command: JSON.stringify({
        toolName: 'validate_response',
        arguments: {
          checks: checks
        }
      }),
      message: evidenceMessage
    }];

    const payload = {
      summary: {
        total: results.length,
        passed: passedCount,
        failed: results.length - passedCount,
        status,
        evidence: evidenceArray,
      },
      checks: results,
    };

    console.log('Validate response JSON path:', payload);
    response.addResult(JSON.stringify(payload, null, 2));
  },
});
