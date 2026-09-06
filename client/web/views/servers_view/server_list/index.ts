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
import '@polymer/iron-icon/iron-icon.js';
import '@polymer/iron-icons/iron-icons.js';
import {css, html, LitElement} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';

import {
  AndroidAppUpdater,
  AppRelease,
  appUpdateErrorMessage,
  isAndroidAppUpdateSupported,
} from '../../../app/app_update';
import dayOn from '../../../assets/home/day-on.webp';
import dayOff from '../../../assets/home/day.webp';
import eveningOn from '../../../assets/home/evening-on.webp';
import eveningOff from '../../../assets/home/evening.webp';
import morningOn from '../../../assets/home/morning-on.webp';
import morningOff from '../../../assets/home/morning.webp';
import nightOn from '../../../assets/home/night-on.webp';
import nightOff from '../../../assets/home/night.webp';
import {activeProfile, hasActiveConnection} from '../profile_selection';
import {ServerConnectionState} from '../server_connection_indicator';
import {ServerListItem, ServerListItemEvent} from '../server_list_item';

type TimePeriod = 'morning' | 'day' | 'evening' | 'night';
type AppUpdateState =
  | 'hidden'
  | 'available'
  | 'downloading'
  | 'permission'
  | 'installing'
  | 'error';

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

export function getMoscowTime(now = new Date()) {
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

@customElement('server-list')
export class ServerList extends LitElement {
  @property({type: Boolean}) darkMode = false;
  @property({type: Object}) localize: Localizer = msg => msg;
  @property({type: Array}) servers: ServerListItem[] = [];

  @property({type: String}) selectedServerId = '';
  @state() private period: TimePeriod = getMoscowTime().period;
  @state() private moscowTime = getMoscowTime().time;
  @state() private appUpdateState: AppUpdateState = 'hidden';
  @state() private appUpdateRelease?: AppRelease;
  @state() private downloadedUpdatePath = '';
  @state() private appUpdateProgress = 0;
  @state() private appUpdateError = appUpdateErrorMessage('download');

  private clockTimer?: number;
  private updateCheckTimer?: number;
  private readonly appUpdater = new AndroidAppUpdater();

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
      display: flex;
      flex-direction: column;
      height: 100%;
      margin: 0 auto;
      overflow-y: auto;
      padding: 8px 16px max(40px, env(safe-area-inset-bottom));
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

    .home-album {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 12px;
      flex: 1 0 auto;
    }
    .time-chip {
      display: grid;
      width: 100%;
      min-height: 78px;
      margin: 0;
      padding: 14px 16px;
      grid-template-columns: 36px minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
      color: var(--home-ink);
      background: var(--home-paper);
      border: 1px solid var(--home-line);
      border-radius: 18px;
    }

    .update-card {
      display: grid;
      margin: 0 2px 10px;
      padding: 11px 12px;
      grid-template-columns: 34px minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
      color: var(--home-ink);
      background: #f0f5dc;
      border: 1px solid #b7c987;
      border-radius: 18px;
      box-shadow: 0 7px 18px rgb(83 118 41 / 10%);
    }
    .update-card.error {
      background: var(--home-off-pale);
      border-color: #d8aaa1;
    }
    .update-icon {
      display: grid;
      width: 34px;
      height: 34px;
      place-items: center;
      color: white;
      background: var(--home-green);
      border-radius: 12px;
    }
    .update-card.error .update-icon {
      background: var(--home-off);
    }
    .update-icon md-icon {
      color: inherit;
      font-size: 21px;
    }
    .update-copy {
      display: flex;
      min-width: 0;
      flex-direction: column;
      gap: 2px;
    }
    .update-copy strong {
      font-size: 13px;
    }
    .update-copy small {
      display: -webkit-box;
      overflow: hidden;
      color: var(--home-muted);
      font-size: 11px;
      line-height: 1.25;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }
    .update-progress {
      display: grid;
      grid-column: 2 / -1;
      grid-template-columns: minmax(0, 1fr) 34px;
      gap: 8px;
      align-items: center;
    }
    .update-progress progress {
      width: 100%;
      height: 8px;
      overflow: hidden;
      appearance: none;
      background: #dce7bd;
      border: 0;
      border-radius: 999px;
    }
    .update-progress progress::-webkit-progress-bar {
      background: #dce7bd;
      border-radius: 999px;
    }
    .update-progress progress::-webkit-progress-value {
      background: var(--home-green);
      border-radius: 999px;
      transition: width 220ms ease;
    }
    .update-progress progress::-moz-progress-bar {
      background: var(--home-green);
      border-radius: 999px;
    }
    .update-progress strong {
      color: var(--home-green-dark);
      font-size: 11px;
      text-align: right;
    }
    .update-action {
      min-height: 34px;
      padding: 0 11px;
      color: white;
      background: var(--home-green-dark);
      border: 0;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
    }
    .update-card.error .update-action {
      background: var(--home-off);
    }
    .update-action:disabled {
      cursor: default;
      opacity: 0.65;
    }
    .update-spinner {
      animation: update-spin 1s linear infinite;
    }

    .time-chip md-icon {
      color: var(--home-terracotta-dark);
      width: 36px;
      height: 36px;
      font-size: 36px;
    }
    .time-chip strong {
      font-size: 18px;
      line-height: 1.25;
    }
    .moscow-clock {
      display: grid;
      gap: 4px;
      text-align: center;
      font-size: 22px;
      line-height: 1;
      font-variant-numeric: tabular-nums;
    }
    .moscow-clock small {
      font-size: 11px;
      color: var(--home-muted);
    }

    .house-scene {
      --door-control-x: 51.05%;
      --door-control-y: 79.55%;
      --door-glow-diameter: 94%;
      position: relative;
      width: 100%;
      margin: 0;
      overflow: hidden;
      aspect-ratio: 2 / 3;
      background: var(--scene-sky, #081c30);
      background-size: 100% 200%;
      background-position: center top;
      background-repeat: no-repeat;
      flex: none;
      border: 0;
      border-radius: 50% 50% 24px 24px / 24% 24% 24px 24px;
    }

    /* Crop only the garden edges, never stretch the art. Every room mask and
       the door control use this same 4:5 coordinate space in all eight states. */
    .scene-canvas {
      position: absolute;
      bottom: 0;
      left: 50%;
      height: calc(100% - 40px);
      aspect-ratio: 4 / 5;
      transform: translateX(-50%);
      mask-image: linear-gradient(transparent, black 12px);
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
      filter: brightness(1.18) contrast(1.14) saturate(1.24);
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
      --scene-sky: #dbd8c5;
      --door-control-x: 51%;
      --door-control-y: 79.45%;
    }
    .house-scene[data-period='day'] {
      --scene-sky: #aed5e6;
      --door-control-x: 51.35%;
      --door-control-y: 79.55%;
    }
    .house-scene[data-period='evening'] {
      --scene-sky: #17202c;
      --door-control-x: 51%;
      --door-control-y: 79.65%;
    }
    .house-scene[data-period='night'] {
      --scene-sky: #081c30;
      --door-control-x: 51.05%;
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
    }
    .door-button:active {
      transform: translate(-50%, -50%) scale(0.96);
    }
    .door-button:disabled {
      cursor: default;
      opacity: 0.55;
    }
    .door-button:focus-visible {
      outline: 2px solid #fffaf0;
      outline-offset: -6px;
      border-radius: 48% 48% 8px 8px;
    }

    .door-button-content {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
    }
    .door-button-content::before {
      position: absolute;
      top: 50%;
      left: 50%;
      width: var(--door-glow-diameter);
      aspect-ratio: 1;
      content: '';
      pointer-events: none;
      transform: translate(-50%, -50%);
      background: radial-gradient(
        circle,
        rgb(230 249 170 / 70%) 0%,
        rgb(184 224 94 / 38%) 48%,
        rgb(151 194 68 / 12%) 88%,
        transparent 100%
      );
      border-radius: 50%;
      opacity: 0;
      transition: opacity 500ms ease;
    }
    .door-button.connected .door-button-content::before {
      opacity: 1;
    }
    .power-icon {
      position: relative;
      z-index: 1;
      color: #fffdf0;
      width: 48px;
      height: 48px;
      pointer-events: none;
      filter: drop-shadow(0 2px 4px rgb(49 28 20 / 78%));
      transition:
        color 500ms ease,
        filter 500ms ease;
    }
    .door-button.connected .power-icon {
      color: #f5ffd8;
      filter: drop-shadow(0 0 6px rgb(222 246 151 / 92%))
        drop-shadow(0 2px 3px rgb(49 28 20 / 60%));
    }

    .connection-status {
      display: grid;
      min-height: 72px;
      align-content: center;
      justify-items: center;
      gap: 8px;
      padding: 8px 0;
      color: var(--home-off);
      text-align: center;
    }
    .connection-status.connected {
      color: var(--home-green-dark);
    }
    .connection-status h2 {
      display: flex;
      gap: 10px;
      align-items: center;
      margin: 0;
      font-size: clamp(27px, 8vw, 36px);
      font-weight: 700;
      line-height: 1.12;
      letter-spacing: -0.6px;
    }
    .connection-status p {
      margin: 0;
      font-size: 15px;
      line-height: 1.3;
    }
    .connection-status md-icon {
      color: currentColor;
      width: 28px;
      height: 28px;
      font-size: 28px;
    }
    @media (max-width: 350px) {
      .time-chip {
        padding: 12px;
        gap: 8px;
        grid-template-columns: 28px minmax(0, 1fr) auto;
      }
      .time-chip strong {
        font-size: 16px;
      }
      .time-chip md-icon {
        width: 28px;
        height: 28px;
        font-size: 28px;
      }
      .moscow-clock {
        font-size: 20px;
      }
    }
    @media (max-height: 740px) {
      .home-album {
        gap: 12px;
      }
      .connection-status {
        min-height: 72px;
      }
      .connection-status h2 {
        font-size: 28px;
      }
      .time-chip {
        min-height: 64px;
      }
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
    @keyframes update-spin {
      to {
        transform: rotate(360deg);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .scene-layer--on {
        transition-duration: 1ms;
      }
      .room-motion {
        animation: none;
      }
      .door-button-content::before,
      .power-icon {
        transition: none;
      }
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.updateClock();
    this.clockTimer = window.setInterval(() => this.updateClock(), 30_000);
    if (isAndroidAppUpdateSupported()) {
      this.updateCheckTimer = window.setTimeout((): void => {
        void this.checkForAppUpdate();
      }, 1_200);
    }
  }

  disconnectedCallback() {
    if (this.clockTimer) window.clearInterval(this.clockTimer);
    if (this.updateCheckTimer) window.clearTimeout(this.updateCheckTimer);
    super.disconnectedCallback();
  }

  private async checkForAppUpdate() {
    this.appUpdateProgress = 0;
    try {
      const result = await this.appUpdater.check();
      if (result.available) {
        this.appUpdateRelease = result;
        this.appUpdateState = 'available';
      } else {
        this.appUpdateState = 'hidden';
      }
    } catch (error) {
      // A background check must never interrupt normal VPN use.
      console.warn('App update check failed', error);
      this.appUpdateState = 'hidden';
    }
  }

  private async downloadAppUpdate() {
    this.appUpdateState = 'downloading';
    this.appUpdateProgress = 0;
    try {
      const update = await this.appUpdater.download(progress => {
        this.appUpdateProgress = progress.percent;
      });
      this.appUpdateRelease = update;
      this.downloadedUpdatePath = update.filePath;
      await this.installAppUpdate();
    } catch (error) {
      console.error('App update download failed', error);
      this.appUpdateError = appUpdateErrorMessage('download');
      this.appUpdateState = 'error';
    }
  }

  private async installAppUpdate() {
    if (!this.downloadedUpdatePath) {
      await this.downloadAppUpdate();
      return;
    }
    try {
      const result = await this.appUpdater.install(this.downloadedUpdatePath);
      this.appUpdateState =
        result.status === 'permission_required' ? 'permission' : 'installing';
    } catch (error) {
      console.error('App update installer failed', error);
      this.appUpdateError = appUpdateErrorMessage('install');
      this.appUpdateState = 'error';
    }
  }

  private renderAppUpdate() {
    if (this.appUpdateState === 'hidden') return html``;
    const release = this.appUpdateRelease;
    const busy = ['downloading', 'installing'].includes(this.appUpdateState);
    const title =
      this.appUpdateState === 'available'
        ? `Вышла версия ${release?.versionName ?? ''}`
        : this.appUpdateState === 'downloading'
          ? this.appUpdateProgress < 100
            ? 'Скачиваем обновление…'
            : 'Проверяем обновление…'
          : this.appUpdateState === 'permission'
            ? 'Разрешите установку'
            : this.appUpdateState === 'installing'
              ? 'Подтвердите установку'
              : 'Не удалось обновиться';
    const details =
      this.appUpdateState === 'available'
        ? release?.releaseNotes || 'Новая версия «В домике» уже готова.'
        : this.appUpdateState === 'permission'
          ? 'Включите разрешение для «В домике», затем нажмите «Продолжить».'
          : this.appUpdateState === 'installing'
            ? 'Подтвердите обновление в системном окне Android. Если окно закрыто, нажмите «Открыть».'
            : this.appUpdateState === 'error'
              ? this.appUpdateError
              : this.appUpdateProgress < 100
                ? `Загружено ${this.appUpdateProgress}% файла.`
                : 'Загрузка завершена. Проверяем файл и подпись.';
    const action =
      this.appUpdateState === 'permission'
        ? 'Продолжить'
        : this.appUpdateState === 'error'
          ? 'Повторить'
          : this.appUpdateState === 'installing'
            ? 'Открыть'
            : this.appUpdateState === 'downloading'
              ? 'Подождите'
              : 'Обновить';

    return html`
      <aside
        class="update-card ${this.appUpdateState === 'error' ? 'error' : ''}"
        role="status"
      >
        <span class="update-icon">
          <md-icon class=${busy ? 'update-spinner' : ''}
            >${busy
              ? 'sync'
              : this.appUpdateState === 'error'
                ? 'error'
                : 'system_update'}</md-icon
          >
        </span>
        <span class="update-copy">
          <strong>${title}</strong>
          <small>${details}</small>
        </span>
        <button
          class="update-action"
          type="button"
          ?disabled=${this.appUpdateState === 'downloading'}
          @click=${() =>
            this.appUpdateState === 'available' ||
            this.appUpdateState === 'error'
              ? this.downloadAppUpdate()
              : this.installAppUpdate()}
        >
          ${action}
        </button>
        ${this.appUpdateState === 'downloading'
          ? html`<div class="update-progress">
              <progress
                aria-label="Скачивание обновления"
                max="100"
                value=${this.appUpdateProgress}
              ></progress>
              <strong>${this.appUpdateProgress}%</strong>
            </div>`
          : ''}
      </aside>
    `;
  }

  private updateClock() {
    const {period, time} = getMoscowTime();
    this.period = period;
    this.moscowTime = time;
  }

  private get activeServer() {
    return activeProfile(this.servers, this.selectedServerId);
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
    const connected =
      this.activeServer?.connectionState === ServerConnectionState.CONNECTED;
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
    const connected =
      server.connectionState === ServerConnectionState.CONNECTED;
    const transitioning = [
      ServerConnectionState.CONNECTING,
      ServerConnectionState.RECONNECTING,
      ServerConnectionState.DISCONNECTING,
    ].includes(server.connectionState);
    const active = hasActiveConnection(server);
    const heading = server.errorMessageId
      ? 'Нет соединения'
      : transitioning
        ? server.connectionState === ServerConnectionState.DISCONNECTING
          ? 'Отключаемся'
          : 'Подключаемся'
        : connected
          ? 'Все дома'
          : 'VPN выключен';
    const hint = server.errorMessageId
      ? 'Проверьте профиль в меню'
      : transitioning
        ? 'Пожалуйста, подождите'
        : connected
          ? 'VPN включён'
          : 'Нажмите на дверь';
    const scene = SCENES[this.period];

    return html`
      ${this.renderAppUpdate()}
      <section class="home-album" aria-label="Домой">
        <div
          class="connection-status ${connected ? 'connected' : ''}"
          role="status"
          aria-live="polite"
        >
          <h2>
            ${heading}${connected ? html`<md-icon>verified_user</md-icon>` : ''}
          </h2>
          <p>${hint}</p>
        </div>
        <figure
          class="house-scene"
          style=${`background-image: url('${scene.off}')`}
          data-period=${this.period}
          data-connected=${connected ? 'true' : 'false'}
        >
          <div class="scene-canvas">
            ${this.renderSceneLayer(scene.off, false)}
            ${this.renderSceneLayer(scene.on, true)}
            <button
              class="door-button ${connected ? 'connected' : 'disconnected'}"
              type="button"
              aria-label=${active ? 'Отключить VPN' : 'Включить VPN'}
              aria-pressed=${connected ? 'true' : 'false'}
              ?disabled=${server.disabled || Boolean(server.errorMessageId)}
              @click=${this.toggleConnection}
            >
              <span class="door-button-content">
                <iron-icon
                  class="power-icon"
                  icon="power-settings-new"
                ></iron-icon>
              </span>
            </button>
          </div>
        </figure>
        <div class="time-chip">
          <md-icon aria-hidden="true">${scene.icon}</md-icon>
          <strong>${scene.greeting}</strong>
          <span
            class="moscow-clock"
            aria-label=${`${this.moscowTime}, московское время`}
          >
            <time>${this.moscowTime}</time><small>МСК</small>
          </span>
        </div>
      </section>
    `;
  }
}
