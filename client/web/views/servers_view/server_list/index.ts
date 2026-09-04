/*
  Copyright 2026 The Outline Authors
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

import {Localizer} from '@outline/infrastructure/i18n';
import {css, html, LitElement} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';

import dayOn from '../../../assets/home/day-on.webp';
import dayOff from '../../../assets/home/day.webp';
import eveningOn from '../../../assets/home/evening-on.webp';
import eveningOff from '../../../assets/home/evening.webp';
import morningOn from '../../../assets/home/morning-on.webp';
import morningOff from '../../../assets/home/morning.webp';
import nightOn from '../../../assets/home/night-on.webp';
import nightOff from '../../../assets/home/night.webp';
import {ServerConnectionState} from '../server_connection_indicator';
import {ServerListItem, ServerListItemEvent} from '../server_list_item';

type TimePeriod = 'morning' | 'day' | 'evening' | 'night';

const SCENES: Record<
  TimePeriod,
  {greeting: string; icon: string; off: string; on: string}
> = {
  morning: {
    greeting: 'Доброе утро',
    icon: 'wb_twilight',
    off: morningOff,
    on: morningOn,
  },
  day: {greeting: 'Добрый день', icon: 'light_mode', off: dayOff, on: dayOn},
  evening: {
    greeting: 'Добрый вечер',
    icon: 'wb_twilight',
    off: eveningOff,
    on: eveningOn,
  },
  night: {
    greeting: 'Доброй ночи',
    icon: 'dark_mode',
    off: nightOff,
    on: nightOn,
  },
};

function getMoscowTime() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour = Number(parts.find(part => part.type === 'hour')?.value ?? '12');
  const period: TimePeriod =
    hour >= 6 && hour < 12
      ? 'morning'
      : hour >= 12 && hour < 18
        ? 'day'
        : hour >= 18 && hour < 23
          ? 'evening'
          : 'night';
  const time = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
  }).format(now);
  return {period, time};
}

function hasActiveConnection(server: ServerListItem) {
  return [
    ServerConnectionState.CONNECTING,
    ServerConnectionState.CONNECTED,
    ServerConnectionState.RECONNECTING,
  ].includes(server.connectionState);
}

@customElement('server-list')
export class ServerList extends LitElement {
  @property({type: Boolean}) darkMode = false;
  @property({type: Object}) localize: Localizer = msg => msg;
  @property({type: Array}) servers: ServerListItem[] = [];

  @state() private selectedServerId = '';
  @state() private period: TimePeriod = getMoscowTime().period;
  @state() private moscowTime = getMoscowTime().time;

  private clockTimer?: number;

  static styles = css`
    :host {
      --home-bg: #fff7e8;
      --home-paper: #fffaf0;
      --home-ink: #4a2c1d;
      --home-muted: #8f7465;
      --home-line: #efd6b4;
      --home-terracotta-dark: #93432f;
      --home-green: #769b37;
      --home-green-dark: #537629;
      --home-green-pale: #edf4d8;
      --home-off: #8b5d56;
      --home-off-pale: #f3e4df;
      box-sizing: border-box;
      display: block;
      height: 100%;
      margin: 0 auto;
      overflow-y: auto;
      padding: 10px 12px 28px;
      width: 100%;
      background: var(--home-bg);
      color: var(--home-ink);
    }

    * {
      box-sizing: border-box;
    }
    button {
      font: inherit;
      -webkit-tap-highlight-color: transparent;
    }

    .time-chip {
      position: relative;
      z-index: 4;
      display: grid;
      width: max-content;
      max-width: 92%;
      min-height: 38px;
      margin: 0 auto -22px;
      padding: 7px 13px;
      grid-template-columns: 20px auto auto;
      gap: 7px;
      align-items: center;
      color: var(--home-terracotta-dark);
      background: rgb(255 250 240 / 94%);
      border: 1px solid var(--home-line);
      border-radius: 18px;
      box-shadow: 0 7px 20px rgb(89 55 30 / 12%);
    }

    .time-chip md-icon {
      color: var(--home-terracotta-dark);
      font-size: 18px;
    }
    .time-chip strong {
      font-size: 13px;
    }
    .time-chip small {
      color: var(--home-muted);
      font-size: 11px;
      font-weight: 500;
    }

    .house-scene {
      --door-control-x: 50.55%;
      --door-control-y: 79.55%;
      position: relative;
      width: 100%;
      margin: 0;
      overflow: hidden;
      aspect-ratio: 4 / 5;
      background: #f7ead4;
      border: 1px solid #ead1ac;
      border-radius: 34px;
      box-shadow: 0 14px 30px rgb(90 55 28 / 12%);
    }

    .house-scene::after {
      position: absolute;
      z-index: 2;
      content: '';
      pointer-events: none;
      inset: 0;
      border: 6px solid rgb(255 250 240 / 38%);
      border-radius: inherit;
    }

    .scene-layer,
    .house-image,
    .room-motion {
      position: absolute;
      width: 100%;
      height: 100%;
      inset: 0;
    }

    .scene-layer {
      z-index: 0;
      pointer-events: none;
    }
    .scene-layer--on {
      z-index: 1;
      opacity: 0;
      transition: opacity 900ms cubic-bezier(0.4, 0, 0.2, 1);
      will-change: opacity;
    }
    .scene-layer--on.connected {
      opacity: 1;
    }

    /* Keep the sky fixed: only rooms, attic, door and porch lamp change. */
    .scene-layer--on .house-image {
      clip-path: inset(54% 29% 2.5% 29% round 32% 32% 4% 4%);
    }

    .house-image,
    .room-motion {
      object-fit: cover;
      user-select: none;
      -webkit-user-drag: none;
    }

    .room-motion {
      z-index: 1;
      pointer-events: none;
      transform-origin: center;
      will-change: transform;
    }
    .room-motion--one {
      clip-path: inset(28% 51% 45% 17% round 24px);
      animation: room-one 3.8s ease-in-out infinite;
    }
    .room-motion--two {
      clip-path: inset(28% 18% 45% 52% round 24px);
      animation: room-two 4.4s ease-in-out infinite;
    }
    .room-motion--three {
      clip-path: inset(62% 64% 13% 16% round 20px);
      animation: room-three 4.9s ease-in-out infinite;
    }
    .room-motion--four {
      clip-path: inset(62% 16% 13% 65% round 20px);
      animation: room-four 3.5s ease-in-out infinite;
    }
    .room-motion--attic {
      clip-path: circle(6.3% at 50.55% 17.7%);
      animation: room-two 5.2s ease-in-out infinite;
    }

    .house-scene[data-period='morning'] {
      --door-control-x: 50.2%;
      --door-control-y: 79.45%;
    }
    .house-scene[data-period='day'] {
      --door-control-x: 50.4%;
      --door-control-y: 79.55%;
    }
    .house-scene[data-period='evening'] {
      --door-control-x: 51.8%;
      --door-control-y: 79.65%;
    }
    .house-scene[data-period='night'] {
      --door-control-x: 50.65%;
      --door-control-y: 79.65%;
    }

    .door-button {
      position: absolute;
      z-index: 6;
      top: var(--door-control-y);
      left: var(--door-control-x);
      display: block;
      width: 20%;
      height: 27%;
      min-width: 68px;
      padding: 0;
      transform: translate(-50%, -50%);
      color: #fff8ec;
      background: transparent;
      border: 0;
      cursor: pointer;
      filter: drop-shadow(0 2px 5px rgb(49 28 20 / 55%));
    }
    .door-button:active {
      transform: translate(-50%, -50%) scale(0.96);
    }
    .door-button:disabled {
      cursor: default;
      opacity: 0.55;
    }

    .door-button-content {
      position: absolute;
      top: 50%;
      left: 50%;
      display: grid;
      width: max-content;
      transform: translate(-50%, -50%);
      place-items: center;
      gap: 4px;
    }
    .power-icon {
      color: #fffdf0;
      font-size: 46px;
    }
    .door-label {
      padding: 3px 7px;
      color: #fff8ec;
      background: rgb(72 41 33 / 70%);
      border-radius: 8px;
      font-size: 9px;
      font-weight: 700;
      white-space: nowrap;
    }

    .connection-pill {
      display: flex;
      width: max-content;
      max-width: 94%;
      min-height: 40px;
      margin: 10px auto 0;
      padding: 7px 16px;
      align-items: center;
      justify-content: center;
      gap: 8px;
      color: var(--home-off);
      background: var(--home-off-pale);
      border: 1px solid #d8aaa1;
      border-radius: 24px;
      font-size: 14px;
    }
    .connection-pill.connected {
      color: var(--home-green-dark);
      background: var(--home-green-pale);
      border-color: #a8bd72;
    }
    .connection-pill md-icon {
      color: currentColor;
      font-size: 20px;
    }

    .active-profile {
      margin: 10px 0 11px;
      color: var(--home-muted);
      font-size: 15px;
      text-align: center;
    }
    .active-profile strong {
      color: var(--home-ink);
      font-weight: 600;
    }

    .profiles-panel {
      overflow: hidden;
      background: rgb(255 250 240 / 88%);
      border: 1px solid var(--home-line);
      border-radius: 24px;
      box-shadow: 0 10px 26px rgb(113 75 44 / 7%);
    }
    .section-heading {
      display: flex;
      min-height: 48px;
      padding: 0 19px;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--home-line);
    }
    .section-heading h2 {
      margin: 0;
      font-size: 18px;
    }
    .profile-count {
      display: grid;
      width: 28px;
      height: 28px;
      place-items: center;
      color: var(--home-muted);
      background: #f8ead6;
      border-radius: 50%;
      font-size: 12px;
      font-weight: 700;
    }

    .profile-row {
      display: grid;
      width: 100%;
      min-height: 68px;
      padding: 9px 17px;
      grid-template-columns: 40px 1fr 24px;
      gap: 12px;
      align-items: center;
      color: var(--home-ink);
      background: transparent;
      border: 0;
      border-bottom: 1px solid var(--home-line);
      text-align: left;
      cursor: pointer;
    }
    .profile-row:last-child {
      border-bottom: 0;
    }
    .profile-row.selected {
      background: #fbf5e5;
    }

    .profile-check {
      display: grid;
      width: 36px;
      height: 36px;
      place-items: center;
      color: white;
      border: 2px solid #b29987;
      border-radius: 50%;
    }
    .profile-check.connected {
      background: var(--home-green);
      border-color: var(--home-green);
      box-shadow: 0 5px 12px rgb(92 126 42 / 18%);
    }
    .profile-check md-icon {
      color: white;
      font-size: 19px;
    }
    .profile-copy {
      display: flex;
      min-width: 0;
      flex-direction: column;
    }
    .profile-copy strong {
      overflow: hidden;
      font-size: 17px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .profile-copy small {
      margin-top: 3px;
      color: var(--home-muted);
      font-size: 13px;
    }
    .profile-row > md-icon {
      color: var(--home-ink);
    }

    @keyframes room-one {
      50% {
        transform: translate3d(0.45%, -0.18%, 0) scale(1.006);
      }
    }
    @keyframes room-two {
      50% {
        transform: translate3d(-0.38%, 0.2%, 0) scale(1.005);
      }
    }
    @keyframes room-three {
      50% {
        transform: translate3d(0.3%, -0.22%, 0) scale(1.007);
      }
    }
    @keyframes room-four {
      50% {
        transform: translate3d(-0.35%, 0.16%, 0) scale(1.006);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .scene-layer--on {
        transition-duration: 1ms;
      }
      .room-motion {
        animation: none;
      }
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.updateClock();
    this.clockTimer = window.setInterval(() => this.updateClock(), 30_000);
  }

  disconnectedCallback() {
    if (this.clockTimer) window.clearInterval(this.clockTimer);
    super.disconnectedCallback();
  }

  private updateClock() {
    const {period, time} = getMoscowTime();
    this.period = period;
    this.moscowTime = time;
  }

  private get activeServer() {
    return (
      this.servers.find(server => hasActiveConnection(server)) ??
      this.servers.find(server => server.id === this.selectedServerId) ??
      this.servers[0]
    );
  }

  private toggleConnection() {
    const server = this.activeServer;
    if (!server || server.disabled || server.errorMessageId) return;
    this.dispatchEvent(
      new CustomEvent(
        hasActiveConnection(server)
          ? ServerListItemEvent.DISCONNECT
          : ServerListItemEvent.CONNECT,
        {detail: {serverId: server.id}, bubbles: true, composed: true}
      )
    );
  }

  private renderSceneLayer(image: string, connectedLayer: boolean) {
    const rooms = ['one', 'two', 'three', 'four', 'attic'];
    const connected = Boolean(
      this.activeServer && hasActiveConnection(this.activeServer)
    );
    return html`
      <div
        class="scene-layer ${connectedLayer
          ? 'scene-layer--on'
          : ''} ${connectedLayer && connected ? 'connected' : ''}"
        aria-hidden="true"
      >
        <img class="house-image" src=${image} alt="" draggable="false" />
        ${rooms.map(
          room =>
            html`<img
              class="room-motion room-motion--${room}"
              src=${image}
              alt=""
              draggable="false"
            />`
        )}
      </div>
    `;
  }

  render() {
    const server = this.activeServer;
    if (!server) return html``;
    const connected = hasActiveConnection(server);
    const scene = SCENES[this.period];

    return html`
      <div class="time-chip">
        <md-icon>${scene.icon}</md-icon>
        <strong>${scene.greeting}</strong>
        <small>${this.moscowTime} МСК</small>
      </div>
      <figure
        class="house-scene"
        data-period=${this.period}
        data-connected=${connected ? 'true' : 'false'}
      >
        ${this.renderSceneLayer(scene.off, false)}
        ${this.renderSceneLayer(scene.on, true)}
        <button
          class="door-button"
          type="button"
          aria-label=${connected ? 'Отключить VPN' : 'Включить VPN'}
          aria-pressed=${connected ? 'true' : 'false'}
          ?disabled=${server.disabled || Boolean(server.errorMessageId)}
          @click=${this.toggleConnection}
        >
          <span class="door-button-content">
            <md-icon class="power-icon">power_settings_new</md-icon>
            <span class="door-label"
              >${connected ? 'Выключить' : 'Включить'}</span
            >
          </span>
        </button>
      </figure>
      <div
        class="connection-pill ${connected ? 'connected' : ''}"
        role="status"
      >
        <md-icon>${connected ? 'verified_user' : 'power_settings_new'}</md-icon>
        <strong
          >${connected ? 'Все дома · VPN включён' : 'VPN выключен'}</strong
        >
      </div>
      <p class="active-profile">Профиль: <strong>${server.name}</strong></p>
      <section class="profiles-panel" aria-label="Профили">
        <div class="section-heading">
          <h2>Профили</h2>
          <span class="profile-count">${this.servers.length}</span>
        </div>
        ${this.servers.map((profile, index) => {
          const selected = profile.id === server.id;
          const profileConnected = selected && hasActiveConnection(profile);
          return html`
            <button
              class="profile-row ${selected ? 'selected' : ''}"
              type="button"
              @click=${() => (this.selectedServerId = profile.id)}
            >
              <span class="profile-check ${profileConnected ? 'connected' : ''}"
                >${profileConnected ? html`<md-icon>check</md-icon>` : ''}</span
              >
              <span class="profile-copy">
                <strong>${profile.name}</strong>
                <small
                  >${index === 0
                    ? 'основной профиль'
                    : 'дополнительный профиль'}</small
                >
              </span>
              <md-icon>chevron_right</md-icon>
            </button>
          `;
        })}
      </section>
    `;
  }
}
