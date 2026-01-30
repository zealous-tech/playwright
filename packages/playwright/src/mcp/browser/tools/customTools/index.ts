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
import {
  validate_computed_styles,
  validate_text_in_whole_page,
  validate_element_in_whole_page,
  validate_dom_assertions,
  validate_alert_in_snapshot,
  validate_element_position,
  validate_element_order,
  validate_response,
  validate_tab_exist,
  default_validation,
  validateIcon,
} from './validations';
import {
  get_computed_styles,
  extract_svg_from_element,
  extract_image_urls,
  generate_locator,
  make_request,
  data_extraction,
  wait,
  dynamic_switch,
  custom_wait,
} from './actions';

export default [
  get_computed_styles,
  extract_svg_from_element,
  extract_image_urls,
  validate_computed_styles,
  validate_text_in_whole_page,
  validate_element_in_whole_page,
  validate_dom_assertions,
  validate_alert_in_snapshot,
  // validate_expanded,
  validate_element_position,
  validate_element_order,
  default_validation,
  validate_response,
  validate_tab_exist,
  validateIcon,
  generate_locator,
  make_request,
  data_extraction,
  wait,
  dynamic_switch,
  custom_wait
];
