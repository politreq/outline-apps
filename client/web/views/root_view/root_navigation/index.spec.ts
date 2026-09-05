/**
 * Copyright 2026 The Outline Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {fixture, html} from '@open-wc/testing';

import {RootNavigation} from './index';
import {localize} from '../../../testing/localize';

describe('RootNavigation', () => {
  it('shows only the three Android destinations in the requested order', async () => {
    const navigation = await fixture<RootNavigation>(html`
      <root-navigation
        .localize=${localize}
        .open=${true}
        .showAppRoutingSettings=${true}
      ></root-navigation>
    `);

    const labels = Array.from(
      navigation.shadowRoot!.querySelectorAll('md-list-item')
    ).map(item =>
      Array.from(item.childNodes)
        .filter(node => node.nodeType === Node.TEXT_NODE)
        .map(node => node.textContent)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
    );

    expect(labels).toEqual(['Home', 'VPN for apps', 'About']);
  });
});
