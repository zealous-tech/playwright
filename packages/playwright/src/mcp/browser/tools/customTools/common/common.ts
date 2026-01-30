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
export interface CurlResponse {
  stdout: string;
  stderr: string;
  statusCode?: number;
  responseTime?: number;
  contentLength?: number;
  contentType?: string;
  server?: string;
  connection?: string;
  date?: string;
  etag?: string;
  xPoweredBy?: string;
  error?: string;
}

export interface ParsedCurlResponse {
  data: string | object;
  statusCode?: number;
  responseTime?: number;
  contentLength?: number;
  contentType?: string;
  server?: string;
  connection?: string;
  date?: string;
  etag?: string;
  xPoweredBy?: string;
  error?: string;
  rawStderr?: string;
}

export interface ValidationResult {
  isPass: boolean;
  evidenceMessage: string;
  expectedValue?: any;
  actualValue?: any;
}

export interface ValidationPayload {
  mode: 'data' | 'element';
  ref?: string;
  element?: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    status: 'pass' | 'fail';
    evidence: Array<{ command: string; message: string }>;
  };
  checks: Array<{
    property: string;
    operator: string;
    expected: any;
    actual: any;
    result: 'pass' | 'fail';
  }>;
  result: 'pass' | 'fail';
  jsCode: string;
  dataPreview?: string;
  expectedValue?: any;
  actualValue?: any;
  error?: string;
}
