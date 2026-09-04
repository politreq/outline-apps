/*
  Copyright 2024 The Outline Authors
  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at
       http://www.apache.org/licenses/LICENSE-2.0
  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

import {html} from 'lit';
import {ref} from 'lit/directives/ref.js';

import './index';
import type {AboutView} from './index';
import {localize} from '../../testing/localize';

export default {
  title: 'Client/About View',
  component: 'about-view',
  args: {
    build: 123456,
    version: '0.0.0-dev',
  },
};

export const Example = ({build, version}: AboutView) => html`
  <about-view
    build=${build}
    version=${version}
    .localize=${localize}
  ></about-view>
`;

const showDownloadProgress = (element?: Element) => {
  if (!element) return;
  const aboutView = element as unknown as {
    updateStatus: string;
    updateRelease: {versionName: string; releaseNotes: string};
    downloadProgress: number;
  };
  aboutView.updateStatus = 'downloading';
  aboutView.updateRelease = {
    versionName: '1.1.3',
    releaseNotes: 'Добавлен прогресс загрузки обновления.',
  };
  aboutView.downloadProgress = 43;
};

export const DownloadingUpdate = ({build, version}: AboutView) => html`
  <about-view
    ${ref(showDownloadProgress)}
    build=${build}
    version=${version}
    .localize=${localize}
  ></about-view>
`;

const showUpdateVerification = (element?: Element) => {
  showDownloadProgress(element);
  if (!element) return;
  (element as unknown as {downloadProgress: number}).downloadProgress = 100;
};

export const VerifyingUpdate = ({build, version}: AboutView) => html`
  <about-view
    ${ref(showUpdateVerification)}
    build=${build}
    version=${version}
    .localize=${localize}
  ></about-view>
`;
