/* tslint:disable */
/*
  Copyright 2022 The Outline Authors

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

import './index';

import {html} from 'lit';
import {ref} from 'lit/directives/ref.js';

import {ServerList} from './index';
import {localize} from '../../../testing/localize';
import {ServerConnectionState} from '../server_connection_indicator';

export default {
  title: 'Client/Servers View/Server List',
  component: 'server-list',
  args: {
    servers: [
      {
        name: 'My Cool Server 1',
        address: '127.0.0.1:34873',
        connectionState: ServerConnectionState.DISCONNECTED,
      },
      {
        name: 'My Cool Server 2',
        address: '127.0.0.1:48094',
        connectionState: ServerConnectionState.CONNECTED,
      },
      {
        name: 'My Cool Server 3',
        address: '127.0.0.1:12305',
        connectionState: ServerConnectionState.DISCONNECTING,
      },
    ],
  },
  argTypes: {
    servers: {
      control: 'object',
    },
  },
};

export const Example = ({servers}: ServerList) => html`
  <server-list .localize="${localize}" .servers="${servers}"></server-list>
`;

type StoryPeriod = 'morning' | 'day' | 'evening' | 'night';

const setStoryPeriod = (period: StoryPeriod) => (element?: Element) => {
  if (!element) return;
  const serverList = element as unknown as {
    period: StoryPeriod;
    moscowTime: string;
  };
  window.requestAnimationFrame(() => {
    serverList.period = period;
    serverList.moscowTime =
      period === 'morning'
        ? '08:15'
        : period === 'day'
          ? '14:30'
          : period === 'evening'
            ? '20:10'
            : '01:20';
  });
};

const sceneServers = (servers: ServerList['servers'], connected: boolean) =>
  servers.map((server, index) => ({
    ...server,
    connectionState:
      connected && index === 0
        ? ServerConnectionState.CONNECTED
        : ServerConnectionState.DISCONNECTED,
  }));

const sceneStory = (
  servers: ServerList['servers'],
  period: StoryPeriod,
  connected: boolean
) => html`
  <server-list
    ${ref(setStoryPeriod(period))}
    .localize="${localize}"
    .servers="${sceneServers(servers, connected)}"
  ></server-list>
`;

export const MorningOff = ({servers}: ServerList) =>
  sceneStory(servers, 'morning', false);
export const MorningOn = ({servers}: ServerList) =>
  sceneStory(servers, 'morning', true);
export const DayOff = ({servers}: ServerList) =>
  sceneStory(servers, 'day', false);
export const DayOn = ({servers}: ServerList) =>
  sceneStory(servers, 'day', true);
export const EveningOff = ({servers}: ServerList) =>
  sceneStory(servers, 'evening', false);
export const EveningOn = ({servers}: ServerList) =>
  sceneStory(servers, 'evening', true);
export const NightOff = ({servers}: ServerList) =>
  sceneStory(servers, 'night', false);
export const NightOn = ({servers}: ServerList) =>
  sceneStory(servers, 'night', true);

const showDownloadProgress = (element?: Element) => {
  if (!element) return;
  const serverList = element as unknown as {
    appUpdateState: string;
    appUpdateRelease: {versionName: string; releaseNotes: string};
    appUpdateProgress: number;
  };
  serverList.appUpdateState = 'downloading';
  serverList.appUpdateRelease = {
    versionName: '1.1.3',
    releaseNotes: 'Добавлен прогресс загрузки обновления.',
  };
  serverList.appUpdateProgress = 43;
};

export const DownloadingUpdate = ({servers}: ServerList) => html`
  <server-list
    ${ref(showDownloadProgress)}
    .localize="${localize}"
    .servers="${servers}"
  ></server-list>
`;

const showUpdateVerification = (element?: Element) => {
  showDownloadProgress(element);
  if (!element) return;
  (element as unknown as {appUpdateProgress: number}).appUpdateProgress = 100;
};

export const VerifyingUpdate = ({servers}: ServerList) => html`
  <server-list
    ${ref(showUpdateVerification)}
    .localize="${localize}"
    .servers="${servers}"
  ></server-list>
`;
