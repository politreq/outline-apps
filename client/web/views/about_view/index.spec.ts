// Copyright 2026 The Outline Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {fixture, html} from '@open-wc/testing';

import {AboutView} from './index';

describe('About app update installer', () => {
  it('shows an installer error instead of a failed update check', async () => {
    const view = await fixture<AboutView>(html`
      <about-view .localize=${(key: string) => key}></about-view>
    `);
    spyOn(console, 'error');
    spyOn(view['appUpdater'], 'install').and.rejectWith(new Error('installer'));
    view['downloadedUpdatePath'] = '/cache/updates/update.apk';
    view['updateStatus'] = 'installing';
    await view.updateComplete;
    view
      .shadowRoot!.querySelector<HTMLButtonElement>('.update-action')!
      .click();
    await new Promise(resolve => setTimeout(resolve, 0));
    await view.updateComplete;
    expect(
      view.shadowRoot!.querySelector('.update-status')!.textContent
    ).toContain('Не удалось открыть установщик');
    expect(
      view.shadowRoot!.querySelector('.update-status')!.textContent
    ).not.toContain('Не удалось проверить');
  });

  it('reopens a downloaded APK without downloading it again', async () => {
    const view = await fixture<AboutView>(html`
      <about-view .localize=${(key: string) => key}></about-view>
    `);
    const install = spyOn(view['appUpdater'], 'install').and.resolveTo({
      status: 'installer_requested',
    });
    const download = spyOn(view['appUpdater'], 'download');
    view['downloadedUpdatePath'] = '/cache/updates/update.apk';
    view['updateStatus'] = 'installing';
    await view.updateComplete;
    view
      .shadowRoot!.querySelector<HTMLButtonElement>('.update-action')!
      .click();
    await new Promise(resolve => setTimeout(resolve, 0));
    await view.updateComplete;
    expect(install).toHaveBeenCalledOnceWith('/cache/updates/update.apk');
    expect(download).not.toHaveBeenCalled();
    expect(
      view.shadowRoot!.querySelector('.update-action')!.textContent
    ).toContain('Открыть установщик');
  });
});
