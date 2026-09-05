// Copyright 2026 The Outline Authors
// SPDX-License-Identifier: Apache-2.0

import {fixture, html} from '@open-wc/testing';

import {ProfilesView} from './index';
import {
  activeProfile,
  selectedProfile,
} from '../servers_view/profile_selection';
import {ServerConnectionState} from '../servers_view/server_connection_indicator';
import {ServerList} from '../servers_view/server_list';
import {ServerListItem} from '../servers_view/server_list_item';

const profiles: ServerListItem[] = ['Основной', 'Запасной'].map(
  (name, index) => ({
    id: `profile-${index}`,
    name,
    address: '127.0.0.1:9',
    disabled: false,
    connectionState: ServerConnectionState.DISCONNECTED,
  })
);

describe('Profiles', () => {
  it('starts below the header instead of vertically centering a short list', async () => {
    const container = await fixture<HTMLElement>(html`
      <div style="display: flex; height: 700px">
        <profiles-view .servers=${profiles}></profiles-view>
      </div>
    `);
    const page = container.querySelector('profiles-view')!;
    expect(page.getBoundingClientRect().top).toBe(
      container.getBoundingClientRect().top
    );
    expect(getComputedStyle(page).overflowY).toBe('auto');
  });
  it('shows the chosen profile and moves the list out of the home scene', async () => {
    const page = await fixture<ProfilesView>(html`
      <profiles-view
        .servers=${profiles}
        .selectedServerId=${profiles[1].id}
      ></profiles-view>
    `);
    expect(
      page.shadowRoot!.querySelector('.active-profile')!.textContent
    ).toContain('Запасной');
    expect(
      page.shadowRoot!.querySelector<HTMLInputElement>('input:checked')!.value
    ).toBe(profiles[1].id);
    const home = await fixture<ServerList>(
      html`<server-list .servers=${profiles}></server-list>`
    );
    expect(home.shadowRoot!.querySelector('.profiles-panel')).toBeNull();
    expect(home.shadowRoot!.querySelector('.active-profile')).toBeNull();
    expect(home.shadowRoot!.querySelector('.door-button')).not.toBeNull();
  });

  it('announces profile selection to the app shell without starting a tunnel', async () => {
    const page = await fixture<ProfilesView>(
      html`<profiles-view .servers=${profiles}></profiles-view>`
    );
    const selection = jasmine.createSpy('selection');
    const connect = jasmine.createSpy('connect');
    page.addEventListener('SelectProfile', selection);
    page.addEventListener('ConnectPressed', connect);
    page.shadowRoot!.querySelectorAll<HTMLInputElement>('input')[1].click();
    expect(selection).toHaveBeenCalledTimes(1);
    const event = selection.calls.mostRecent().args[0] as CustomEvent;
    expect(event.detail.serverId).toBe(profiles[1].id);
    expect(event.bubbles && event.composed).toBeTrue();
    expect(connect).not.toHaveBeenCalled();
  });

  it('connects the selected profile from the door', async () => {
    const home = await fixture<ServerList>(html`
      <server-list
        .servers=${profiles}
        .selectedServerId=${profiles[1].id}
      ></server-list>
    `);
    const connect = jasmine.createSpy('connect');
    home.addEventListener('ConnectPressed', connect);
    home.shadowRoot!.querySelector<HTMLButtonElement>('.door-button')!.click();
    expect(connect.calls.mostRecent().args[0].detail.serverId).toBe(
      profiles[1].id
    );
  });

  it('disconnects the running tunnel before using a newly selected profile', async () => {
    const running = [
      {...profiles[0], connectionState: ServerConnectionState.CONNECTED},
      profiles[1],
    ];
    expect(selectedProfile(running, profiles[1].id)?.id).toBe(profiles[1].id);
    expect(activeProfile(running, profiles[1].id)?.id).toBe(profiles[0].id);
    const home = await fixture<ServerList>(html`
      <server-list
        .servers=${running}
        .selectedServerId=${profiles[1].id}
      ></server-list>
    `);
    const disconnect = jasmine.createSpy('disconnect');
    home.addEventListener('DisconnectPressed', disconnect);
    home.shadowRoot!.querySelector<HTMLButtonElement>('.door-button')!.click();
    expect(disconnect.calls.mostRecent().args[0].detail.serverId).toBe(
      profiles[0].id
    );
  });

  it('falls back safely when the remembered profile is removed', () => {
    expect(activeProfile(profiles, 'removed')?.id).toBe(profiles[0].id);
    expect(selectedProfile([], 'removed')).toBeUndefined();
  });

  it('offers profile import in the empty state', async () => {
    const page = await fixture<ProfilesView>(
      html`<profiles-view></profiles-view>`
    );
    const add = jasmine.createSpy('add');
    page.addEventListener('ShowAddServerDialog', add);
    page.shadowRoot!.querySelector<HTMLButtonElement>('button')!.click();
    expect(add).toHaveBeenCalledTimes(1);
  });
});
