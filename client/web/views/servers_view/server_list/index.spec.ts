// Copyright 2026 The Outline Authors
// Licensed under the Apache License, Version 2.0.

import {getMoscowTime, ServerList} from './index';
import {ServerConnectionState} from '../server_connection_indicator';
import {ServerListItem, ServerListItemEvent} from '../server_list_item';

describe('Home album', () => {
  let home: ServerList;
  const profile = (connectionState: ServerConnectionState): ServerListItem => ({
    id: 'family',
    name: 'Семейный профиль',
    address: 'example.test',
    disabled: false,
    connectionState,
  });

  afterEach(() => {
    home?.remove();
    jasmine.clock().uninstall();
  });

  const periods = [
    {utc: '04:30', period: 'morning', greeting: 'Доброе утро'},
    {utc: '11:30', period: 'day', greeting: 'Добрый день'},
    {utc: '17:30', period: 'evening', greeting: 'Добрый вечер'},
    {utc: '20:30', period: 'night', greeting: 'Доброй ночи'},
  ];

  for (const {utc, period, greeting} of periods) {
    for (const connected of [false, true]) {
      it(`${period}: renders ${connected ? 'on' : 'off'} without overlapping the greeting`, async () => {
        jasmine.clock().install();
        jasmine.clock().mockDate(new Date(`2026-09-06T${utc}:00Z`));
        home = new ServerList();
        home.style.cssText =
          'width:390px;height:780px;--outline-safe-area-top:0px';
        home.servers = [
          profile(
            connected
              ? ServerConnectionState.CONNECTED
              : ServerConnectionState.DISCONNECTED
          ),
        ];
        document.body.append(home);
        await home.updateComplete;
        const root = home.shadowRoot!;
        const scene = root.querySelector<HTMLElement>('.house-scene')!;
        const greetingRow = root.querySelector<HTMLElement>('.time-chip')!;
        expect(scene.dataset.period).toBe(period);
        expect(scene.dataset.connected).toBe(String(connected));
        expect(greetingRow.textContent).toContain(greeting);
        expect(greetingRow.getBoundingClientRect().top).toBeGreaterThan(
          scene.getBoundingClientRect().bottom
        );
        expect(root.querySelector('.connection-status')!.textContent).toContain(
          connected ? 'Все дома' : 'VPN выключен'
        );
        expect(
          root.querySelector('.door-button')!.getAttribute('aria-pressed')
        ).toBe(String(connected));
        expect(root.querySelector('.door-button')!.textContent!.trim()).toBe(
          ''
        );
      });
    }
  }

  it('uses Moscow time at the midnight and period boundaries, not device timezone', () => {
    const cases = [
      ['02:59', 'night'],
      ['03:00', 'morning'],
      ['08:59', 'morning'],
      ['09:00', 'day'],
      ['15:00', 'evening'],
      ['20:00', 'night'],
      ['21:00', 'night'],
    ];
    for (const [utc, period] of cases) {
      expect(getMoscowTime(new Date(`2026-09-06T${utc}:00Z`)).period).toBe(
        period
      );
    }
    expect(getMoscowTime(new Date('2026-09-06T21:00:00Z')).time).toBe('00:00');
  });

  it('does not claim the VPN is connected before the tunnel is ready', async () => {
    home = new ServerList();
    home.servers = [profile(ServerConnectionState.CONNECTING)];
    document.body.append(home);
    await home.updateComplete;
    expect(
      home.shadowRoot!.querySelector('.connection-status')!.textContent
    ).toContain('Подключаемся');
    expect(
      home.shadowRoot!.querySelector('.connection-status')!.textContent
    ).not.toContain('VPN включён');
  });

  it('keeps the sky image, button position and image elements when toggled', async () => {
    home = new ServerList();
    home.servers = [profile(ServerConnectionState.DISCONNECTED)];
    document.body.append(home);
    await home.updateComplete;
    const root = home.shadowRoot!;
    const sky = root.querySelector<HTMLImageElement>(
      '.scene-layer:not(.scene-layer--on) .house-image'
    )!;
    const src = sky.src;
    const button = root.querySelector<HTMLButtonElement>('.door-button')!;
    const before = button.getBoundingClientRect();
    const connect = jasmine.createSpy('connect');
    home.addEventListener(ServerListItemEvent.CONNECT, connect);
    button.click();
    expect(connect).toHaveBeenCalled();
    home.servers = [profile(ServerConnectionState.CONNECTED)];
    await home.updateComplete;
    expect(
      root.querySelector('.scene-layer:not(.scene-layer--on) .house-image')
    ).toBe(sky);
    expect(sky.src).toBe(src);
    expect(root.querySelector('.door-button')).toBe(button);
    const after = button.getBoundingClientRect();
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    const disconnect = jasmine.createSpy('disconnect');
    home.addEventListener(ServerListItemEvent.DISCONNECT, disconnect);
    button.click();
    expect(disconnect).toHaveBeenCalled();
  });
});
