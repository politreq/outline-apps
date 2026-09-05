// Copyright 2026 The Outline Authors
// SPDX-License-Identifier: Apache-2.0

import './index';
import {html} from 'lit';

import {ServerConnectionState} from '../servers_view/server_connection_indicator';

export default {title: 'Client/Profiles View', component: 'profiles-view'};

const profiles = [
  {
    id: 'main',
    name: 'Семейный / Основной профиль (TCP)',
    disabled: false,
    address: '127.0.0.1:9',
    connectionState: ServerConnectionState.DISCONNECTED,
  },
  {
    id: 'backup',
    name: 'Запасной / WebRTC',
    disabled: false,
    address: '127.0.0.1:9',
    connectionState: ServerConnectionState.DISCONNECTED,
  },
];

export const Example = () => html`
  <profiles-view
    .servers=${profiles}
    .selectedServerId=${'main'}
    @SelectProfile=${(event: CustomEvent) => {
      (
        event.currentTarget as HTMLElement & {selectedServerId: string}
      ).selectedServerId = event.detail.serverId;
    }}
  ></profiles-view>
`;
export const Empty = () => html`<profiles-view></profiles-view>`;
